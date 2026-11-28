import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import matter from 'gray-matter';
import { mapVaultCategory } from './category_manager.js';
import { VaultBookmark } from './export_vault.js';
import { importVaultBatch } from './import_vault_batch.js';
import { createOrUpdateToolNote, loadAllTools } from './note_generator.js';

function bookmark(partial: Partial<VaultBookmark> & Pick<VaultBookmark, 'tweet_id' | 'items'>): VaultBookmark {
  return {
    text: partial.text || 'Texto del tweet',
    author_name: partial.author_name ?? 'Ada',
    author_handle: partial.author_handle ?? 'ada',
    created_at: partial.created_at || '2026-11-01T00:00:00.000Z',
    urls: partial.urls || partial.items.map((item) => item.url),
    note_tweet: partial.note_tweet ?? null,
    tweet_id: partial.tweet_id,
    items: partial.items,
  };
}

test('mapVaultCategory acerca una categoría desconocida a la lista permitida', () => {
  assert.equal(mapVaultCategory('Frontend & UI'), 'Frontend & UI');
  assert.equal(mapVaultCategory('IDEs & Development Software'), 'Productivity & Tools');
  assert.equal(mapVaultCategory('Machine Learning Models'), 'AI & Machine Learning');
  assert.equal(mapVaultCategory('Remote hiring board'), 'Trabajo & Freelance');
  assert.equal(mapVaultCategory('Flujos de Trabajo', 'tool'), 'Agentes & Protocolo MCP');
  assert.equal(mapVaultCategory('Zzz desconocida', 'tech_tip'), 'Consejos & Buenas Prácticas');
});

