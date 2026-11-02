import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_REPO = 'AlexiP18/awesome-dev-toolkit';
const DEFAULT_BRANCH = 'main';

const deletedRepoPaths = new Set<string>();
let syncQueue: Promise<any> = Promise.resolve();

function toRepoRelativePath(filePath: string): string {
  const abs = path.resolve(process.cwd(), filePath);
  const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');
  return rel;
}

export function markRepoPathDeleted(filePath: string): void {
  const rel = toRepoRelativePath(filePath);
  if (rel && !rel.startsWith('..')) {
    deletedRepoPaths.add(rel);
  }
}

export function unmarkRepoPathDeleted(filePath: string): void {
  const rel = toRepoRelativePath(filePath);
  deletedRepoPaths.delete(rel);
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

/**
 * Al iniciar el servidor (por ejemplo tras un reinicio o hibernación en Render),
 * descarga desde la rama principal de GitHub cualquier archivo de `content/` o `data/categories.json`
 * que se haya guardado previamente en el repositorio pero no esté en el contenedor efímero.
 */
export async function syncFromGitHubRepoOnStartup(): Promise<{ downloaded: number }> {
  const { repo, branch, token } = getRepoConfig();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'awesome-dev-toolkit-sync',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let downloaded = 0;
  try {
    const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`;
    const res = await fetch(treeUrl, { headers });
    if (!res.ok) {
      console.warn(`[GitHub Sync] No se pudo consultar el árbol remoto (${res.status}).`);
      return { downloaded: 0 };
    }

    const data = (await res.json()) as {
      tree?: Array<{ path: string; type: string; sha: string }>;
    };
    if (!Array.isArray(data.tree)) return { downloaded: 0 };

    const targetPrefixes = [
      'content/tools/',
      'content/tips/',
      'content/products/',
      'content/jobs/',
      'content/authors/',
    ];

    const candidates = data.tree.filter((item) => {
      if (item.type !== 'blob') return false;
      if (item.path === 'data/categories.json') return true;
      return targetPrefixes.some((p) => item.path.startsWith(p) && item.path.endsWith('.md'));
    });

    for (const item of candidates) {
      if (deletedRepoPaths.has(item.path)) continue;
      const localAbs = path.resolve(process.cwd(), item.path);

      if (fs.existsSync(localAbs)) {
        const existingBuf = fs.readFileSync(localAbs);
        const localSha = computeGitBlobSha(existingBuf);
        if (localSha === item.sha) {
          continue;
        }
      }

      // Descargar archivo desde raw.githubusercontent.com
      const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${item.path}`;
      const rawRes = await fetch(rawUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (rawRes.ok) {
        const text = await rawRes.text();
        const dir = path.dirname(localAbs);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(localAbs, text, 'utf-8');
        downloaded++;
      }
    }

    if (downloaded > 0) {
      console.log(`[GitHub Sync] 📥 Recuperados ${downloaded} archivo(s) desde ${repo}@${branch} al iniciar.`);
    }
  } catch (err: any) {
    console.warn(`[GitHub Sync] Aviso al sincronizar desde GitHub en el arranque:`, err?.message || err);
  }

  return { downloaded };
}

function collectLocalCatalogFiles(): string[] {
  const dirs = [
    'content/tools',
    'content/tips',
    'content/products',
    'content/jobs',
    'content/authors',
  ];
  const files: string[] = [];

  for (const relDir of dirs) {
    const absDir = path.resolve(process.cwd(), relDir);
    if (!fs.existsSync(absDir)) continue;
    const entries = fs.readdirSync(absDir).filter((f) => f.endsWith('.md'));
    for (const entry of entries) {
      files.push(`${relDir}/${entry}`);
    }
  }

  if (fs.existsSync(path.resolve(process.cwd(), 'data/categories.json'))) {
    files.push('data/categories.json');
  }
  if (fs.existsSync(path.resolve(process.cwd(), 'README.md'))) {
    files.push('README.md');
  }

  return files;
}

async function performGitHubPush(commitMessage: string): Promise<{
  synced: boolean;
  changedFiles: number;
  commitSha?: string;
  reason?: string;
}> {
  const { repo, branch, token } = getRepoConfig();
  if (!token) {
    return {
      synced: false,
      changedFiles: 0,
      reason: 'GITHUB_TOKEN no configurado (usando respaldo persistente en navegador + disco local)',
    };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'awesome-dev-toolkit-sync',
  };

  try {
    // 1. Obtener referencia actual de la rama
    const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, { headers });
    if (!refRes.ok) {
      const errTxt = await refRes.text();
      console.warn(`[GitHub Sync] Error obteniendo ref heads/${branch} (${refRes.status}): ${errTxt}`);
      return { synced: false, changedFiles: 0, reason: `HTTP ${refRes.status}` };
    }
    const refData = (await refRes.json()) as { object: { sha: string } };
    const headCommitSha = refData.object.sha;

    // 2. Obtener el commit actual y su tree SHA
    const commitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits/${headCommitSha}`, { headers });
    if (!commitRes.ok) {
      return { synced: false, changedFiles: 0, reason: `Commit HTTP ${commitRes.status}` };
    }
    const commitData = (await commitRes.json()) as { tree: { sha: string } };
    const baseTreeSha = commitData.tree.sha;

    // 3. Obtener el árbol recursivo actual para comparar SHAs
    const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees/${baseTreeSha}?recursive=1`, { headers });
    const remoteShas = new Map<string, string>();
    if (treeRes.ok) {
      const treeData = (await treeRes.json()) as { tree?: Array<{ path: string; type: string; sha: string }> };
      for (const item of treeData.tree || []) {
        if (item.type === 'blob') {
          remoteShas.set(item.path, item.sha);
        }
      }
    }

    // 4. Construir lista de cambios (archivos nuevos/modificados y eliminados)
    const treeChanges: Array<{
      path: string;
      mode: '100644';
      type: 'blob';
      content?: string;
      sha?: string | null;
    }> = [];

    const localFiles = collectLocalCatalogFiles();
    for (const relPath of localFiles) {
      const absPath = path.resolve(process.cwd(), relPath);
      if (!fs.existsSync(absPath)) continue;
      const buf = fs.readFileSync(absPath);
      const localSha = computeGitBlobSha(buf);
      if (remoteShas.get(relPath) !== localSha) {
        treeChanges.push({
          path: relPath,
          mode: '100644',
          type: 'blob',
          content: buf.toString('utf-8'),
        });
      }
    }

    const processedDeletes: string[] = [];
    for (const delPath of deletedRepoPaths) {
      const absPath = path.resolve(process.cwd(), delPath);
      if (!fs.existsSync(absPath) && remoteShas.has(delPath)) {
        treeChanges.push({
          path: delPath,
          mode: '100644',
          type: 'blob',
          sha: null,
        });
      }
      processedDeletes.push(delPath);
    }

    if (treeChanges.length === 0) {
      for (const d of processedDeletes) deletedRepoPaths.delete(d);
      return { synced: true, changedFiles: 0 };
    }

    // 5. Crear nuevo árbol en GitHub
    const newTreeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeChanges,
      }),
    });

    if (!newTreeRes.ok) {
      const errTxt = await newTreeRes.text();
      console.warn(`[GitHub Sync] Error creando árbol en GitHub (${newTreeRes.status}): ${errTxt}`);
      return { synced: false, changedFiles: 0, reason: `Tree HTTP ${newTreeRes.status}` };
    }
    const newTreeData = (await newTreeRes.json()) as { sha: string };

    // 6. Crear nuevo commit con [skip render] [skip ci] para no reiniciar el contenedor activo en Render
    const finalMessage = `${commitMessage} [skip render] [skip ci]`;
    const newCommitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: finalMessage,
        tree: newTreeData.sha,
        parents: [headCommitSha],
      }),
    });

    if (!newCommitRes.ok) {
      const errTxt = await newCommitRes.text();
      console.warn(`[GitHub Sync] Error creando commit en GitHub (${newCommitRes.status}): ${errTxt}`);
      return { synced: false, changedFiles: 0, reason: `CreateCommit HTTP ${newCommitRes.status}` };
    }
    const newCommitData = (await newCommitRes.json()) as { sha: string };

    // 7. Actualizar la referencia de la rama
    const updateRefRes = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sha: newCommitData.sha,
        force: false,
      }),
    });

    if (!updateRefRes.ok) {
      const errTxt = await updateRefRes.text();
      console.warn(`[GitHub Sync] Error actualizando ref en GitHub (${updateRefRes.status}): ${errTxt}`);
      return { synced: false, changedFiles: 0, reason: `UpdateRef HTTP ${updateRefRes.status}` };
    }

    for (const d of processedDeletes) deletedRepoPaths.delete(d);
    console.log(
      `[GitHub Sync] ☁️ Sincronizados ${treeChanges.length} archivo(s) en ${repo}@${branch} (commit ${newCommitData.sha.slice(0, 7)})`
    );

    return {
      synced: true,
      changedFiles: treeChanges.length,
      commitSha: newCommitData.sha,
    };
  } catch (err: any) {
    console.warn(`[GitHub Sync] Error sincronizando con GitHub:`, err?.message || err);
    return { synced: false, changedFiles: 0, reason: err?.message || 'Error desconocido' };
  }
}

/**
 * Encola una sincronización atómica hacia el repositorio de GitHub para que las fichas
 * queden guardadas permanentemente en el repo.
 */
export function syncCatalogToGitHubRepo(commitMessage: string): Promise<{
  synced: boolean;
  changedFiles: number;
  commitSha?: string;
  reason?: string;
}> {
  const next = syncQueue.then(() => performGitHubPush(commitMessage));
  syncQueue = next.catch(() => {});
  return next;
}
