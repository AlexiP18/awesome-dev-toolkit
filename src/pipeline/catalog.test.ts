import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import matter from 'gray-matter';
import { groupDuplicateTools } from './dedup_groups.js';
import { buildVaultExport, extractHighlights, extractSummary } from './export_vault.js';
import {
  cleanFrontmatter,
  createOrUpdateToolNote,
  createOrUpdateToolNoteLocked,
  findExistingTool,
  loadAllTools,
  resolveEntryType,
} from './note_generator.js';
import { ToolItem } from './types.js';
import { canonicalUrlKey, namesLookLikeSameProduct, sameProduct } from './url_normalize.js';

function fakeTool(partial: Partial<ToolItem> & { slug: string; url: string; name: string }): ToolItem {
  return {
    slug: partial.slug,
    filePath: partial.filePath || `/tmp/${partial.slug}.md`,
    content: partial.content || `> Resumen de ${partial.name}\n`,
    frontmatter: {
      name: partial.name,
      url: partial.url,
      website_url: partial.frontmatter?.website_url,
      category: partial.frontmatter?.category || 'Frontend & UI',
      tags: partial.frontmatter?.tags || ['ui'],
      status: 'to_try',
      date_added: '2026-11-01',
      ...partial.frontmatter,
    },
  };
}

test('canonicalUrlKey ignora protocolo, www, barra, tracking y la caja de GitHub', () => {
  const repo = canonicalUrlKey('https://www.GitHub.com/Astral-Sh/UV.git/?utm_source=x&ref=twitter#readme');
  assert.equal(repo, 'github.com/astral-sh/uv');
  assert.equal(canonicalUrlKey('http://blender.org/'), canonicalUrlKey('https://www.blender.org'));
  assert.equal(canonicalUrlKey('https://jiro.build/?fbclid=abc#top'), 'jiro.build');
  assert.equal(canonicalUrlKey('https://x.com/someone'), '');
  assert.equal(canonicalUrlKey('null'), '');
});

test('sameProduct une repo y landing, y no une un subproducto con la marca', () => {
  assert.equal(
    sameProduct(
      { url: 'https://github.com/pingdotgg/t3code', name: 't3code' },
      { url: 'https://t3.codes/', name: 'T3 Code' }
    ),
    true
  );
  assert.equal(
    sameProduct(
      { url: 'https://github.com/blender/blender', name: 'Blender' },
      { url: 'http://www.blender.org/', name: 'blender.org' }
    ),
    true
  );
  assert.equal(
    sameProduct(
      { url: 'https://styles.refero.design/', website: 'https://refero.design/', name: 'Refero Styles' },
      { url: 'https://refero.design/', name: 'Refero' }
    ),
    false
  );
  assert.equal(
    sameProduct(
      { url: 'https://github.com/motiondivision/motion', name: 'Motion' },
      { url: 'https://www.motionkitui.com/', name: 'MotionKit' }
    ),
    false
  );
  assert.equal(
    sameProduct(
      { url: 'https://github.com/motiondivision/ai-kit', website: 'https://motion.dev/', name: 'Motion AI Kit' },
      { url: 'https://github.com/motiondivision/motion', website: 'https://motion.dev/', name: 'Motion' }
    ),
    false
  );
});

test('findExistingTool detecta la misma URL canónica y el website del repo', () => {
  const catalog = [
    fakeTool({
      slug: 'excalidraw',
      name: 'Excalidraw',
      url: 'https://github.com/excalidraw/excalidraw',
      frontmatter: { website_url: 'https://excalidraw.com/', name: 'Excalidraw', url: 'https://github.com/excalidraw/excalidraw', category: 'Frontend & UI', tags: [], status: 'to_try', date_added: '2026-11-01' },
    }),
    fakeTool({ slug: 'motionin', name: 'Motionin', url: 'https://motionin.design/' }),
  ];

  const byLanding = findExistingTool({ url: 'https://www.excalidraw.com/?ref=x' }, catalog);
  assert.equal(byLanding?.slug, 'excalidraw');

  const byRepoCase = findExistingTool({ url: 'https://github.com/Excalidraw/Excalidraw/tree/master' }, catalog);
  assert.equal(byRepoCase?.slug, 'excalidraw');

  const sameSite = findExistingTool({ url: 'https://www.motionin.design' }, catalog);
  assert.equal(sameSite?.slug, 'motionin');

  const other = findExistingTool({ url: 'https://godly.website/', name: 'Godly' }, catalog);
  assert.equal(other, undefined);
});

