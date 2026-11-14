import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { assignConjunto, classifyCategory, isCodeHost, premapToolkitCategory } from './classify_rules.js';
import {
  areaIdForCategory,
  canonicalCategoryName,
  categoryOmitsConjunto,
  isTaxonomyCategory,
  normalizeTags,
  sectionForCategory,
} from './taxonomy.js';
import { ToolFrontmatter } from './types.js';

interface MappingNote {
  old_category?: string;
  old_conjunto?: string | null;
  entry_type?: string;
  new_area?: string | null;
  new_category?: string | null;
  new_conjunto?: string | null;
  review?: boolean;
}

interface Row {
  path: string;
  slug: string;
  old_category: string;
  old_conjunto: string;
  new_area: string;
  new_category: string;
  new_conjunto: string;
  review: boolean;
  rule_step: string;
  doubtful: string;
  url: string;
  vault_override: boolean;
}

function contentDirs(): Array<{ section: string; dir: string }> {
  const root = path.resolve(process.cwd(), 'content');
  return ['tools', 'tips', 'jobs'].map((section) => ({ section, dir: path.join(root, section) }));
}

function summaryOf(content: string): string {
  return (content.match(/^>\s*(.+)$/m)?.[1] || '').trim();
}

function loadMappingNotes(): { vault: Map<string, MappingNote>; toolkit: Map<string, MappingNote> } {
  const file = path.resolve(process.cwd(), 'data/mapping.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
    notes?: { vault?: Record<string, MappingNote>; toolkit?: Record<string, MappingNote> };
  };
  const toMap = (record: Record<string, MappingNote> | undefined) => {
    const map = new Map<string, MappingNote>();
    for (const [notePath, note] of Object.entries(record || {})) {
      map.set(path.basename(notePath, '.md'), note);
    }
    return map;
  };
  return { vault: toMap(parsed.notes?.vault), toolkit: toMap(parsed.notes?.toolkit) };
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildRows(): Row[] {
  const { vault, toolkit } = loadMappingNotes();
  const rows: Row[] = [];

  for (const { dir } of contentDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort()) {
      const filePath = path.join(dir, file);
      const parsed = matter(fs.readFileSync(filePath, 'utf-8'));
      const data = parsed.data as ToolFrontmatter;
      const slug = path.basename(file, '.md');
      const oldCategory = String(data.category || '');
      const oldConjunto = String(data.conjunto || '');
      const premapped = premapToolkitCategory(oldCategory);
      const outcome = isTaxonomyCategory(oldCategory) && !premapped.startsWith('SIN')
        ? classifyCategory({
            slug,
            category: isTaxonomyCategory(oldCategory) ? oldCategory : premapped,
            conjunto: oldConjunto,
            entryType: data.entry_type,
            tags: data.tags,
            name: data.name,
            summary: summaryOf(parsed.content),
            url: data.url,
          })
        : classifyCategory({
            slug,
            category: premapped,
            conjunto: oldConjunto,
            entryType: data.entry_type,
            tags: data.tags,
            name: data.name,
            summary: summaryOf(parsed.content),
            url: data.url,
          });

      let category = canonicalCategoryName(outcome.category) || '';
      let review = outcome.review || !category;
      let rule = outcome.ruleStep;
      let conjunto = assignConjunto({
        category,
        conjunto: oldConjunto,
        entryType: data.entry_type,
        url: data.url,
        review,
      });

      const hint = toolkit.get(slug);
      const shared = vault.get(slug);
      const doubts: string[] = [];
      const heuristicCategory = category;
      const heuristicConjunto = conjunto || '';
      if (hint) {
        const hintConjunto = hint.new_conjunto || '';
        const hintCategory = hint.new_category || '';
        if ((hintCategory || '') !== category || (hint.review === true) !== review || hintConjunto !== (conjunto || '')) {
          doubts.push(`simulación toolkit: ${hintCategory || '∅'}/${hintConjunto || '∅'}`);
        }
      } else {
        doubts.push('sin pista en mapping.notes.toolkit');
      }

      let vaultOverride = false;
      if (shared) {
        const vaultCategory = shared.new_category || '';
        const vaultConjunto = shared.new_conjunto || '';
        if (shared.review) {
          category = '';
          review = true;
          conjunto = undefined;
          rule = `${rule}+vault-review`;
          vaultOverride = true;
        } else if (shared.new_category) {
          if (vaultCategory !== heuristicCategory || vaultConjunto !== heuristicConjunto) vaultOverride = true;
          category = shared.new_category;
          review = false;
          conjunto = shared.new_conjunto || undefined;
          rule = `${rule}+vault`;
        }
        // La bóveda gana en las notas compartidas. La diferencia con la simulación del toolkit queda revisada.
        if (vaultOverride || shared.new_category) doubts.length = 0;
      }

      // Claude Code (el producto, no un curso) pasa a codigo solo si la url canónica es un repo.
      if (slug === 'claude-code' && !review && isCodeHost(data.url) && conjunto !== 'codigo') {
        doubts.push(`claude-code con repo: conjunto ${conjunto || '∅'} → codigo`);
        conjunto = 'codigo';
        rule = `${rule}+claude-code`;
      }

      if (categoryOmitsConjunto(category)) conjunto = undefined;

      rows.push({
        path: path.relative(process.cwd(), filePath),
        slug,
        old_category: oldCategory,
        old_conjunto: oldConjunto,
        new_area: review ? '' : areaIdForCategory(category) || shared?.new_area || '',
        new_category: category,
        new_conjunto: conjunto || '',
        review,
        rule_step: rule,
        doubtful: doubts.join(' | '),
        url: String(data.url || ''),
        vault_override: vaultOverride,
      });
    }
  }
  return rows;
}

