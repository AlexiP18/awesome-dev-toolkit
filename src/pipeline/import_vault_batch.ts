import fs from 'fs';
import path from 'path';
import { ensureAuthorStub } from './author_manager.js';
import { mapVaultCategory } from './category_manager.js';
import { VaultBookmark, VaultBookmarkItem } from './export_vault.js';
import { createOrUpdateToolNote, loadAllTools } from './note_generator.js';
import { ClassificationResult, EntryType, ToolConjunto, ToolItem } from './types.js';
import { canonicalUrlKey, namesLookLikeSameProduct, preferredDisplayUrl } from './url_normalize.js';

const ENTRY_TYPES = new Set<EntryType>(['tool', 'product_showcase', 'tech_tip', 'job_remote', 'tech_product']);
const CONJUNTOS = new Set<ToolConjunto>(['recursos', 'inspiracion', 'producto', 'consejos']);

export interface ImportVaultStats {
  created: number;
  updated: number;
  skipped: number;
  needsReview: number;
  review: string[];
}

export interface ImportVaultOptions {
  dryRun?: boolean;
}

function blank(value: unknown): string {
  if (value == null) return '';
  const text = String(value).trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return '';
  return text;
}

function sourceTweetFromBookmark(bookmark: VaultBookmark): string | undefined {
  const id = blank(bookmark.tweet_id);
  if (!/^\d{10,}$/.test(id)) return undefined;
  const handle = blank(bookmark.author_handle).replace(/^@/, '');
  return handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`;
}

function tweetStatusId(url?: string): string {
  return url?.match(/\/status\/(\d{10,})/)?.[1] || '';
}

function tweetAlreadyRecorded(tool: ToolItem, tweet?: string): boolean {
  if (!tweet) return true;
  const incoming = tweetStatusId(tweet);
  const known = [tool.frontmatter.source_tweet, ...(tool.frontmatter.source_tweets || [])];
  return known.some((existing) => {
    if (!existing) return false;
    if (existing === tweet) return true;
    return Boolean(incoming) && tweetStatusId(existing) === incoming;
  });
}

function sharesCanonicalUrl(item: VaultBookmarkItem, tool: ToolItem): boolean {
  const incoming = [canonicalUrlKey(item.url), canonicalUrlKey(item.website_url)].filter(Boolean);
  const existing = [canonicalUrlKey(tool.frontmatter.url), canonicalUrlKey(tool.frontmatter.website_url)].filter(Boolean);
  return incoming.some((key) => existing.includes(key));
}

function entryTypeOf(raw: string | undefined, category: string): EntryType {
  const requested = blank(raw) as EntryType;
  if (ENTRY_TYPES.has(requested)) return requested;
  if (category === 'Trabajo & Freelance') return 'job_remote';
  if (category === 'Consejos & Buenas Prácticas') return 'tech_tip';
  if (category === 'Productos Tecnológicos & Hardware') return 'tech_product';
  if (category === 'Empresas & Productos') return 'product_showcase';
  return 'tool';
}

function conjuntoOf(raw: string | null | undefined, entryType: EntryType): ToolConjunto | undefined {
  const value = blank(raw).toLowerCase() as ToolConjunto;
  if (CONJUNTOS.has(value)) return value;
  if (entryType === 'tech_tip') return 'consejos';
  if (entryType === 'tech_product' || entryType === 'product_showcase') return 'producto';
  return undefined;
}

function toClassification(item: VaultBookmarkItem, bookmark: VaultBookmark): ClassificationResult {
  const entryHint = blank(item.entry_type);
  const category = mapVaultCategory(item.category, entryHint);
  const entryType = entryTypeOf(entryHint, category);
  const url = preferredDisplayUrl([item.url, item.website_url]) || blank(item.url);
  const website = preferredDisplayUrl([item.website_url]);
  return {
    name: blank(item.name) || 'Recurso importado',
    canonicalUrl: url,
    websiteUrl: website && canonicalUrlKey(website) !== canonicalUrlKey(url) ? website : undefined,
    category,
    conjunto: conjuntoOf(item.conjunto, entryType),
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => blank(tag).toLowerCase()).filter(Boolean) : [],
    oneLiner: blank(item.summary) || blank(bookmark.text) || 'Recurso importado desde el vault.',
    keyHighlights: Array.isArray(item.highlights) ? item.highlights.map((line) => blank(line)).filter(Boolean) : [],
    recommendedNotes: blank(bookmark.note_tweet),
    entryType,
  };
}

function remember(catalog: ToolItem[], fresh: ToolItem | undefined): void {
  if (!fresh) return;
  const index = catalog.findIndex((tool) => tool.filePath === fresh.filePath || tool.slug === fresh.slug);
  if (index >= 0) catalog[index] = fresh;
  else catalog.push(fresh);
}

/**
 * Escribe el lote del vault en content/. No llama a ningún modelo ni descarga páginas.
 * La segunda pasada del mismo archivo no crea fichas: el tweet ya guardado se omite.
 */
export function importVaultBatch(bookmarks: VaultBookmark[], options: ImportVaultOptions = {}): ImportVaultStats {
  const dryRun = Boolean(options.dryRun);
  const stats: ImportVaultStats = { created: 0, updated: 0, skipped: 0, needsReview: 0, review: [] };
  const catalog = loadAllTools();

  for (const bookmark of bookmarks || []) {
    const items = Array.isArray(bookmark?.items) ? bookmark.items : [];
    const tweet = sourceTweetFromBookmark(bookmark);
    let touchedAuthor = false;

    for (const item of items) {
      const name = blank(item?.name);
      const url = blank(item?.url) || blank(item?.website_url);
      if (!name || !url) {
        stats.needsReview += 1;
        stats.review.push(`falta nombre o url (tweet ${blank(bookmark?.tweet_id) || 'sin id'})`);
        continue;
      }

      const urlMatches = catalog.filter((tool) => sharesCanonicalUrl(item, tool));
      const sameName = urlMatches.filter((tool) => namesLookLikeSameProduct(name, tool.frontmatter.name));
      if (urlMatches.length > 0 && sameName.length === 0) {
        stats.needsReview += 1;
        const other = urlMatches[0];
        stats.review.push(
          `${name} <${url}> comparte URL con ${other.frontmatter.name} <${other.frontmatter.url}> y el nombre no coincide`
        );
        continue;
      }

      const existing = sameName[0];
      if (existing && tweetAlreadyRecorded(existing, tweet)) {
        stats.skipped += 1;
        continue;
      }

      const classification = toClassification(item, bookmark);
      const authorName = blank(bookmark.author_name) || undefined;
      if (existing) stats.updated += 1;
      else stats.created += 1;

      if (dryRun) {
        const statusId = tweetStatusId(tweet);
        const prior = existing?.frontmatter;
        const tweets = [prior?.source_tweet, ...(prior?.source_tweets || []), tweet].filter((value): value is string => Boolean(value));
        const uniqueTweets = [...new Set(tweets)];
        remember(catalog, {
          slug: existing?.slug || `pending-${stats.created + stats.updated}`,
          filePath: existing?.filePath || `pending://${name}`,
          content: existing?.content || `> ${classification.oneLiner}\n`,
          frontmatter: {
            ...(prior || {
              status: 'to_try',
              date_added: (bookmark.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
              tags: classification.tags,
            }),
            name: prior?.name || classification.name,
            url: classification.canonicalUrl,
            website_url: classification.websiteUrl,
            category: classification.category,
            conjunto: classification.conjunto,
            entry_type: classification.entryType,
            tags: classification.tags,
            source_tweet: uniqueTweets[0],
            source_tweets: uniqueTweets.length > 1 ? uniqueTweets : undefined,
            author: authorName,
            author_handle: blank(bookmark.author_handle).replace(/^@/, '') || undefined,
          },
        });
      } else {
        const written = createOrUpdateToolNote(
          {
            classification,
            sourceTweet: tweet,
            author: authorName,
            providerUsed: 'Importado del vault',
          },
          catalog
        );
        const fresh = loadAllTools().find((tool) => tool.slug === written.slug || tool.filePath === written.filePath);
        remember(catalog, fresh);
        if (!touchedAuthor && (authorName || blank(bookmark.author_handle))) {
          ensureAuthorStub({ name: authorName, handle: bookmark.author_handle });
          touchedAuthor = true;
        }
      }
    }
  }

  return stats;
}

