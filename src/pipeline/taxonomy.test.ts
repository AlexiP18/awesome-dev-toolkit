import assert from 'node:assert/strict';
import test from 'node:test';
import { LEGACY_ALIASES, categoryDefinitions, loadTaxonomy, taxonomySha256 } from './taxonomy.js';
import { mapVaultCategory } from './category_manager.js';
import { assignConjunto, classifyCategory, premapToolkitCategory } from './classify_rules.js';
import { conjuntoMatches, resolveLegacyFilters } from '../web/public/catalog-logic.js';

const APPROVED_SHA = '762c3abf8bd1036375e33fc4f402e129004f6cbb2410b6a11e62d7977351f099';

test('taxonomy.json conserva el hash aprobado', () => {
  const taxonomy = loadTaxonomy();
  assert.equal(taxonomy.version, '1.0.0');
  assert.equal(taxonomy.areas.length, 6);
  assert.equal(taxonomy.categories.length, 24);
  assert.equal(taxonomy.conjuntos.length, 5);
  assert.equal(taxonomy.legacy_categories.length, 19);
  assert.equal(taxonomySha256(), APPROVED_SHA);
});

test('las 24 categorías salen de taxonomy.json y ninguna es Other', () => {
  const names = categoryDefinitions().map((category) => category.name);
  assert.equal(names.length, 24);
  assert.equal(names.includes('Other'), false);
  assert.equal(categoryDefinitions().filter((category) => category.section === 'jobs').length, 4);
  assert.equal(categoryDefinitions().find((category) => category.name === 'Guías, tips & buenas prácticas')?.section, 'tips');
  assert.equal(categoryDefinitions().find((category) => category.name === 'Cursos, libros & rutas')?.section, 'tools');
});

test('mapVaultCategory es identidad en las 24 y alias en las 19 legacy', () => {
  for (const category of loadTaxonomy().categories) {
    assert.equal(mapVaultCategory(category.name), category.name);
  }
  assert.equal(LEGACY_ALIASES.length, 19);
  for (const alias of LEGACY_ALIASES) {
    assert.equal(mapVaultCategory(alias.old), alias.defaultNew);
    assert.equal(loadTaxonomy().legacy_categories.includes(alias.old), true);
  }
  assert.equal(mapVaultCategory('Zzz desconocida', 'tech_tip'), 'Guías, tips & buenas prácticas');
  assert.equal(mapVaultCategory(''), '');
});

test('las reglas separan frontend, empleos y la bandeja', () => {
  const review = classifyCategory({
    slug: 'revisar-bookmark-1',
    category: 'Productivity & Tools',
    tags: [],
    name: 'revisar',
    summary: '',
  });
  assert.equal(review.review, true);

  const icons = classifyCategory({
    slug: 'lucide',
    category: premapToolkitCategory('Frontend & UI'),
    tags: ['icons', 'svg'],
    name: 'Lucide',
    summary: 'iconos',
    conjunto: 'recursos',
  });
  assert.equal(icons.category, 'Recursos gráficos');

  const job = classifyCategory({
    slug: 'scale-ai',
    category: 'Trabajo & Freelance',
    entryType: 'job_remote',
    tags: ['remoto'],
    name: 'Scale',
    summary: 'anotación',
  });
  assert.equal(job.category, 'Entrenamiento de IA & microtareas');
  assert.equal(assignConjunto({ category: job.category, entryType: 'job_remote', url: 'https://scale.com' }), undefined);

  const repo = assignConjunto({
    category: 'Componentes & frameworks UI',
    conjunto: 'recursos',
    url: 'https://github.com/acme/ui',
  });
  assert.equal(repo, 'codigo');

  const credits = assignConjunto({
    category: 'Créditos, planes gratis & programas',
    url: 'https://cloud.example/credits',
  });
  assert.equal(credits, 'app');
});

test('un filtro legacy de categoría se reescribe y recursos sigue cubriendo codigo y app', () => {
  const tables = {
    aliases: { 'frontend & ui': 'Componentes & frameworks UI' },
    legacySections: { jobs: { area: 'trabajo-oportunidades' }, tips: { category: 'Guías, tips & buenas prácticas' } },
    legacyConjuntos: { producto: 'app', recursos: ['codigo', 'app'] },
  };
  const category = resolveLegacyFilters({ cat: 'Frontend & UI', conjunto: 'producto', section: 'jobs' }, tables);
  assert.equal(category.cat, 'Componentes & frameworks UI');
  assert.equal(category.conjunto, 'app');
  assert.equal(category.area, 'trabajo-oportunidades');
  assert.equal(category.rewritten, true);
  assert.equal(conjuntoMatches('codigo', 'recursos'), true);
  assert.equal(conjuntoMatches('inspiracion', 'recursos'), false);
  assert.equal(conjuntoMatches('app', 'producto'), true);
});
