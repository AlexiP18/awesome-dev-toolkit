import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { assignConjunto } from './classify_rules.js';
import { categoryOmitsConjunto, isTaxonomyCategory, normalizeTags } from './taxonomy.js';
import { ToolConjunto, ToolFrontmatter } from './types.js';

export { assignConjunto };

export function classifyToolConjunto(
  data: ToolFrontmatter,
  content: string,
  _dirName?: string
): { conjunto?: ToolConjunto; category?: string } {
  const summary = (content.match(/^>\s*(.+)$/m)?.[1] || '').trim();
  const category = isTaxonomyCategory(data.category) ? data.category : data.category;
  const conjunto = assignConjunto({
    category,
    conjunto: data.conjunto,
    entryType: data.entry_type,
    url: data.url,
    review: data.review === true || !isTaxonomyCategory(category),
  });
  return { conjunto: conjunto as ToolConjunto | undefined };
}

export function runClassificationMigration(): void {
  const rootDir = process.cwd();
  const dirs = ['tools', 'tips', 'jobs'].map((name) => ({
    name,
    path: path.resolve(rootDir, 'content', name),
  }));
  const stats: Record<string, number> = { codigo: 0, app: 0, inspiracion: 0, aprender: 0, consejos: 0, ninguno: 0 };
  let total = 0;

  for (const dir of dirs) {
    if (!fs.existsSync(dir.path)) continue;
    for (const file of fs.readdirSync(dir.path).filter((name) => name.endsWith('.md'))) {
      const filePath = path.join(dir.path, file);
      const parsed = matter(fs.readFileSync(filePath, 'utf-8'));
      const data = parsed.data as ToolFrontmatter;
      const conjunto = assignConjunto({
        category: data.category,
        conjunto: data.conjunto,
        entryType: data.entry_type,
        url: data.url,
        review: data.review === true,
      });
      if (conjunto) data.conjunto = conjunto as ToolConjunto;
      else if (categoryOmitsConjunto(data.category) || data.review) delete data.conjunto;
      data.tags = normalizeTags(data.tags, conjunto);
      stats[conjunto || 'ninguno'] += 1;
      fs.writeFileSync(filePath, matter.stringify(parsed.content, data), 'utf-8');
      total += 1;
    }
  }

  console.log(`[Classify] ${total} fichas con conjunto recalculado:`);
  for (const [key, value] of Object.entries(stats)) console.log(`  ${key}: ${value}`);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry.endsWith('classify_conjuntos.ts') || entry.endsWith('classify_conjuntos.js')) {
  runClassificationMigration();
}
