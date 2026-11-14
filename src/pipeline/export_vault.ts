import fs from 'fs';
import path from 'path';
import { loadAllTools } from './note_generator.js';
import { extractTweetId } from './twitter_scraper.js';
import { EntryType, ToolItem } from './types.js';

export interface VaultBookmarkItem {
  name: string;
  url: string;
  website_url: string | null;
  category: string;
  conjunto: string | null;
  tags: string[];
  summary: string;
  highlights: string[];
  entry_type: EntryType | string;
}

export interface VaultBookmark {
  tweet_id: string;
  text: string;
  author_name: string | null;
  author_handle: string | null;
  created_at: string;
  urls: string[];
  note_tweet: string | null;
  items: VaultBookmarkItem[];
}

export function extractSummary(content: string): string {
  const match = (content || '').match(/^>\s*(.+)$/m);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

export function extractHighlights(content: string): string[] {
  const highlights: string[] = [];
  let inSection = false;
  for (const line of (content || '').split('\n')) {
    if (/^## /.test(line)) {
      if (inSection) break;
      inSection = /destaca|puntos clave|requisitos|especificaciones|caracter[ií]sticas/i.test(line);
      continue;
    }
    if (!inSection) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+)/);
    if (bullet) highlights.push(bullet[1].trim());
    const heading = line.match(/^###\s+(.+)/);
    if (heading) highlights.push(heading[1].trim());
  }
  return highlights;
}

export function extractPersonalNote(content: string): string | null {
  const match = (content || '').match(/## [^\n]*(Notas|Aplicación|Postulación)[^\n]*\n([\s\S]*?)(?=\n## |$)/i);
  if (!match) return null;
  const text = match[2].replace(/^[-*]\s+/gm, '').trim();
  if (!text || /pendiente de (probar|revisar|evaluar|recopilar|postular)/i.test(text)) return null;
  return text;
}

function noteTimestamp(tool: ToolItem): number {
  const fm = tool.frontmatter;
  const stamps = [fm.updated_at, fm.created_at, fm.date_added]
    .map((value) => (value ? new Date(value).getTime() : 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  return stamps.length ? Math.max(...stamps) : 0;
}

function toIso(value?: string): string {
  if (!value) return new Date(0).toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date(0).toISOString();
  return parsed.toISOString();
}

function uniqueUrls(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || value === '#') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function buildVaultExport(tools: ToolItem[], since?: string): VaultBookmark[] {
  const sinceMs = since ? new Date(since).getTime() : 0;
  const selected = tools.filter((tool) => !since || Number.isNaN(sinceMs) || noteTimestamp(tool) >= sinceMs);
  const groups = new Map<string, ToolItem[]>();

  for (const tool of selected) {
    const tweetId = extractTweetId(tool.frontmatter.source_tweet || '') || `note-${tool.slug}`;
    const list = groups.get(tweetId) || [];
    list.push(tool);
    groups.set(tweetId, list);
  }

  return [...groups.entries()].map(([tweetId, items]) => {
    const primary = [...items].sort((a, b) => (b.content || '').length - (a.content || '').length)[0];
    const summary = extractSummary(primary.content);
    const created = items
      .map((item) => item.frontmatter.created_at || item.frontmatter.date_added)
      .filter((value): value is string => Boolean(value))
      .sort()[0];

    return {
      tweet_id: tweetId,
      text: summary || primary.frontmatter.name,
      author_name: primary.frontmatter.author || null,
      author_handle: primary.frontmatter.author_handle?.replace(/^@/, '') || null,
      created_at: toIso(created),
      urls: uniqueUrls(items.flatMap((item) => [item.frontmatter.url, item.frontmatter.website_url])),
      note_tweet: extractPersonalNote(primary.content),
      items: items.map((item) => ({
        name: item.frontmatter.name,
        url: item.frontmatter.url,
        website_url: item.frontmatter.website_url || null,
        category: item.frontmatter.category,
        conjunto: item.frontmatter.conjunto || null,
        tags: item.frontmatter.tags || [],
        summary: extractSummary(item.content),
        highlights: extractHighlights(item.content),
        entry_type: item.frontmatter.entry_type || 'tool',
      })),
    };
  });
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function main() {
  const since = argValue('--since');
  const out = argValue('--out');
  const batch = buildVaultExport(loadAllTools(), since);
  const json = JSON.stringify(batch, null, 2);
  if (out) {
    const target = path.resolve(process.cwd(), out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json + '\n', 'utf-8');
    console.log(`[Export] ${batch.length} bookmark(s) en ${target}`);
    return;
  }
  process.stdout.write(json + '\n');
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry.endsWith('export_vault.ts') || entry.endsWith('export_vault.js')) {
  main();
}