test('import:vault crea, es idempotente, anexa el tweet y no fusiona otro producto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-import-'));
  const previous = process.env.CONTENT_DIR;
  process.env.CONTENT_DIR = dir;
  try {
    const batch = [
      bookmark({
        tweet_id: '2110000000000000001',
        note_tweet: 'Nota larga del bookmark.',
        items: [
          {
            name: 'Widget',
            url: 'https://github.com/acme/widget',
            website_url: 'https://widget.example',
            category: 'Machine Learning Models',
            conjunto: 'recursos',
            tags: ['llm'],
            summary: 'Un router de modelos para pruebas.',
            highlights: ['Enruta peticiones', 'Un solo endpoint'],
            entry_type: 'tool',
          },
          {
            name: 'Consejo de logs',
            url: 'https://example.com/logs',
            website_url: null,
            category: 'Consejos & Buenas Prácticas',
            conjunto: 'consejos',
            tags: ['logs'],
            summary: 'Cómo leer logs sin ruido.',
            highlights: ['Filtra por nivel'],
            entry_type: 'tech_tip',
          },
          {
            name: 'Vacante remota',
            url: 'https://jobs.example/remote',
            website_url: null,
            category: 'Remote hiring board',
            conjunto: 'recursos',
            tags: ['remoto'],
            summary: 'Puesto remoto de backend.',
            highlights: ['Contrato internacional'],
            entry_type: 'job_remote',
          },
        ],
      }),
    ];

    const dry = importVaultBatch(batch, { dryRun: true });
    assert.deepEqual(
      { created: dry.created, updated: dry.updated, skipped: dry.skipped, needsReview: dry.needsReview },
      { created: 3, updated: 0, skipped: 0, needsReview: 0 }
    );
    const markdownIn = (folder: string) => {
      const target = path.join(dir, folder);
      if (!fs.existsSync(target)) return [];
      return fs.readdirSync(target).filter((file) => file.endsWith('.md'));
    };
    assert.deepEqual(markdownIn('tools'), []);
    assert.deepEqual(markdownIn('tips'), []);
    assert.deepEqual(markdownIn('jobs'), []);
    assert.deepEqual(markdownIn('authors'), []);

    const first = importVaultBatch(batch);
    assert.deepEqual(
      { created: first.created, updated: first.updated, skipped: first.skipped, needsReview: first.needsReview },
      { created: 3, updated: 0, skipped: 0, needsReview: 0 }
    );
    assert.equal(fs.existsSync(path.join(dir, 'tools', 'widget.md')), true);
    assert.equal(fs.existsSync(path.join(dir, 'tips', 'consejo-de-logs.md')), true);
    assert.equal(fs.existsSync(path.join(dir, 'jobs', 'vacante-remota.md')), true);
    assert.equal(fs.existsSync(path.join(dir, 'authors', 'ada.md')), true);

    const widget = matter(fs.readFileSync(path.join(dir, 'tools', 'widget.md'), 'utf-8'));
    assert.equal(widget.data.category, 'AI & Machine Learning');
    assert.equal(widget.data.url, 'https://github.com/acme/widget');
    assert.equal(widget.data.website_url, 'https://widget.example/');
    assert.match(widget.content, /Un router de modelos/);
    assert.match(widget.content, /Nota larga del bookmark/);

    const authorBefore = fs.readFileSync(path.join(dir, 'authors', 'ada.md'), 'utf-8');
    const second = importVaultBatch(batch);
    assert.deepEqual(
      { created: second.created, updated: second.updated, skipped: second.skipped, needsReview: second.needsReview },
      { created: 0, updated: 0, skipped: 3, needsReview: 0 }
    );
    assert.equal(loadAllTools().length, 3);
    assert.equal(fs.readFileSync(path.join(dir, 'authors', 'ada.md'), 'utf-8'), authorBefore);

    const appended = importVaultBatch([
      bookmark({
        tweet_id: '2110000000000000002',
        author_handle: 'ada',
        items: [
          {
            name: 'Widget',
            url: 'https://www.github.com/acme/widget/',
            website_url: null,
            category: 'AI & Machine Learning',
            conjunto: 'recursos',
            tags: ['router'],
            summary: 'Un router de modelos para pruebas.',
            highlights: ['Enruta peticiones'],
            entry_type: 'tool',
          },
        ],
      }),
    ]);
    assert.equal(appended.updated, 1);
    assert.equal(appended.created, 0);
    assert.equal(fs.readdirSync(path.join(dir, 'tools')).filter((file) => file.endsWith('.md')).length, 1);
    const widgetAfter = matter(fs.readFileSync(path.join(dir, 'tools', 'widget.md'), 'utf-8'));
    const tweets = [widgetAfter.data.source_tweet, ...(widgetAfter.data.source_tweets || [])].join(' ');
    assert.match(tweets, /2110000000000000001/);
    assert.match(tweets, /2110000000000000002/);

    const review = importVaultBatch([
      bookmark({
        tweet_id: '2110000000000000003',
        items: [
          {
            name: 'cmux',
            url: 'https://github.com/acme/widget',
            website_url: null,
            category: 'CLI & Terminal',
            conjunto: 'recursos',
            tags: ['terminal'],
            summary: 'Otro producto con la URL equivocada.',
            highlights: [],
            entry_type: 'tool',
          },
        ],
      }),
    ]);
    assert.equal(review.needsReview, 1);
    assert.equal(review.created, 0);
    assert.equal(loadAllTools().length, 3);
    assert.match(review.review[0], /cmux/);
  } finally {
    if (previous === undefined) delete process.env.CONTENT_DIR;
    else process.env.CONTENT_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('import no pisa una ficha distinta que solo comparte el nombre', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-import-name-clash-'));
  const previous = process.env.CONTENT_DIR;
  process.env.CONTENT_DIR = dir;
  try {
    createOrUpdateToolNote({
      classification: {
        name: 'Buzz',
        canonicalUrl: 'https://github.com/block/buzz',
        category: 'Agentes & Protocolo MCP',
        tags: ['ai-agents'],
        oneLiner: 'Espacio de trabajo para agentes.',
        keyHighlights: ['Workspace de agentes'],
        recommendedNotes: 'Ficha original de Block.',
        entryType: 'tool',
      },
      sourceTweet: 'https://x.com/csaba_kissi/status/2086711629035524562',
      author: 'Csaba Kissi',
    });
    const before = fs.readFileSync(path.join(dir, 'tools', 'buzz.md'), 'utf-8');
    const stats = importVaultBatch([
      bookmark({
        tweet_id: '2121683585199440143',
        author_name: 'PA13L0',
        author_handle: 'Fluyeporlaweb',
        items: [
          {
            name: 'Buzz',
            url: 'https://github.com/chidiwilliams/buzz',
            website_url: null,
            category: 'Prompts, Art & Video',
            conjunto: 'recursos',
            tags: ['audio'],
            summary: 'Transcribe audio sin conexión.',
            highlights: ['Offline'],
            entry_type: 'tool',
          },
        ],
      }),
    ]);
    assert.equal(stats.needsReview, 1);
    assert.equal(stats.created, 0);
    assert.equal(stats.updated, 0);
    assert.match(stats.review[0], /chidiwilliams\/buzz/);
    assert.match(stats.review[0], /block\/buzz/);
    assert.equal(fs.readFileSync(path.join(dir, 'tools', 'buzz.md'), 'utf-8'), before);
    assert.equal(fs.readdirSync(path.join(dir, 'tools')).filter((file) => file.endsWith('.md')).length, 1);
  } finally {
    if (previous === undefined) delete process.env.CONTENT_DIR;
    else process.env.CONTENT_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('import no pisa un tweet que ya estaba en una ficha previa', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-import-existing-'));
  const previous = process.env.CONTENT_DIR;
  process.env.CONTENT_DIR = dir;
  try {
    createOrUpdateToolNote({
      classification: {
        name: 'Widget',
        canonicalUrl: 'https://github.com/acme/widget',
        category: 'AI & Machine Learning',
        tags: ['llm'],
        oneLiner: 'Ya estaba en el catálogo.',
        keyHighlights: ['Existente'],
        recommendedNotes: '',
        entryType: 'tool',
      },
      sourceTweet: 'https://x.com/ada/status/2110000000000000001',
      author: 'Ada',
    });
    const stats = importVaultBatch([
      bookmark({
        tweet_id: '2110000000000000001',
        items: [
          {
            name: 'Widget',
            url: 'https://github.com/Acme/Widget',
            website_url: null,
            category: 'AI & Machine Learning',
            conjunto: 'recursos',
            tags: ['llm'],
            summary: 'Ya estaba en el catálogo.',
            highlights: ['Existente'],
            entry_type: 'tool',
          },
        ],
      }),
    ]);
    assert.equal(stats.skipped, 1);
    assert.equal(stats.created, 0);
    assert.equal(stats.updated, 0);
  } finally {
    if (previous === undefined) delete process.env.CONTENT_DIR;
    else process.env.CONTENT_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('import no trata skills.sh como la landing de un repo ajeno llamado skills', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-import-skills-sh-'));
  const previous = process.env.CONTENT_DIR;
  process.env.CONTENT_DIR = dir;
  try {
    createOrUpdateToolNote({
      classification: {
        name: 'code-review (Sentry)',
        canonicalUrl: 'https://github.com/getsentry/skills',
        category: 'Agentes & Protocolo MCP',
        conjunto: 'consejos',
        tags: ['agent-skills', 'code-review'],
        oneLiner: 'Skill de Sentry para revisar código.',
        keyHighlights: ['Procedimiento de revisión'],
        recommendedNotes: 'Ficha de Sentry.',
        entryType: 'tool',
      },
      sourceTweet: 'https://x.com/saurav_tweets/status/2123724003781255599',
      author: 'Saurav',
    });
    const before = fs.readFileSync(path.join(dir, 'tools', 'code-review-sentry.md'), 'utf-8');
    const stats = importVaultBatch([
      bookmark({
        tweet_id: '2126235523513483528',
        author_name: 'Noah',
        author_handle: 'noahelhadedy',
        items: [
          {
            name: 'skills.sh',
            url: 'https://www.skills.sh/',
            website_url: null,
            category: 'Agentes & Protocolo MCP',
            conjunto: 'inspiracion',
            tags: ['agent-skills', 'claude'],
            summary: 'Directorio de agent skills.',
            highlights: ['Catálogo de skills de agentes'],
            entry_type: 'tool',
          },
        ],
      }),
    ]);
    assert.equal(stats.created, 1);
    assert.equal(stats.updated, 0);
    assert.equal(stats.needsReview, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'tools', 'code-review-sentry.md'), 'utf-8'), before);
    const skills = matter(fs.readFileSync(path.join(dir, 'tools', 'skillssh.md'), 'utf-8'));
    assert.equal(skills.data.url, 'https://skills.sh/');
    assert.equal(skills.data.name, 'skills.sh');
  } finally {
    if (previous === undefined) delete process.env.CONTENT_DIR;
    else process.env.CONTENT_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
