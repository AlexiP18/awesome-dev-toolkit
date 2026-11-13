import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { groupDuplicateTools } from './dedup_groups.js';
import { coerceCategory } from './category_manager.js';
import { markRepoPathDeleted, unmarkRepoPathDeleted } from './github_sync.js';
import {
  cleanFrontmatter,
  isBlankishString,
  loadAllTools,
  resolveEntryType,
} from './note_generator.js';
import { ToolFrontmatter, ToolItem } from './types.js';
import { canonicalUrlKey, preferredDisplayUrl } from './url_normalize.js';

function isLiteralNull(value: unknown): boolean {
  return typeof value === 'string' && ['null', 'undefined'].includes(value.trim().toLowerCase());
}

function noteHasLiteralNull(data: Record<string, unknown>): boolean {
  return Object.values(data).some((value) => {
    if (isLiteralNull(value)) return true;
    return Array.isArray(value) && value.some((item) => isLiteralNull(item));
  });
}

function richness(tool: ToolItem): number {
  const fm = tool.frontmatter;
  const content = tool.content || '';
  let score = content.length;
  score += (fm.tags?.length || 0) * 40;
  score += fm.stars ? 250 : 0;
  score += Math.min(fm.stars || 0, 2000) / 20;
  score += fm.author ? 40 : 0;
  score += fm.website_url ? 30 : 0;
  score += (content.match(/^[-*] /gm) || []).length * 15;
  score += (content.match(/^### /gm) || []).length * 20;
  if ((fm.classified_by || '').toLowerCase().includes('fallback')) score -= 400;
  if ((fm.name || '').includes('www.') || (fm.name || '').includes('.org')) score -= 80;
  return score;
}

function unique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || isBlankishString(value)) continue;
    const trimmed = value.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function mergedFrontmatter(group: ToolItem[], winner: ToolItem): ToolFrontmatter {
  const tags = unique(group.flatMap((tool) => tool.frontmatter.tags || [])).map((tag) => tag.toLowerCase());
  const tweets = unique([
    winner.frontmatter.source_tweet,
    ...group.flatMap((tool) => [tool.frontmatter.source_tweet, ...(tool.frontmatter.source_tweets || [])]),
  ]);
  const urls = group.flatMap((tool) => [tool.frontmatter.url, tool.frontmatter.website_url]);
  const url = preferredDisplayUrl(urls) || winner.frontmatter.url;
  const website = preferredDisplayUrl(
    group
      .flatMap((tool) => [tool.frontmatter.website_url, tool.frontmatter.url])
      .filter((item) => item && preferredDisplayUrl([item]) !== url)
  );
  const category = coerceCategory(winner.frontmatter.category, winner.frontmatter.entry_type);
  const entryType = resolveEntryType(winner.frontmatter.entry_type, category);
  const stars = group.reduce((max, tool) => Math.max(max, tool.frontmatter.stars || 0), 0);

  return cleanFrontmatter({
    ...winner.frontmatter,
    url,
    website_url: website || undefined,
    category,
    entry_type: entryType,
    tags,
    stars: stars || winner.frontmatter.stars,
    source_tweet: tweets[0] || winner.frontmatter.source_tweet,
    source_tweets: tweets.length > 1 ? tweets : undefined,
    updated_at: new Date().toISOString(),
  }) as ToolFrontmatter;
}

function appendMissingTweets(body: string, tweets: string[]): string {
  const missing = tweets.filter((tweet) => tweet && !body.includes(tweet));
  if (!missing.length) return body.trim() + '\n';
  const lines = missing.map((tweet) => `- Tweet origen adicional: [Ver en X](${tweet})`).join('\n');
  return `${body.trim()}\n\n## Tweets de origen adicionales\n${lines}\n`;
}

export interface MergeStats {
  groups: number;
  filesRemoved: number;
  categoriesMigrated: number;
  entryTypesFixed: number;
  nullNotesCleaned: number;
  groupSummaries: string[];
}

export function applyCatalogRepair(dryRun = false): MergeStats {
  const tools = loadAllTools();
  const groups = groupDuplicateTools(tools);
  const removed = new Set<string>();
  const summaries: string[] = [];
  let categoriesMigrated = tools.filter((tool) => {
    const next = coerceCategory(tool.frontmatter.category, tool.frontmatter.entry_type);
    return next !== (tool.frontmatter.category || '').trim();
  }).length;
  const nullNotesCleaned = tools.filter((tool) =>
    noteHasLiteralNull(tool.frontmatter as unknown as Record<string, unknown>)
  ).length;

  for (const group of groups) {
    const ranked = [...group].sort((a, b) => richness(b) - richness(a));
    const winner = ranked[0];
    const losers = ranked.slice(1);
    const fm = mergedFrontmatter(group, winner);
    const body = appendMissingTweets(winner.content, fm.source_tweets || [fm.source_tweet || '']);
    summaries.push(
      `${group.length} → ${path.basename(winner.filePath)}  (fuera: ${losers.map((tool) => path.basename(tool.filePath)).join(', ')})`
    );
    if (!dryRun) {
      const fileContent = matter.stringify(body, fm);
      fs.writeFileSync(winner.filePath, fileContent, 'utf-8');
      unmarkRepoPathDeleted(winner.filePath);
      for (const loser of losers) {
        if (fs.existsSync(loser.filePath)) {
          fs.unlinkSync(loser.filePath);
          markRepoPathDeleted(loser.filePath);
        }
        removed.add(loser.filePath);
      }
    } else {
      for (const loser of losers) removed.add(loser.filePath);
    }
  }

  let entryTypesFixed = 0;
  const remaining = loadAllTools().filter((tool) => !removed.has(tool.filePath));

  for (const tool of remaining) {
    const current = fs.readFileSync(tool.filePath, 'utf-8');
    const disk = matter(current).data as ToolFrontmatter;
    const hadNull = noteHasLiteralNull(disk as unknown as Record<string, unknown>);
    const category = coerceCategory(disk.category, disk.entry_type);
    const entryType = resolveEntryType(disk.entry_type, category);
    const categoryChanged = category !== String(disk.category || '').trim();
    const entryChanged = entryType !== disk.entry_type;
    const redundantWebsite =
      Boolean(disk.website_url) && canonicalUrlKey(disk.website_url) === canonicalUrlKey(disk.url);
    if (!categoryChanged && !entryChanged && !hadNull && !redundantWebsite) continue;
    if (entryChanged) entryTypesFixed++;
    if (!dryRun) {
      const cleaned = cleanFrontmatter({
        ...disk,
        category,
        entry_type: entryType,
      });
      fs.writeFileSync(tool.filePath, matter.stringify(tool.content.trim() + '\n', cleaned), 'utf-8');
    }
  }

  return {
    groups: groups.length,
    filesRemoved: removed.size,
    categoriesMigrated,
    entryTypesFixed,
    nullNotesCleaned,
    groupSummaries: summaries,
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? '[Merge] Simulación (no escribe).' : '[Merge] Fusionando duplicados y reparando fichas...');
  const stats = applyCatalogRepair(dryRun);
  console.log(`\nGrupos fusionados: ${stats.groups}`);
  console.log(`Fichas eliminadas por duplicado: ${stats.filesRemoved}`);
  console.log(`Categorías migradas: ${stats.categoriesMigrated}`);
  console.log(`entry_type corregidos: ${stats.entryTypesFixed}`);
  console.log(`Fichas con "null" literal limpiadas: ${stats.nullNotesCleaned}`);
  console.log('\nGrupos:');
  for (const line of stats.groupSummaries) console.log(' - ' + line);

  if (!dryRun) {
    const { generateReadme } = await import('./generate_readme.js');
    fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), generateReadme(), 'utf-8');
    console.log('\n[Merge] README.md regenerado.');
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry.endsWith('merge_duplicates.ts') || entry.endsWith('merge_duplicates.js')) {
  main().catch((error) => {
    console.error('[Merge] Error:', error);
    process.exit(1);
  });
}