test('nombres distintos no se fusionan aunque compartan URL', () => {
  assert.equal(namesLookLikeSameProduct('Motionin', 'Motion in Design'), true);
  assert.equal(namesLookLikeSameProduct('Be UI', 'BeUI'), true);
  assert.equal(namesLookLikeSameProduct('3D Icons', '3Dicons'), true);
  assert.equal(namesLookLikeSameProduct('cmux', 'shaper'), false);
  assert.equal(namesLookLikeSameProduct('OpenShorts', 'MoneyPrinterTurbo'), false);
  assert.equal(namesLookLikeSameProduct('ClawRouter', 'context-mode (clawrouter)'), false);

  const shared = 'https://github.com/taleshape-com/shaper';
  assert.equal(
    sameProduct({ url: shared, name: 'cmux' }, { url: shared, name: 'shaper' }),
    false
  );
  const groups = groupDuplicateTools([
    fakeTool({ slug: 'cmux', name: 'cmux', url: shared }),
    fakeTool({ slug: 'shaper', name: 'shaper', url: shared }),
    fakeTool({ slug: 'a', name: 'Motionin', url: 'https://motionin.design/' }),
    fakeTool({ slug: 'b', name: 'Motion in Design', url: 'https://www.motionin.design/' }),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((tool) => tool.slug).sort(), ['a', 'b']);
});

test('groupDuplicateTools agrupa solo el mismo producto', () => {
  const groups = groupDuplicateTools([
    fakeTool({ slug: 'a', name: 'Motionin', url: 'https://motionin.design/' }),
    fakeTool({ slug: 'b', name: 'Motion in Design', url: 'https://www.motionin.design/?utm_source=x' }),
    fakeTool({ slug: 'c', name: 'Otra', url: 'https://example.com/otra' }),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((tool) => tool.slug).sort(), ['a', 'b']);
});

test('cleanFrontmatter y resolveEntryType no guardan "null" ni pierden tech_product', () => {
  assert.equal(resolveEntryType('tech_product', 'Frontend & UI'), 'tech_product');
  assert.equal(resolveEntryType('product_showcase', 'Empresas & Productos'), 'product_showcase');
  assert.equal(resolveEntryType('tool', 'Productos Tecnológicos & Hardware'), 'tech_product');
  const cleaned = cleanFrontmatter({
    name: 'Pixel',
    url: 'https://pixelgui.com/',
    company: 'null',
    location: 'undefined',
    price: 'Gratis',
    tags: ['gui', 'null'],
    has_academic_promo: false,
  });
  assert.equal(cleaned.company, undefined);
  assert.equal(cleaned.location, undefined);
  assert.equal(cleaned.price, 'Gratis');
  assert.equal(cleaned.has_academic_promo, false);
  assert.deepEqual(cleaned.tags, ['gui']);
});

test('createOrUpdateToolNote hace round-trip de frontmatter y bloquea el doble guardado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-notes-'));
  const previous = process.env.CONTENT_DIR;
  process.env.CONTENT_DIR = dir;
  try {
    const created = createOrUpdateToolNote({
      classification: {
        name: 'Placa Demo',
        canonicalUrl: 'https://www.example.com/placa/?utm_source=x',
        category: 'IDEs & Development Software',
        tags: ['hardware'],
        oneLiner: 'Una placa de prueba para el catálogo.',
        keyHighlights: ['GPIO expuesto'],
        recommendedNotes: 'Revisar el pinout.',
        entryType: 'tech_product',
        company: 'null',
        location: 'null',
        price: 'null',
      },
    });

    const raw = fs.readFileSync(created.filePath, 'utf-8');
    const parsed = matter(raw);
    assert.equal(parsed.data.entry_type, 'tech_product');
    assert.equal(parsed.data.category, 'Productivity & Tools');
    assert.equal(parsed.data.company, undefined);
    assert.equal(parsed.data.location, undefined);
    assert.equal(parsed.data.price, undefined);
    assert.equal(parsed.data.url, 'https://example.com/placa');
    assert.match(parsed.content, /Una placa de prueba/);

    const loaded = loadAllTools().find((tool) => tool.slug === created.slug);
    assert.ok(loaded);
    assert.equal(loaded?.frontmatter.entry_type, 'tech_product');
    assert.equal(extractSummary(loaded?.content || ''), 'Una placa de prueba para el catálogo.');
    assert.deepEqual(extractHighlights(loaded?.content || ''), ['GPIO expuesto']);

    const again = await Promise.all([
      createOrUpdateToolNoteLocked({
        classification: {
          name: 'Placa Demo copia',
          canonicalUrl: 'http://example.com/placa',
          category: 'Productivity & Tools',
          tags: ['gpio'],
          oneLiner: 'duplicado',
          keyHighlights: [],
          recommendedNotes: '',
          entryType: 'tech_product',
        },
        sourceTweet: 'https://x.com/maker/status/1234567890123456789',
      }),
      createOrUpdateToolNoteLocked({
        classification: {
          name: 'Placa Demo otra',
          canonicalUrl: 'https://example.com/placa/',
          category: 'Productivity & Tools',
          tags: ['sbc'],
          oneLiner: 'duplicado 2',
          keyHighlights: [],
          recommendedNotes: '',
          entryType: 'tech_product',
        },
      }),
    ]);
    assert.equal(again.every((item) => item.slug === created.slug), true);
    const files = fs.readdirSync(path.join(dir, 'tools')).filter((file) => file.endsWith('.md'));
    assert.deepEqual(files, [`${created.slug}.md`]);

    const batch = buildVaultExport(loadAllTools(), '2026-01-01');
    assert.equal(batch.length, 1);
    assert.equal(batch[0].items[0].entry_type, 'tech_product');
    assert.equal(batch[0].items[0].summary.includes('placa'), true);
    assert.equal(batch[0].note_tweet, 'Revisar el pinout.');
  } finally {
    if (previous === undefined) delete process.env.CONTENT_DIR;
    else process.env.CONTENT_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