function printStats(fileLabel: string, dryRun: boolean, stats: ImportVaultStats): void {
  console.log(`[Import vault] ${dryRun ? 'simulación' : 'escritura'} ${fileLabel}`);
  console.log(`created: ${stats.created}`);
  console.log(`updated: ${stats.updated}`);
  console.log(`skipped: ${stats.skipped}`);
  console.log(`needs-review: ${stats.needsReview}`);
  for (const line of stats.review) console.log(`review: ${line}`);
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const fileArg = process.argv.slice(2).find((arg) => arg !== '--dry-run' && !arg.startsWith('-'));
  if (!fileArg) {
    console.error('Uso: npm run import:vault -- <archivo.json> [--dry-run]');
    process.exit(1);
  }
  const target = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(target)) {
    console.error(`No existe el archivo: ${target}`);
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
  } catch (error) {
    console.error(`JSON inválido: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error('El archivo debe ser un arreglo JSON de bookmarks.');
    process.exit(1);
  }

  const stats = importVaultBatch(parsed as VaultBookmark[], { dryRun });
  printStats(path.basename(target), dryRun, stats);

  if (!dryRun && (stats.created > 0 || stats.updated > 0)) {
    import('./generate_readme.js')
      .then(({ generateReadme }) => {
        fs.writeFileSync(path.resolve(process.cwd(), 'README.md'), generateReadme(), 'utf-8');
        console.log('[Import vault] README.md actualizado.');
      })
      .catch((error) => {
        console.warn('[Import vault] No se pudo actualizar README.md:', error instanceof Error ? error.message : error);
      });
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry.endsWith('import_vault_batch.ts') || entry.endsWith('import_vault_batch.js')) {
  main();
}
