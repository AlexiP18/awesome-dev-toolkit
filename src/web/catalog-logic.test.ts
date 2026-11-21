import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrlKey, flagToolsNeedingReview, namesLookLikeSameProduct, pageWindow, sortTools } from './public/catalog-logic.js';

test('la URL canónica ignora www, barra final y parámetros de seguimiento', () => {
  assert.equal(
    canonicalUrlKey('http://www.github.com/Manaflow-AI/cmux/?utm_source=x&ref=tweet'),
    canonicalUrlKey('https://github.com/manaflow-ai/cmux')
  );
});

test('marca revisión cuando la misma URL pertenece a productos distintos', () => {
  const flags = flagToolsNeedingReview([
    { slug: 'cmux', frontmatter: { name: 'cmux', url: 'https://github.com/manaflow-ai/cmux' } },
    { slug: 'shaper', frontmatter: { name: 'shaper', url: 'https://github.com/manaflow-ai/cmux/' } },
  ]);
  assert.equal(typeof flags.cmux, 'string');
  assert.equal(typeof flags.shaper, 'string');
  assert.match(flags.cmux, /productos distintos/);
});

test('no marca revisión cuando los nombres son el mismo producto', () => {
  assert.equal(namesLookLikeSameProduct('Motionin', 'Motion in'), true);
  const flags = flagToolsNeedingReview([
    { slug: 'a', frontmatter: { name: 'Motionin', url: 'https://github.com/acme/motionin' } },
    { slug: 'b', frontmatter: { name: 'Motion in', url: 'https://github.com/acme/motionin?utm_source=x' } },
  ]);
  assert.deepEqual(flags, {});
});

test('respeta needs_review explícito en la ficha', () => {
  const flags = flagToolsNeedingReview([
    { slug: 'solo', content: 'nota', frontmatter: { name: 'Solo', url: 'https://example.com', needs_review: true } },
  ]);
  assert.match(flags.solo, /revisión manual/);
});

test('ordena por nombre y pagina sin salirse del total', () => {
  const sorted = sortTools([
    { frontmatter: { name: 'zeta', stars: 1, date_added: '2026-01-02' } },
    { frontmatter: { name: 'alfa', stars: 9, date_added: '2026-01-01' } },
  ], 'name');
  assert.equal(sorted[0].frontmatter.name, 'alfa');
  assert.deepEqual(pageWindow(50, 9, 24), { pages: 3, page: 3, start: 48, end: 50 });
  assert.equal(pageWindow(10, 4, 24).page, 1);
});
