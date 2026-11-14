import express, { type Request, type Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { loadAllTools, updateToolNote, deleteToolNote, deleteToolNotes, restoreToolNotes } from '../pipeline/note_generator.js';
import { buildVaultExport } from '../pipeline/export_vault.js';
import { ingestResource } from '../pipeline/ingest.js';
import { generateReadme } from '../pipeline/generate_readme.js';
import { loadAllAuthorProfiles, analyzeAuthorWithAI } from '../pipeline/author_manager.js';
import { getActivePrimaryProviderName, getConfiguredProvidersList, structureThreadStepsWithAI } from '../pipeline/ai_providers.js';
import { fetchThreadTweetsFromX } from '../pipeline/twitter_scraper.js';
import { getAllCategories, addCustomCategory, deleteCustomCategory } from '../pipeline/category_manager.js';
import {
  syncCatalogToGitHubRepo,
  isGitHubSyncConfigured,
  pullContentFromGitHub,
  getSyncStatus,
  unmarkRepoPathDeleted,
} from '../pipeline/github_sync.js';
import { isCatalogCached } from '../pipeline/catalog_state.js';
import { verifyGitHubSignature } from '../pipeline/sync_policy.js';
import { logEvent } from '../pipeline/log.js';
import {
  HttpError,
  createRateLimiter,
  errorHandler,
  isOriginAllowed,
  positiveInt,
  readRawBody,
  rememberRawBody,
  requireAdmin,
} from './http.js';
import { injectAdminToken } from './html.js';
import {
  parseAuthorAnalyzeBody,
  parseBatchDelete,
  parseCategoryBody,
  parseCategoryName,
  parseIngestBody,
  parseRestoreBody,
  parseSince,
  parseSlug,
  parseThreadBody,
  parseToolPatch,
} from './validate.js';

dotenv.config();

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function refreshReadme(): void {
  try {
    const readme = generateReadme();
    const target = path.resolve(process.cwd(), 'README.md');
    fs.writeFileSync(target, readme, 'utf-8');
    unmarkRepoPathDeleted(target);
  } catch (err) {
    logEvent('warn', 'No se pudo actualizar README.md', { error: err instanceof Error ? err.message : String(err) });
  }
}

function queueSync(message: string): void {
  void syncCatalogToGitHubRepo(message).catch((err) => {
    logEvent('error', 'Fallo al encolar la sincronización con GitHub', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

function sendHtml(res: Response, file: string): void {
  const html = injectAdminToken(fs.readFileSync(file, 'utf-8'));
  if ((process.env.ADMIN_TOKEN || '').trim()) res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(html);
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
      next();
      return;
    }
    const started = Date.now();
    const requestPath = (req.originalUrl || req.path).split('?')[0];
    res.on('finish', () => {
      logEvent('info', 'request', {
        method: req.method,
        path: requestPath,
        status: res.statusCode,
        ms: Date.now() - started,
      });
    });
    next();
  });

  app.use((req, res, next) => {
    cors({
      origin(origin, callback) {
        if (isOriginAllowed(origin, req.header('host'))) callback(null, true);
        else callback(null, false);
      },
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-admin-token', 'Authorization', 'X-GitHub-Event', 'X-Hub-Signature-256'],
      maxAge: 600,
      optionsSuccessStatus: 204,
    })(req, res, next);
  });

  app.use(express.json({
    limit: process.env.JSON_BODY_LIMIT || '10mb',
    verify(req, _res, buf) {
      const url = req.url?.split('?')[0];
      if (url === '/api/github/webhook') rememberRawBody(req, Buffer.from(buf));
    },
  }));

  app.get('/health', (_req, res) => {
    const sync = getSyncStatus();
    res.json({
      ok: true,
      service: 'awesome-dev-toolkit',
      uptimeSec: Math.round(process.uptime()),
      githubSyncConfigured: sync.configured,
      syncPending: sync.pendingJournal,
      adminRequired: Boolean((process.env.ADMIN_TOKEN || '').trim()),
      catalogCached: isCatalogCached(),
    });
  });

  app.post('/api/github/webhook', (req, res) => {
    const secret = (process.env.GITHUB_WEBHOOK_SECRET || '').trim();
    if (!secret) {
      res.status(503).json({ success: false, error: 'GITHUB_WEBHOOK_SECRET no está configurado en el servidor.' });
      return;
    }
    const raw = readRawBody(req);
    if (!raw || !verifyGitHubSignature(raw, secret, req.get('x-hub-signature-256') || undefined)) {
      res.status(401).json({ success: false, error: 'Firma del webhook inválida.' });
      return;
    }
    const event = req.get('x-github-event') || '';
    if (event === 'ping') {
      res.json({ success: true, ignored: true, reason: 'ping' });
      return;
    }
    const payload = req.body as { ref?: string };
    const branch = (process.env.GITHUB_BRANCH || 'main').trim();
    if (event === 'push' && payload?.ref && payload.ref !== `refs/heads/${branch}`) {
      res.json({ success: true, ignored: true, reason: 'otra rama' });
      return;
    }
    void pullContentFromGitHub('webhook');
    res.status(202).json({ success: true, queued: true });
  });

  app.use('/api', requireAdmin);

  const aiLimiter = createRateLimiter({
    windowMs: positiveInt(process.env.AI_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
    max: positiveInt(process.env.AI_RATE_LIMIT_MAX, 30),
    name: 'ai',
  });

  app.get('/api/export/vault', (req, res) => {
    const since = parseSince(req.query.since);
    const batch = buildVaultExport(loadAllTools(), since);
    res.json(batch);
  });

  app.get('/api/tools', (_req, res) => {
    const tools = loadAllTools();
    res.json({ success: true, count: tools.length, tools });
  });

  app.get('/api/authors', (_req, res) => {
    const authors = loadAllAuthorProfiles();
    res.json({ success: true, count: Object.keys(authors).length, authors });
  });

  app.get('/api/categories', (_req, res) => {
    const categories = getAllCategories();
    res.json({ success: true, count: categories.length, categories });
  });

  app.post('/api/categories', (req, res) => {
    const input = parseCategoryBody(req.body);
    const created = addCustomCategory(input);
    refreshReadme();
    queueSync(`chore(categories): añadir categoría ${created.name}`);
    res.json({ success: true, category: created, categories: getAllCategories() });
  });

  app.delete('/api/categories/:name', (req, res) => {
    const name = parseCategoryName(routeParam(req.params.name));
    try {
      deleteCustomCategory(name);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'No se pudo eliminar la categoría.');
    }
    refreshReadme();
    queueSync(`chore(categories): eliminar categoría ${name}`);
    res.json({ success: true, categories: getAllCategories() });
  });

  app.get('/api/ai/status', (_req, res) => {
    res.json({
      success: true,
      activeProvider: getActivePrimaryProviderName(),
      allConfigured: getConfiguredProvidersList(),
      githubSyncConfigured: isGitHubSyncConfigured(),
    });
  });

  app.post('/api/authors/analyze', aiLimiter, async (req, res) => {
    const { authorName, authorHandle, aiProvider } = parseAuthorAnalyzeBody(req.body);
    const { profile, providerUsed, switchNotice } = await analyzeAuthorWithAI(authorName, authorHandle, aiProvider);
    queueSync(`chore(authors): analizar perfil de ${authorName}`);
    res.json({ success: true, profile, providerUsed, switchNotice });
  });

  app.post('/api/ingest', aiLimiter, async (req, res) => {
    const input = parseIngestBody(req.body);
    logEvent('info', 'ingesta', {
      url: input.url,
      urls: input.urls?.length || 0,
      provider: input.aiProvider || 'auto',
    });
    const result = await ingestResource(input);
    refreshReadme();
    if (result.addedCount > 0) {
      queueSync(`chore(catalog): guardar ${result.addedCount} recurso(s) analizado(s)`);
    }
    res.json({ success: true, data: result, tools: loadAllTools() });
  });

  app.post('/api/tools/restore', (req, res) => {
    const tools = parseRestoreBody(req.body);
    if (tools.length === 0) {
      res.json({ success: true, restoredCount: 0, updatedCount: 0, tools: loadAllTools() });
      return;
    }
    const { restoredCount, updatedCount } = restoreToolNotes(
      tools as unknown as Parameters<typeof restoreToolNotes>[0]
    );
    if (restoredCount > 0 || updatedCount > 0) {
      refreshReadme();
      logEvent('info', 'fichas restauradas desde el respaldo del navegador', { restoredCount, updatedCount });
      queueSync(`chore(catalog): restaurar ${restoredCount} ficha(s) en el repositorio`);
    }
    res.json({ success: true, restoredCount, updatedCount, tools: loadAllTools() });
  });

  app.post('/api/sync/push', async (_req, res) => {
    if (!isGitHubSyncConfigured()) {
      throw new HttpError(400, 'GITHUB_TOKEN no está configurado en el servidor. Agrégalo en Render > Environment.');
    }
    const result = await syncCatalogToGitHubRepo('chore(catalog): sincronizar catálogo completo al repositorio');
    res.json({ success: result.synced, ...result });
  });

  app.post('/api/sync/pull', async (_req, res) => {
    const result = await pullContentFromGitHub('manual');
    res.json({ success: true, ...result, tools: loadAllTools() });
  });

  app.patch('/api/tools/:slug', (req, res) => {
    const slug = parseSlug(routeParam(req.params.slug));
    const patch = parseToolPatch(req.body);
    const ok = updateToolNote(slug, patch);
    if (!ok) throw new HttpError(404, 'Herramienta no encontrada');
    refreshReadme();
    queueSync(`chore(catalog): actualizar ficha ${slug}`);
    const updated = loadAllTools().find((tool) => tool.slug === slug);
    res.json({ success: true, message: 'Nota actualizada correctamente', tool: updated });
  });

  app.delete('/api/tools/:slug', (req, res) => {
    const slug = parseSlug(routeParam(req.params.slug));
    const ok = deleteToolNote(slug);
    if (!ok) throw new HttpError(404, 'Ficha no encontrada para eliminar');
    refreshReadme();
    queueSync(`chore(catalog): eliminar ficha ${slug}`);
    res.json({ success: true, message: `Ficha "${slug}" eliminada correctamente` });
  });

  app.post('/api/tools/batch-delete', (req, res) => {
    const slugs = parseBatchDelete(req.body);
    const result = deleteToolNotes(slugs);
    refreshReadme();
    if (result.deleted.length > 0) {
      queueSync(`chore(catalog): eliminar ${result.deleted.length} ficha(s)`);
    }
    res.json({
      success: true,
      deletedCount: result.deleted.length,
      deleted: result.deleted,
      notFound: result.notFound,
    });
  });

  app.post('/api/tools/:slug/thread', aiLimiter, async (req, res) => {
    const slug = parseSlug(routeParam(req.params.slug));
    const { rawText, aiProvider } = parseThreadBody(req.body);
    const tool = loadAllTools().find((item) => item.slug === slug);
    if (!tool) throw new HttpError(404, 'Recurso no encontrado');

    let inputContent = rawText;
    const xMatch = inputContent.match(/https?:\/\/(?:x|twitter)\.com\/(?:[a-zA-Z0-9_]+\/)?status\/\d+/i);
    if (xMatch) {
      logEvent('info', 'obteniendo hilo de X', { slug });
      const threadRes = await fetchThreadTweetsFromX(xMatch[0], tool.frontmatter.author_handle);
      if (threadRes && (threadRes.rootTweet || threadRes.threadTweets.length > 0)) {
        const parts: string[] = [];
        if (threadRes.rootTweet && !inputContent.includes(threadRes.rootTweet.text)) {
          parts.push(threadRes.rootTweet.text);
        }
        for (const tweet of threadRes.threadTweets) parts.push(tweet.text);
        if (parts.length > 0) inputContent = parts.join('\n\n');
      }
    }

    let updatedContent = tool.content;
    const providerUsed = aiProvider || 'auto';
    try {
      const steps = await structureThreadStepsWithAI(tool.frontmatter.name, inputContent);
      if (steps && steps.length > 0) {
        const formattedMarkdown = steps
          .map((step, idx) => {
            let block = `### ${step.title || `Paso adicional ${idx + 1}`}\n`;
            if (step.prompt) block += `\`\`\`text\n${step.prompt}\n\`\`\`\n`;
            if (step.description) block += `${step.description}\n`;
            return block;
          })
          .join('\n');
        updatedContent = `${updatedContent}\n\n## 🧵 Tweets Adicionales del Hilo\n${formattedMarkdown}\n`;
      } else {
        updatedContent = `${updatedContent}\n\n## 🧵 Tweets Adicionales del Hilo\n${inputContent}\n`;
      }
    } catch (err) {
      logEvent('warn', 'No se pudo estructurar el hilo con IA; se adjunta el texto', {
        error: err instanceof Error ? err.message : String(err),
      });
      updatedContent = `${updatedContent}\n\n## 🧵 Tweets Adicionales del Hilo\n${inputContent}\n`;
    }

    updateToolNote(slug, { notes: updatedContent });
    refreshReadme();
    queueSync(`chore(catalog): anexar hilo a ${slug}`);
    const updated = loadAllTools().find((item) => item.slug === slug);
    res.json({ success: true, tool: updated, providerUsed });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'Ruta no encontrada.' });
  });

  const publicDir = path.resolve(process.cwd(), 'src/web/public');
  const pages: Record<string, string> = {
    '/': path.join(publicDir, 'index.html'),
    '/index.html': path.join(publicDir, 'index.html'),
    '/quick-save': path.join(publicDir, 'quick-save.html'),
    '/quick-save.html': path.join(publicDir, 'quick-save.html'),
    '/bookmarklet': path.resolve(process.cwd(), 'bookmarklet/install.html'),
    '/bookmarklet.html': path.resolve(process.cwd(), 'bookmarklet/install.html'),
  };
  app.get(Object.keys(pages), (req: Request, res: Response, next) => {
    const file = pages[req.path];
    if (!file || !fs.existsSync(file)) {
      next();
      return;
    }
    sendHtml(res, file);
  });

  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  app.use(express.static(publicDir));

  app.use(errorHandler);
  return app;
}