function writeCsv(rows: Row[], target: string): void {
  const header = ['path', 'old_category', 'old_conjunto', 'new_area', 'new_category', 'new_conjunto', 'review', 'rule_step'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [row.path, row.old_category, row.old_conjunto, row.new_area, row.new_category, row.new_conjunto, String(row.review), row.rule_step]
        .map(csvCell)
        .join(',')
    );
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, lines.join('\n') + '\n', 'utf-8');
}

export function applyRows(rows: Row[]): { moved: number; updated: number } {
  let moved = 0;
  let updated = 0;
  for (const row of rows) {
    const filePath = path.resolve(process.cwd(), row.path);
    const parsed = matter(fs.readFileSync(filePath, 'utf-8'));
    const data = { ...(parsed.data as Record<string, unknown>) };
    const before = JSON.stringify(data);
    if (row.review || !row.new_category) {
      delete data.category;
      delete data.area;
      delete data.conjunto;
      data.review = true;
    } else {
      data.category = row.new_category;
      data.area = row.new_area;
      data.review = false;
      delete data.review;
      if (row.new_conjunto) data.conjunto = row.new_conjunto;
      else delete data.conjunto;
    }
    data.tags = normalizeTags(data.tags, row.new_conjunto || undefined);
    const changed = JSON.stringify(data) !== before;
    const section = row.new_category ? sectionForCategory(row.new_category) : 'tools';
    const destDir = path.resolve(process.cwd(), 'content', section);
    const dest = path.join(destDir, `${row.slug}.md`);
    fs.mkdirSync(destDir, { recursive: true });
    const body = parsed.content.endsWith('\n') ? parsed.content : `${parsed.content}\n`;
    fs.writeFileSync(filePath, matter.stringify(body, data), 'utf-8');
    if (path.resolve(dest) !== path.resolve(filePath)) {
      if (fs.existsSync(dest)) {
        console.warn(`[reclassify] no se mueve ${row.path}: ya existe ${path.relative(process.cwd(), dest)}`);
      } else {
        fs.renameSync(filePath, dest);
        moved += 1;
      }
    }
    if (changed) updated += 1;
  }
  return { moved, updated };
}

function counts(rows: Row[]): void {
  const areas = new Map<string, number>();
  const categories = new Map<string, number>();
  const conjuntos = new Map<string, number>();
  let review = 0;
  for (const row of rows) {
    if (row.review || !row.new_category) {
      review += 1;
      continue;
    }
    areas.set(row.new_area, (areas.get(row.new_area) || 0) + 1);
    categories.set(row.new_category, (categories.get(row.new_category) || 0) + 1);
    conjuntos.set(row.new_conjunto || '—', (conjuntos.get(row.new_conjunto || '—') || 0) + 1);
  }
  const print = (title: string, map: Map<string, number>) => {
    console.log(`\n${title}`);
    for (const [key, value] of [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      console.log(`  ${value}\t${key}`);
    }
  };
  console.log(`[reclassify] ${rows.length} notas, ${review} en revisión`);
  print('Áreas', areas);
  print('Categorías', categories);
  print('Conjuntos', conjuntos);
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const rows = buildRows();
  const report = path.resolve(process.cwd(), 'data/reclassify-report.csv');
  writeCsv(rows, report);
  const doubtful = rows.filter((row) => row.doubtful);
  console.log(`[reclassify] ${apply ? 'escritura' : 'simulación'} ${rows.length} notas`);
  console.log(`[reclassify] informe ${path.relative(process.cwd(), report)}`);
  const overrides = rows.filter((row) => row.vault_override).length;
  console.log(`[reclassify] notas alineadas con la bóveda por diferencia de tags: ${overrides}`);
  console.log(`[reclassify] casos a revisar: ${doubtful.length}`);
  for (const row of doubtful.slice(0, 80)) {
    console.log(`  ${row.path}: ${row.old_category} → ${row.new_category || '∅'}/${row.new_conjunto || '∅'} (${row.doubtful}) [${row.rule_step}]`);
  }
  if (doubtful.length > 80) console.log(`  ... y ${doubtful.length - 80} más`);
  counts(rows);
  if (apply) {
    const result = applyRows(rows);
    console.log(`[reclassify] actualizadas ${result.updated}, movidas de carpeta ${result.moved}`);
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry.endsWith('reclassify_notes.ts') || entry.endsWith('reclassify_notes.js')) {
  main();
}
