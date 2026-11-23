import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test, { after, before, describe } from 'node:test';
import request from 'supertest';
import { invalidateCatalogCache } from '../pipeline/catalog_state.js';
import { createApp } from './app.js';
import { publicErrorMessage } from './http.js';
import { injectAdminToken } from './html.js';

const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-api-'));
const previous: Record<string, string | undefined> = {
  CONTENT_DIR: process.env.CONTENT_DIR,
  ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  CORS_ORIGINS: process.env.CORS_ORIGINS,
  AI_RATE_LIMIT_MAX: process.env.AI_RATE_LIMIT_MAX,
  AI_RATE_LIMIT_WINDOW_MS: process.env.AI_RATE_LIMIT_WINDOW_MS,
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
  SYNC_JOURNAL: process.env.SYNC_JOURNAL,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('API del catálogo', { concurrency: 1 }, () => {
  before(() => {
    process.env.CONTENT_DIR = contentDir;
    process.env.SYNC_JOURNAL = '0';
    delete process.env.ADMIN_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.CORS_ORIGINS;
    invalidateCatalogCache();
  });

  after(() => {
    restoreEnv();
    invalidateCatalogCache();
    fs.rmSync(contentDir, { recursive: true, force: true });
  });

  test('GET /health responde JSON sin datos sensibles', async () => {
    const res = await request(createApp()).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.service, 'awesome-dev-toolkit');
    assert.equal(res.body.adminRequired, false);
    assert.equal(JSON.stringify(res.body).includes('token'), false);
  });

  test('las rutas desconocidas y el JSON inválido responden error JSON en español', async () => {
    const app = createApp();
    const missing = await request(app).get('/api/no-existe');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.success, false);
    assert.match(missing.body.error, /no encontrada/i);

    const badJson = await request(app)
      .post('/api/ingest')
      .set('Content-Type', 'application/json')
      .send('{"url":');
    assert.equal(badJson.status, 400);
    assert.equal(badJson.body.success, false);
    assert.match(badJson.body.error, /JSON/);

    const since = await request(app).get('/api/export/vault?since=no-es-fecha');
    assert.equal(since.status, 400);
    assert.match(since.body.error, /since/);
  });

  test('valida los POST del catálogo sin llamar a la IA', async () => {
    const app = createApp();
    const ingest = await request(app).post('/api/ingest').send({ aiProvider: 'deepseek' });
    assert.equal(ingest.status, 400);
    assert.match(ingest.body.error, /url, urls, rawText o sourceTweet/);

    const badProvider = await request(app).post('/api/ingest').send({ url: 'https://example.com', aiProvider: 'foo bar' });
    assert.equal(badProvider.status, 400);

    const restore = await request(app).post('/api/tools/restore').send({ tools: { slug: 'x' } });
    assert.equal(restore.status, 400);

    const emptyRestore = await request(app).post('/api/tools/restore').send({ tools: [] });
    assert.equal(emptyRestore.status, 200);
    assert.equal(emptyRestore.body.restoredCount, 0);

    const category = await request(app).post('/api/categories').send({ name: '   ' });
    assert.equal(category.status, 400);

    const badColor = await request(app).post('/api/categories').send({ name: 'Nueva', color: 'rosa-fuerte' });
    assert.equal(badColor.status, 400);

    const batch = await request(app).post('/api/tools/batch-delete').send({ slugs: ['../etc/passwd'] });
    assert.equal(batch.status, 400);

    const thread = await request(app).post('/api/tools/demo/thread').send({ rawText: '   ' });
    assert.equal(thread.status, 400);

    const missingTool = await request(app).post('/api/tools/demo/thread').send({ rawText: 'un paso', aiProvider: 'deepseek' });
    assert.equal(missingTool.status, 404);

    const author = await request(app).post('/api/authors/analyze').send({ authorHandle: '@no_valido!' });
    assert.equal(author.status, 400);

    const patch = await request(app).patch('/api/tools/demo').send({ status: 'publicado' });
    assert.equal(patch.status, 400);

    const push = await request(app).post('/api/sync/push').send({});
    assert.equal(push.status, 400);
    assert.match(push.body.error, /GITHUB_TOKEN/);
  });

  test('el catálogo se cachea hasta que se invalida', async () => {
    const note = path.join(contentDir, 'tools', 'demo.md');
    fs.mkdirSync(path.dirname(note), { recursive: true });
    fs.writeFileSync(
      note,
      "---\nname: Demo\nurl: https://example.com/demo\ncategory: Other\ntags: []\nstatus: to_try\ndate_added: '2026-11-01'\n---\n\n> Hola\n",
      'utf-8'
    );
    invalidateCatalogCache();
    const app = createApp();
    const first = await request(app).get('/api/tools');
    assert.equal(first.status, 200);
    assert.equal(first.body.count, 1);
    fs.rmSync(note);
    const cached = await request(app).get('/api/tools');
    assert.equal(cached.body.count, 1);
    invalidateCatalogCache();
    const fresh = await request(app).get('/api/tools');
    assert.equal(fresh.body.count, 0);
  });

  test('ADMIN_TOKEN protege las mutaciones y quick-save lo inyecta', async () => {
    process.env.ADMIN_TOKEN = 'secreto-de-prueba';
    try {
      const app = createApp();
      const denied = await request(app).post('/api/categories').send({ name: 'Temporal' });
      assert.equal(denied.status, 401);
      assert.match(denied.body.error, /x-admin-token/);

      const stillPublic = await request(app).get('/api/tools');
      assert.equal(stillPublic.status, 200);

      const accepted = await request(app).post('/api/categories').set('x-admin-token', 'secreto-de-prueba').send({});
      assert.equal(accepted.status, 400);

      const bearer = await request(app).delete('/api/tools/demo').set('Authorization', 'Bearer secreto-de-prueba');
      assert.equal(bearer.status, 404);

      const page = await request(app).get('/quick-save');
      assert.equal(page.status, 200);
      assert.match(page.text, /data-adt-admin="1"/);
      assert.match(page.text, /x-admin-token/);
      assert.match(page.text, /secreto-de-prueba/);
      assert.equal(page.headers['cache-control'], 'no-store');

      const bookmarklet = await request(app).get('/bookmarklet');
      assert.equal(bookmarklet.status, 200);
      assert.match(bookmarklet.text, /x-admin-token/);
    } finally {
      delete process.env.ADMIN_TOKEN;
    }

    const openPage = await request(createApp()).get('/quick-save');
    assert.equal(openPage.text.includes('data-adt-admin'), false);
    const escaped = injectAdminToken('<head></head>');
    process.env.ADMIN_TOKEN = '</script><script>alert(1)</script>';
    try {
      const html = injectAdminToken('<head></head>');
      assert.equal(html.includes('</script><script>alert'), false);
      assert.match(html, /\\u003c/);
    } finally {
      delete process.env.ADMIN_TOKEN;
    }
    assert.equal(escaped.includes('data-adt-admin'), false);
  });

  test('CORS solo refleja orígenes propios o listados', async () => {
    process.env.CORS_ORIGINS = 'https://catalogo.ejemplo';
    try {
      const app = createApp();
      const evil = await request(app).get('/health').set('Origin', 'https://evil.example');
      assert.equal(evil.status, 200);
      assert.equal(evil.headers['access-control-allow-origin'], undefined);

      const allowed = await request(app).get('/health').set('Origin', 'https://catalogo.ejemplo');
      assert.equal(allowed.headers['access-control-allow-origin'], 'https://catalogo.ejemplo');

      const server = app.listen(0);
      try {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        const origin = `http://127.0.0.1:${port}`;
        const same = await fetch(`${origin}/health`, { headers: { Origin: origin } });
        assert.equal(same.headers.get('access-control-allow-origin'), origin);
      } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      }
    } finally {
      delete process.env.CORS_ORIGINS;
    }
  });

  test('limita las rutas de IA e ingesta', async () => {
    process.env.AI_RATE_LIMIT_MAX = '2';
    process.env.AI_RATE_LIMIT_WINDOW_MS = '60000';
    try {
      const app = createApp();
      assert.equal((await request(app).post('/api/ingest').send({})).status, 400);
      assert.equal((await request(app).post('/api/authors/analyze').send({})).status, 400);
      const limited = await request(app).post('/api/ingest').send({ url: 'https://example.com' });
      assert.equal(limited.status, 429);
      assert.match(limited.body.error, /Demasiadas solicitudes/);
      assert.ok(limited.headers['retry-after']);
    } finally {
      delete process.env.AI_RATE_LIMIT_MAX;
      delete process.env.AI_RATE_LIMIT_WINDOW_MS;
    }
  });

  test('el webhook exige firma y no abre el pull sin secreto', async () => {
    const app = createApp();
    const closed = await request(app)
      .post('/api/github/webhook')
      .set('Content-Type', 'application/json')
      .send({ zen: 'hola' });
    assert.equal(closed.status, 503);

    process.env.GITHUB_WEBHOOK_SECRET = 'whsec';
    try {
      const payload = JSON.stringify({ zen: 'hola' });
      const signature = `sha256=${crypto.createHmac('sha256', 'whsec').update(payload).digest('hex')}`;
      const bad = await request(app)
        .post('/api/github/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', 'sha256=00')
        .set('x-github-event', 'ping')
        .send(payload);
      assert.equal(bad.status, 401);

      const ok = await request(app)
        .post('/api/github/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signature)
        .set('x-github-event', 'ping')
        .send(payload);
      assert.equal(ok.status, 200);
      assert.equal(ok.body.ignored, true);
    } finally {
      delete process.env.GITHUB_WEBHOOK_SECRET;
    }
  });

  test('los errores 500 no devuelven secretos', () => {
    const parsed = publicErrorMessage(new Error('falló con Bearer ghp_abcdefghijklmnopqrstuvwxyz'));
    assert.equal(parsed.status, 500);
    assert.equal(parsed.error.includes('ghp_'), false);
  });
});
