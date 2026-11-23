import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { invalidateCatalogCache } from './catalog_state.js';
import { envInt } from './http_util.js';
import { logEvent, redact } from './log.js';
import {
  createPushCoalescer,
  createSerialQueue,
  isRetryableGitHubStatus,
  pushWithRetries,
  retryDelayMs,
  shouldClearLocalSyncState,
  type HeaderBag,
  type SyncResult,
} from './sync_policy.js';

const DEFAULT_REPO = 'AlexiP18/awesome-dev-toolkit';
const DEFAULT_BRANCH = 'main';

const deletedRepoPaths = new Set<string>();
const dirtyPaths = new Set<string>();
let catalogGeneration = 0;
let journalWanted = false;
let lastRemoteHead: string | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export interface GitResponse {
  status: number;
  headers: HeaderBag;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type GitRequest = (
  url: string,
  init?: { method?: string; body?: string }
) => Promise<GitResponse>;

function contentRoot(): string {
  return process.env.CONTENT_DIR
    ? path.resolve(process.env.CONTENT_DIR)
    : path.resolve(process.cwd(), 'content');
}

function toRepoRelativePath(filePath: string): string {
  const abs = path.resolve(process.cwd(), filePath);
  return path.relative(process.cwd(), abs).replace(/\\/g, '/');
}

function acceptRel(rel: string): boolean {
  return Boolean(rel) && !rel.startsWith('../') && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function bumpGeneration(): void {
  catalogGeneration += 1;
  invalidateCatalogCache();
}

function journalPath(): string {
  return process.env.SYNC_JOURNAL_PATH
    ? path.resolve(process.env.SYNC_JOURNAL_PATH)
    : path.resolve(process.cwd(), 'data', '.sync-pending.json');
}

function journalEnabled(): boolean {
  return isGitHubSyncConfigured() && process.env.SYNC_JOURNAL !== '0';
}

function persistJournal(): void {
  if (!journalEnabled()) return;
  journalWanted = true;
  try {
    const file = journalPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ pending: true, at: new Date().toISOString() })}\n`, 'utf-8');
  } catch (err) {
    logEvent('warn', 'No se pudo guardar el diario de sincronización', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function journalPending(): boolean {
  if (journalWanted) return true;
  try {
    return fs.existsSync(journalPath());
  } catch {
    return false;
  }
}

function clearJournal(): void {
  journalWanted = false;
  try {
    if (fs.existsSync(journalPath())) fs.unlinkSync(journalPath());
  } catch {
    // el siguiente arranque volverá a intentarlo
  }
}

function noteMutation(filePath: string, deleted: boolean): void {
  const rel = toRepoRelativePath(filePath);
  if (acceptRel(rel)) {
    if (deleted) deletedRepoPaths.add(rel);
    else deletedRepoPaths.delete(rel);
    dirtyPaths.add(rel);
    persistJournal();
  }
  bumpGeneration();
}

export function markRepoPathDeleted(filePath: string): void {
  noteMutation(filePath, true);
}

export function unmarkRepoPathDeleted(filePath: string): void {
  noteMutation(filePath, false);
}

function computeGitBlobSha(contentBuffer: Buffer): string {
  const header = Buffer.from(`blob ${contentBuffer.length}\0`, 'utf-8');
  return crypto.createHash('sha1').update(header).update(contentBuffer).digest('hex');
}

function getRepoConfig() {
  const repo = (process.env.GITHUB_REPO || DEFAULT_REPO).trim();
  const branch = (process.env.GITHUB_BRANCH || DEFAULT_BRANCH).trim();
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  return { repo, branch, token };
}

export function isGitHubSyncConfigured(): boolean {
  const { token } = getRepoConfig();
  return Boolean(token);
}

export function getSyncStatus(): {
  configured: boolean;
  pendingJournal: boolean;
  dirtyFiles: number;
  lastRemoteHead: string | null;
} {
  return {
    configured: isGitHubSyncConfigured(),
    pendingJournal: journalPending(),
    dirtyFiles: dirtyPaths.size,
    lastRemoteHead,
  };
}

function syncAttempts(): number {
  const raw = process.env.GITHUB_SYNC_ATTEMPTS;
  if (!raw) return 4;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 4;
  return Math.min(Math.floor(n), 8);
}

export function pullIntervalMs(): number {
  const raw = process.env.GITHUB_PULL_INTERVAL_MS;
  if (raw === undefined || raw.trim() === '') return 5 * 60 * 1000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function collectLocalCatalogFiles(): string[] {
  const dirs = ['tools', 'tips', 'jobs', 'authors'].map((name) => path.join(contentRoot(), name));
  const files: string[] = [];

  for (const absDir of dirs) {
    if (!fs.existsSync(absDir)) continue;
    for (const entry of fs.readdirSync(absDir)) {
      if (!entry.endsWith('.md')) continue;
      const rel = toRepoRelativePath(path.join(absDir, entry));
      if (acceptRel(rel)) files.push(rel);
    }
  }

  const categories = path.resolve(process.cwd(), 'data/categories.json');
  if (fs.existsSync(categories)) {
    const rel = toRepoRelativePath(categories);
    if (acceptRel(rel)) files.push(rel);
  }
  const readme = path.resolve(process.cwd(), 'README.md');
  if (fs.existsSync(readme)) files.push('README.md');
  return files;
}

function markAllLocalCatalogDirty(): void {
  for (const rel of collectLocalCatalogFiles()) dirtyPaths.add(rel);
}

async function githubRequest(url: string, token: string | undefined, init?: { method?: string; body?: string }): Promise<GitResponse> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'awesome-dev-toolkit-sync',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init?.body) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timeoutMs = envInt('GITHUB_HTTP_TIMEOUT_MS', 20_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: init?.method || 'GET',
      headers,
      body: init?.body,
      signal: controller.signal,
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: { get: (name) => res.headers.get(name) },
      text: async () => text,
      json: async () => (text ? JSON.parse(text) as unknown : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

function failureFrom(status: number, headers: HeaderBag, body: string, fallback: string): SyncResult {
  const retryable = isRetryableGitHubStatus(status, headers, body);
  const retryAfter = headers.get('retry-after');
  return {
    synced: false,
    changedFiles: 0,
    reason: redact(body.slice(0, 240) || fallback),
    retryable,
    retryAfterMs: retryable && retryAfter ? retryDelayMs(1, retryAfter) : undefined,
  };
}

export interface PushOnceInput {
  message: string;
  request: GitRequest;
  repo: string;
  branch: string;
  token: string;
  listFiles: () => string[];
  readFile: (rel: string) => Buffer | null;
  deletedPaths: Set<string>;
  generation?: number;
}

export async function pushCatalogOnce(input: PushOnceInput): Promise<SyncResult & { generationAtRead: number }> {
  const { repo, branch, request } = input;
  const api = `https://api.github.com/repos/${repo}`;
  const generationAtRead = input.generation ?? catalogGeneration;

  const refRes = await request(`${api}/git/ref/heads/${branch}`);
  if (refRes.status !== 200) {
    const body = await refRes.text();
    return { ...failureFrom(refRes.status, refRes.headers, body, `HTTP ${refRes.status}`), generationAtRead };
  }
  const refData = (await refRes.json()) as { object?: { sha?: string } };
  const headCommitSha = refData.object?.sha;
  if (!headCommitSha) {
    return { synced: false, changedFiles: 0, reason: 'La referencia de la rama no trae SHA', retryable: true, generationAtRead };
  }

  const commitRes = await request(`${api}/git/commits/${headCommitSha}`);
  if (commitRes.status !== 200) {
    const body = await commitRes.text();
    return { ...failureFrom(commitRes.status, commitRes.headers, body, `Commit HTTP ${commitRes.status}`), generationAtRead };
  }
  const commitData = (await commitRes.json()) as { tree?: { sha?: string } };
  const baseTreeSha = commitData.tree?.sha;
  if (!baseTreeSha) {
    return { synced: false, changedFiles: 0, reason: 'El commit remoto no trae árbol', retryable: true, generationAtRead };
  }

  const treeRes = await request(`${api}/git/trees/${baseTreeSha}?recursive=1`);
  const remoteShas = new Map<string, string>();
  if (treeRes.status === 200) {
    const treeData = (await treeRes.json()) as { tree?: Array<{ path: string; type: string; sha: string }>; truncated?: boolean };
    if (treeData.truncated) {
      logEvent('warn', 'El árbol remoto de GitHub vino truncado', { repo, branch });
    }
    for (const item of treeData.tree || []) {
      if (item.type === 'blob') remoteShas.set(item.path, item.sha);
    }
  } else {
    const body = await treeRes.text();
    return { ...failureFrom(treeRes.status, treeRes.headers, body, `Tree HTTP ${treeRes.status}`), generationAtRead };
  }

  const localFiles = input.listFiles();
  const treeChanges: Array<{ path: string; mode: '100644'; type: 'blob'; content?: string; sha?: string | null }> = [];

  for (const relPath of localFiles) {
    const buf = input.readFile(relPath);
    if (!buf) continue;
    const localSha = computeGitBlobSha(buf);
    if (remoteShas.get(relPath) !== localSha) {
      treeChanges.push({ path: relPath, mode: '100644', type: 'blob', content: buf.toString('utf-8') });
    }
  }

  for (const delPath of input.deletedPaths) {
    if (remoteShas.has(delPath) && !localFiles.includes(delPath)) {
      treeChanges.push({ path: delPath, mode: '100644', type: 'blob', sha: null });
    }
  }

  const readGeneration = input.generation ?? catalogGeneration;

  if (treeChanges.length === 0) {
    lastRemoteHead = headCommitSha;
    return { synced: true, changedFiles: 0, commitSha: headCommitSha, generationAtRead: readGeneration };
  }

  const newTreeRes = await request(`${api}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeChanges }),
  });
  if (newTreeRes.status !== 201 && newTreeRes.status !== 200) {
    const body = await newTreeRes.text();
    return { ...failureFrom(newTreeRes.status, newTreeRes.headers, body, `Tree HTTP ${newTreeRes.status}`), generationAtRead: readGeneration };
  }
  const newTreeData = (await newTreeRes.json()) as { sha?: string };
  if (!newTreeData.sha) {
    return { synced: false, changedFiles: 0, reason: 'GitHub no devolvió el SHA del árbol', retryable: true, generationAtRead: readGeneration };
  }

  const finalMessage = `${input.message} [skip render] [skip ci]`;
  const newCommitRes = await request(`${api}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: finalMessage, tree: newTreeData.sha, parents: [headCommitSha] }),
  });
  if (newCommitRes.status !== 201 && newCommitRes.status !== 200) {
    const body = await newCommitRes.text();
    return { ...failureFrom(newCommitRes.status, newCommitRes.headers, body, `CreateCommit HTTP ${newCommitRes.status}`), generationAtRead: readGeneration };
  }
  const newCommitData = (await newCommitRes.json()) as { sha?: string };
  if (!newCommitData.sha) {
    return { synced: false, changedFiles: 0, reason: 'GitHub no devolvió el SHA del commit', retryable: true, generationAtRead: readGeneration };
  }

  const updateRefRes = await request(`${api}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommitData.sha, force: false }),
  });
  if (updateRefRes.status !== 200) {
    const body = await updateRefRes.text();
    return { ...failureFrom(updateRefRes.status, updateRefRes.headers, body, `UpdateRef HTTP ${updateRefRes.status}`), generationAtRead: readGeneration };
  }

  lastRemoteHead = newCommitData.sha;
  logEvent('info', 'catálogo sincronizado con GitHub', {
    repo,
    branch,
    changedFiles: treeChanges.length,
    commit: newCommitData.sha.slice(0, 7),
  });
  return {
    synced: true,
    changedFiles: treeChanges.length,
    commitSha: newCommitData.sha,
    generationAtRead: readGeneration,
  };
}

async function runPush(message: string): Promise<SyncResult> {
  const { repo, branch, token } = getRepoConfig();
  if (!token) {
    return {
      synced: false,
      changedFiles: 0,
      retryable: false,
      reason: 'GITHUB_TOKEN no configurado (usando respaldo persistente en navegador + disco local)',
    };
  }

  return pushWithRetries(
    async () => {
      try {
        const result = await pushCatalogOnce({
          message,
          request: (url, init) => githubRequest(url, token, init),
          repo,
          branch,
          token,
          listFiles: collectLocalCatalogFiles,
          readFile: (rel) => {
            const abs = path.resolve(process.cwd(), rel);
            if (!fs.existsSync(abs)) return null;
            return fs.readFileSync(abs);
          },
          deletedPaths: deletedRepoPaths,
        });
        if (shouldClearLocalSyncState(result.synced, result.generationAtRead, catalogGeneration)) {
          dirtyPaths.clear();
          deletedRepoPaths.clear();
          clearJournal();
        }
        const publicResult: SyncResult = {
          synced: result.synced,
          changedFiles: result.changedFiles,
          commitSha: result.commitSha,
          reason: result.reason,
          retryable: result.retryable,
          retryAfterMs: result.retryAfterMs,
        };
        return publicResult;
      } catch (err) {
        logEvent('warn', 'Error sincronizando con GitHub', { error: err instanceof Error ? err.message : String(err) });
        return { synced: false, changedFiles: 0, reason: err instanceof Error ? err.message : 'Error desconocido', retryable: true };
      }
    },
    { maxAttempts: syncAttempts() }
  );
}

const ioQueue = createSerialQueue();
const pushes = createPushCoalescer({
  push: (message) => ioQueue.run(() => runPush(message)),
});

function scheduleBackgroundRetry(message: string, delayMs: number): void {
  if (retryTimer || !isGitHubSyncConfigured()) return;
  const wait = Math.min(Math.max(delayMs, 5_000), 120_000);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncCatalogToGitHubRepo(message);
  }, wait);
  retryTimer.unref?.();
}

export function syncCatalogToGitHubRepo(commitMessage: string): Promise<SyncResult> {
  persistJournal();
  return pushes.enqueue(commitMessage).then((result) => {
    if (!result.synced && result.retryable) {
      scheduleBackgroundRetry(commitMessage, result.retryAfterMs ?? 15_000);
    }
    return result;
  });
}

const PULL_PREFIXES = ['content/tools/', 'content/tips/', 'content/jobs/', 'content/authors/'];

export function shouldWritePulledFile(rel: string, dirty: { has(value: string): boolean }, deleted: { has(value: string): boolean }): boolean {
  if (deleted.has(rel) || dirty.has(rel)) return false;
  return true;
}

async function pullOnce(reason: string): Promise<{ downloaded: number; unchanged?: boolean }> {
  const { repo, branch, token } = getRepoConfig();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'awesome-dev-toolkit-sync',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let downloaded = 0;
  let failed = 0;
  try {
    const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, { headers });
    if (!refRes.ok) {
      logEvent('warn', 'No se pudo leer la rama remota', { status: refRes.status, reason });
      return { downloaded: 0 };
    }
    const refData = (await refRes.json()) as { object?: { sha?: string } };
    const head = refData.object?.sha || '';
    if (head && head === lastRemoteHead && reason === 'interval') {
      return { downloaded: 0, unchanged: true };
    }

    const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`;
    const res = await fetch(treeUrl, { headers });
    if (!res.ok) {
      logEvent('warn', 'No se pudo consultar el árbol remoto', { status: res.status, reason });
      return { downloaded: 0 };
    }
    const data = (await res.json()) as { tree?: Array<{ path: string; type: string; sha: string }>; truncated?: boolean };
    if (data.truncated) logEvent('warn', 'Árbol remoto truncado al descargar content/', { reason });
    if (!Array.isArray(data.tree)) return { downloaded: 0 };

    const candidates = data.tree.filter((item) => {
      if (item.type !== 'blob') return false;
      if (item.path === 'data/categories.json') return true;
      return PULL_PREFIXES.some((prefix) => item.path.startsWith(prefix) && item.path.endsWith('.md'));
    });

    for (const item of candidates) {
      if (!shouldWritePulledFile(item.path, dirtyPaths, deletedRepoPaths)) continue;
      const localAbs = path.resolve(process.cwd(), item.path);
      if (fs.existsSync(localAbs)) {
        const localSha = computeGitBlobSha(fs.readFileSync(localAbs));
        if (localSha === item.sha) continue;
      }
      const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${item.path}`;
      const rawRes = await fetch(rawUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!rawRes.ok) {
        failed += 1;
        continue;
      }
      if (!shouldWritePulledFile(item.path, dirtyPaths, deletedRepoPaths)) continue;
      const text = await rawRes.text();
      fs.mkdirSync(path.dirname(localAbs), { recursive: true });
      fs.writeFileSync(localAbs, text, 'utf-8');
      downloaded += 1;
    }

    if (head && failed === 0) lastRemoteHead = head;
    if (downloaded > 0) {
      invalidateCatalogCache();
      logEvent('info', 'content/ actualizado desde GitHub', { downloaded, reason, repo, branch });
    }
  } catch (err) {
    logEvent('warn', 'Fallo al traer content/ desde GitHub', { reason, error: err instanceof Error ? err.message : String(err) });
  }
  return { downloaded };
}

export function pullContentFromGitHub(reason: string): Promise<{ downloaded: number; unchanged?: boolean }> {
  return ioQueue.run(() => pullOnce(reason));
}

export async function syncFromGitHubRepoOnStartup(): Promise<{ downloaded: number }> {
  if (journalPending()) markAllLocalCatalogDirty();
  const pulled = await pullContentFromGitHub('startup');
  if (journalPending() && isGitHubSyncConfigured()) {
    await syncCatalogToGitHubRepo('chore(catalog): reanudar sincronización pendiente');
  }
  return { downloaded: pulled.downloaded };
}

export function startGitHubMaintenance(): void {
  if (pullTimer) return;
  const interval = pullIntervalMs();
  if (interval <= 0) {
    logEvent('info', 'Pull periódico de content/ desactivado');
    return;
  }
  pullTimer = setInterval(() => {
    void pullContentFromGitHub('interval');
  }, interval);
  pullTimer.unref?.();
  logEvent('info', 'Pull periódico de content/ activo', { intervalMs: interval });
}

export async function flushGitHubSync(timeoutMs = 8000): Promise<void> {
  if (!isGitHubSyncConfigured()) return;
  if (!journalPending() && dirtyPaths.size === 0) return;
  await Promise.race([
    syncCatalogToGitHubRepo('chore(catalog): guardar cambios antes de apagar'),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export function stopGitHubMaintenanceForTests(): void {
  if (pullTimer) clearInterval(pullTimer);
  pullTimer = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}
