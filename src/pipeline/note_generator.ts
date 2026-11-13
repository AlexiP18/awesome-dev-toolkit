import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { ClassificationResult, EntryType, ToolConjunto, ToolFrontmatter, ToolItem, ToolStatus } from './types.js';
import { GitHubMetadata } from './github.js';
import { markRepoPathDeleted, unmarkRepoPathDeleted } from './github_sync.js';
import { coerceCategory } from './category_manager.js';
import { canonicalUrlKey, preferredDisplayUrl, productKeys, sameProduct } from './url_normalize.js';

export function contentRoot(): string {
  return process.env.CONTENT_DIR
    ? path.resolve(process.env.CONTENT_DIR)
    : path.resolve(process.cwd(), 'content');
}

export function toolsDir(): string {
  return path.join(contentRoot(), 'tools');
}
export function tipsDir(): string {
  return path.join(contentRoot(), 'tips');
}
export function jobsDir(): string {
  return path.join(contentRoot(), 'jobs');
}

export function ensureToolsDirExists(): void {
  for (const dir of [toolsDir(), tipsDir(), jobsDir()]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

const VALID_ENTRY_TYPES: EntryType[] = ['tool', 'product_showcase', 'tech_tip', 'job_remote', 'tech_product'];

/** Conserva tech_product y product_showcase; el tipo de empleo y el de consejo siguen mandando en su categoría. */
export function resolveEntryType(requested: string | undefined, category: string): EntryType {
  const req = (requested || '').trim() as EntryType;
  if (category === 'Trabajo & Freelance' || req === 'job_remote') return 'job_remote';
  if (req === 'tech_product' || req === 'product_showcase') return req;
  if (category === 'Productos Tecnológicos & Hardware') return 'tech_product';
  if (category === 'Empresas & Productos') return 'product_showcase';
  if (req === 'tech_tip' || category === 'Consejos & Buenas Prácticas') return 'tech_tip';
  if (VALID_ENTRY_TYPES.includes(req)) return req;
  return 'tool';
}

export function directoryForEntry(entry: EntryType, category: string): string {
  if (entry === 'job_remote' || category === 'Trabajo & Freelance') return jobsDir();
  if (entry === 'tech_tip' || category === 'Consejos & Buenas Prácticas') return tipsDir();
  return toolsDir();
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `recurso-${Date.now()}`;
}

/**
 * Normalizes a URL for duplicate comparison:
 * e.g. "https://www.Jiro.build/?ref=x#top" -> "jiro.build"
 * e.g. "https://github.com/Astral-Sh/uv.git/" -> "github.com/astral-sh/uv"
 */
export function normalizeUrlForComparison(rawUrl?: string): string {
  return canonicalUrlKey(rawUrl);
}

export interface ExistingToolCandidate {
  name?: string;
  url?: string;
  websiteUrl?: string;
  website_url?: string;
}

/**
 * Misma ficha si comparten URL canónica, si el repo y la landing son el mismo producto,
 * o si el slug coincide y las URLs no se contradicen.
 */
export function findExistingTool(
  candidate: ExistingToolCandidate,
  existingTools?: ToolItem[]
): ToolItem | undefined {
  const tools = existingTools || loadAllTools();
  const website = candidate.websiteUrl || candidate.website_url;
  const targetSlug = candidate.name ? slugify(candidate.name) : '';

  for (const tool of tools) {
    if (
      sameProduct(
        { url: candidate.url, website, name: candidate.name },
        { url: tool.frontmatter.url, website: tool.frontmatter.website_url, name: tool.frontmatter.name }
      )
    ) {
      return tool;
    }
  }

  if (targetSlug) {
    const candKey = canonicalUrlKey(candidate.url);
    for (const tool of tools) {
      const existingNameSlug = slugify(tool.frontmatter.name || '');
      if (tool.slug !== targetSlug && existingNameSlug !== targetSlug) continue;
      const toolKey = canonicalUrlKey(tool.frontmatter.url);
      if (!candKey || !toolKey || candKey === toolKey) return tool;
    }
  }

  return undefined;
}

const saveTail = new Map<string, Promise<unknown>>();

export function dedupLockKey(candidate: ExistingToolCandidate): string {
  const keys = [...productKeys(candidate.url, candidate.websiteUrl || candidate.website_url)].sort();
  if (keys.length) return keys.join('|');
  return `slug:${slugify(candidate.name || 'nota')}`;
}

/** Serializa guardados concurrentes del mismo producto (dos quick-save a la vez). */
export function withSaveLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = saveTail.get(key) ?? Promise.resolve();
  const run = prev.then(() => fn(), () => fn());
  const settled = run.then(
    () => undefined,
    () => undefined
  );
  saveTail.set(key, settled);
  return run.finally(() => {
    if (saveTail.get(key) === settled) saveTail.delete(key);
  });
}

export function extractAuthorFromTweet(sourceTweet?: string): { author?: string; handle?: string } {
  if (!sourceTweet) return {};
  const match = sourceTweet.match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]{1,15})(?:\/status|\/?$)/i);
  if (match && match[1]) {
    const handle = match[1];
    const reserved = ['home', 'explore', 'notifications', 'messages', 'i', 'search', 'settings'];
    if (!reserved.includes(handle.toLowerCase())) {
      return { author: `@${handle}`, handle };
    }
  }
  return {};
}

export function isBlankishString(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim().toLowerCase();
  return trimmed === '' || trimmed === 'null' || trimmed === 'undefined';
}

export function cleanFrontmatter(obj: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      if (isBlankishString(value)) continue;
      cleaned[key] = value.trim();
      continue;
    }
    if (Array.isArray(value)) {
      const items = value.filter((item) => {
        if (item === undefined || item === null) return false;
        if (typeof item === 'string') return !isBlankishString(item);
        return true;
      });
      if (items.length) cleaned[key] = items;
      continue;
    }
    if (value !== undefined && value !== null && value !== '') {
      cleaned[key] = value;
    }
  }
  const urlKey = canonicalUrlKey(cleaned.url);
  const webKey = canonicalUrlKey(cleaned.website_url);
  if (urlKey && webKey && urlKey === webKey) delete cleaned.website_url;
  return cleaned;
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
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

export interface CreateNoteParams {
  classification: ClassificationResult;
  githubMeta?: GitHubMetadata | null;
  sourceTweet?: string;
  author?: string;
  initialStatus?: ToolStatus;
  providerUsed?: string;
}

export function createOrUpdateToolNote(
  params: {
    classification: ClassificationResult;
    githubMeta?: GitHubMetadata | null;
    sourceTweet?: string;
    author?: string;
    initialStatus?: ToolStatus;
    providerUsed?: string;
  },
  existingTools?: ToolItem[]
): { filePath: string; slug: string; alreadyExisted: boolean } {
  ensureToolsDirExists();

  const fresh = loadAllTools();
  const seenPaths = new Set<string>();
  const tools = [...(existingTools || []), ...fresh].filter((tool) => {
    if (!tool?.filePath || seenPaths.has(tool.filePath)) return false;
    seenPaths.add(tool.filePath);
    return true;
  });

  const duplicate = findExistingTool(
    {
      name: params.classification.name,
      url: params.classification.canonicalUrl,
      websiteUrl: params.classification.websiteUrl,
    },
    tools
  );

  let isDupBroken = false;
  let hasNewThreadPrompts = false;

  if (duplicate) {
    const dupUrl = duplicate.frontmatter.url;
    const newUrl = params.classification.canonicalUrl;
    isDupBroken =
      !dupUrl ||
      isBlankishString(dupUrl) ||
      dupUrl.endsWith('/undefined') ||
      Boolean(
        newUrl &&
          canonicalUrlKey(dupUrl) &&
          canonicalUrlKey(dupUrl) !== canonicalUrlKey(newUrl) &&
          newUrl.toLowerCase().startsWith(dupUrl.toLowerCase())
      );
    const hasNewValidTweet = Boolean(
      params.sourceTweet &&
      /\/status\/\d{10,}/.test(params.sourceTweet) &&
      duplicate.frontmatter.source_tweet !== params.sourceTweet &&
      !(duplicate.frontmatter.source_tweets || []).includes(params.sourceTweet)
    );
    hasNewThreadPrompts = Boolean(
      params.classification.keyHighlights.some((h) => h.includes('###') || h.includes('```')) &&
      (!duplicate.content.includes('```') ||
        duplicate.content.includes('Pendiente de recopilar') ||
        (duplicate.content.match(/###\s+/g) || []).length <
          params.classification.keyHighlights.filter((h) => h.includes('###')).length)
    );

    if (!isDupBroken && !hasNewValidTweet && !hasNewThreadPrompts) {
      console.log(
        `[Deduplicación] ⏭️ La herramienta "${duplicate.frontmatter.name}" (${duplicate.frontmatter.url}) ya existe en ${duplicate.slug}.md. Se omite para no duplicar.`
      );
      return {
        filePath: duplicate.filePath,
        slug: duplicate.slug,
        alreadyExisted: true,
      };
    }
    console.log(
      `[Deduplicación] 🔄 Reparando/actualizando nota existente con nuevos datos: "${duplicate.frontmatter.name}" (${params.classification.canonicalUrl})`
    );
  }

  const category = coerceCategory(params.classification.category, params.classification.entryType);
  const entryType = resolveEntryType(params.classification.entryType, category);
  const isJob = entryType === 'job_remote';
  const isTip = entryType === 'tech_tip';
  const targetDir = directoryForEntry(entryType, category);

  const slug = duplicate?.slug || slugify(params.classification.name);
  let filePath = duplicate?.filePath || path.join(targetDir, `${slug}.md`);
  if (duplicate && path.dirname(duplicate.filePath) !== targetDir) {
    filePath = path.join(targetDir, `${slug}.md`);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const today = nowIso.split('T')[0];

  let finalUrl = preferredDisplayUrl([
    params.classification.canonicalUrl,
    duplicate?.frontmatter.url,
    params.classification.websiteUrl,
    params.sourceTweet,
  ]);
  if (!finalUrl) finalUrl = '#';

  const tweetAuthorInfo = extractAuthorFromTweet(params.sourceTweet);
  const authorName = params.author?.trim() || tweetAuthorInfo.author;
  const authorHandle = tweetAuthorInfo.handle || (authorName?.startsWith('@') ? authorName.slice(1) : undefined);

  const mergedTags = uniqueStrings([
    ...(duplicate?.frontmatter.tags || []),
    ...(params.classification.tags || []),
  ]).map((tag) => tag.toLowerCase());
  const mergedTweets = uniqueStrings([
    duplicate?.frontmatter.source_tweet,
    ...(duplicate?.frontmatter.source_tweets || []),
    params.sourceTweet,
  ]);

  const frontmatter: ToolFrontmatter = {
    name: duplicate?.frontmatter.name || params.classification.name,
    url: finalUrl,
    website_url: preferredDisplayUrl([
      params.classification.websiteUrl,
      duplicate?.frontmatter.website_url,
      !canonicalUrlKey(params.classification.canonicalUrl).startsWith('github.com/')
        ? params.classification.canonicalUrl
        : undefined,
    ]) || undefined,
    category,
    conjunto: params.classification.conjunto || duplicate?.frontmatter.conjunto || (isTip ? 'consejos' : 'recursos'),
    tags: mergedTags,
    stars: params.githubMeta?.stars ?? duplicate?.frontmatter.stars,
    status: duplicate?.frontmatter.status || params.initialStatus || 'to_try',
    date_added: duplicate?.frontmatter.date_added || today,
    created_at: duplicate?.frontmatter.created_at || nowIso,
    updated_at: duplicate ? nowIso : undefined,
    source_tweet: mergedTweets[0],
    source_tweets: mergedTweets.length > 1 ? mergedTweets : undefined,
    author: authorName || duplicate?.frontmatter.author,
    author_handle: authorHandle || duplicate?.frontmatter.author_handle,
    entry_type: entryType,
    company: params.classification.company || duplicate?.frontmatter.company || params.author,
    location: params.classification.location || duplicate?.frontmatter.location,
    salary: params.classification.salary || duplicate?.frontmatter.salary,
    price: params.classification.price || duplicate?.frontmatter.price,
    job_type: params.classification.jobType || duplicate?.frontmatter.job_type,
    has_academic_promo: params.classification.hasAcademicPromo || duplicate?.frontmatter.has_academic_promo || undefined,
    academic_promo_details: params.classification.academicPromoDetails || duplicate?.frontmatter.academic_promo_details,
    classified_by: params.providerUsed || duplicate?.frontmatter.classified_by,
  };

  const isProduct = entryType === 'tech_product' || entryType === 'product_showcase' || (!isJob && !isTip && (frontmatter.conjunto === 'producto' || (!!frontmatter.price && !isBlankishString(frontmatter.price))));

  const highlightsMd = params.classification.keyHighlights.length
    ? params.classification.keyHighlights
        .map((h) => {
          const trimmed = h.trim();
          if (trimmed.startsWith('###') || trimmed.includes('```')) {
            return trimmed;
          }
          return `- ${trimmed}`;
        })
        .join('\n\n')
    : '- Recurso guardado para evaluación técnica.';

  const promoBlock = frontmatter.has_academic_promo
    ? `> 🎓 **Promoción Académica:** ${frontmatter.academic_promo_details || 'Disponible para estudiantes o instituciones educativas.'}\n\n`
    : '';

  const sectionHighlightsTitle = isJob
    ? '📋 Requisitos & Características Clave'
    : isTip
    ? '📌 Puntos Clave & Pasos del Consejo'
    : isProduct
    ? '⚙️ Especificaciones & Características Clave'
    : '💡 ¿Por qué destaca?';

  const sectionNotesTitle = isJob
    ? '📝 Notas de Postulación & Consejos'
    : isTip
    ? '📝 Aplicación Práctica & Contexto'
    : isProduct
    ? '📝 Notas de Evaluación & Casos de Uso'
    : '📝 Notas Personales (Segundo Cerebro)';

  const referenceLabel = isJob
    ? 'Enlace oficial / Para postular'
    : isTip
    ? (frontmatter.url.includes('x.com') || frontmatter.url.includes('twitter.com') ? 'Tweet con el consejo completo' : 'Enlace o documentación de referencia')
    : isProduct
    ? 'Sitio oficial o ficha del producto'
    : (frontmatter.url.includes('github.com') ? 'Repositorio de código (GitHub)' : 'Enlace de referencia');

  const jobMetaBlock = isJob
    ? `${frontmatter.company ? `- **🏢 Empresa / Plataforma:** ${frontmatter.company}\n` : ''}${frontmatter.location ? `- **🌍 Modalidad / Ubicación:** ${frontmatter.location}\n` : ''}${frontmatter.salary ? `- **💰 Compensación / Tarifa:** ${frontmatter.salary}\n` : ''}`
    : '';

  const productMetaBlock = isProduct
    ? `${frontmatter.company ? `- **🏢 Fabricante / Marca:** ${frontmatter.company}\n` : ''}${frontmatter.price ? `- **💰 Precio / Disponibilidad:** ${frontmatter.price}\n` : ''}`
    : '';

  const markdownBody = `
# ${isJob ? '💼 ' : isTip ? '💡 ' : isProduct ? '🖥️ ' : ''}${params.classification.name}

> ${params.classification.oneLiner}

${promoBlock}${authorName ? `**👤 Publicado / Recomendado por:** ${authorName}${authorHandle ? ` ([@${authorHandle}](https://x.com/${authorHandle}))` : ''}\n` : ''}${isProduct && frontmatter.company ? `**🏢 Fabricante / Empresa:** ${frontmatter.company}\n` : ''}${jobMetaBlock ? `\n### 📌 Información de la Oportunidad\n${jobMetaBlock}\n` : ''}${productMetaBlock ? `\n### 📌 Información del Producto / Hardware\n${productMetaBlock}\n` : ''}
## ${sectionHighlightsTitle}
${highlightsMd}

## ${sectionNotesTitle}
- ${params.classification.recommendedNotes || (isJob ? 'Pendiente de revisar requisitos y postular.' : isProduct ? 'Pendiente de evaluar disponibilidad o compra.' : 'Pendiente de probar o revisar detalles.')}

## 🔗 Referencias
- ${referenceLabel}: [${params.classification.canonicalUrl}](${params.classification.canonicalUrl})
${frontmatter.website_url ? `- Sitio Web oficial: [${frontmatter.website_url}](${frontmatter.website_url})\n` : ''}${params.sourceTweet && params.sourceTweet !== params.classification.canonicalUrl ? `- Tweet origen: [Ver en X](${params.sourceTweet})\n` : ''}
`;

  const keepExistingBody =
    Boolean(duplicate) &&
    !isDupBroken &&
    !hasNewThreadPrompts &&
    duplicate!.content.trim().length > 80;

  const fileContent = matter.stringify(
    (keepExistingBody ? duplicate!.content.trim() : markdownBody.trim()) + '\n',
    cleanFrontmatter(frontmatter)
  );
  fs.writeFileSync(filePath, fileContent, 'utf-8');
  unmarkRepoPathDeleted(filePath);
  if (duplicate && duplicate.filePath !== filePath && fs.existsSync(duplicate.filePath)) {
    fs.unlinkSync(duplicate.filePath);
    markRepoPathDeleted(duplicate.filePath);
  }

  return { filePath, slug, alreadyExisted: false };
}

export function createOrUpdateToolNoteLocked(
  params: Parameters<typeof createOrUpdateToolNote>[0],
  existingTools?: ToolItem[]
): Promise<{ filePath: string; slug: string; alreadyExisted: boolean }> {
  const key = dedupLockKey({
    name: params.classification.name,
    url: params.classification.canonicalUrl,
    websiteUrl: params.classification.websiteUrl,
  });
  return withSaveLock(key, () => createOrUpdateToolNote(params, existingTools));
}

export function getToolRecency(item: { frontmatter?: ToolFrontmatter; mtimeMs?: number }): number {
  if (!item) return 0;
  const fm = item.frontmatter || ({} as ToolFrontmatter);
  if (fm.created_at) {
    const t = new Date(fm.created_at).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (item.mtimeMs && !isNaN(item.mtimeMs) && item.mtimeMs > 0) {
    return item.mtimeMs;
  }
  if (fm.date_added) {
    const t = new Date(fm.date_added).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  return 0;
}

export function loadAllTools(): ToolItem[] {
  ensureToolsDirExists();
  const tools: ToolItem[] = [];

  const dirs = [
    { dir: toolsDir(), defaultType: 'tool' as const },
    { dir: tipsDir(), defaultType: 'tech_tip' as const },
    { dir: jobsDir(), defaultType: 'job_remote' as const },
  ];

  for (const { dir, defaultType } of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(content);

      const slug = path.basename(file, '.md');
      const data = { ...(parsed.data as ToolFrontmatter) };
      if (!data.entry_type) {
        data.entry_type = defaultType;
      }
      if (!data.conjunto) {
        data.conjunto = data.entry_type === 'tech_tip' ? 'consejos' : data.entry_type === 'tech_product' || data.entry_type === 'product_showcase' ? 'producto' : 'recursos';
      }

      const stat = fs.statSync(filePath);
      const mtimeMs = stat.mtimeMs;
      if (!data.created_at) {
        data.created_at = data.date_added && String(data.date_added).length > 10
          ? new Date(data.date_added).toISOString()
          : (stat.birthtime.getTime() > 0 ? stat.birthtime.toISOString() : stat.mtime.toISOString());
      }

      // Automatically infer author and handle from source_tweet if missing
      if (!data.author && data.source_tweet) {
        const info = extractAuthorFromTweet(data.source_tweet);
        if (info.author) data.author = info.author;
        if (info.handle) data.author_handle = info.handle;
      } else if (data.author && !data.author_handle && data.source_tweet) {
        const info = extractAuthorFromTweet(data.source_tweet);
        if (info.handle) data.author_handle = info.handle;
      }

      tools.push({
        slug,
        filePath,
        frontmatter: data,
        content: parsed.content,
        mtimeMs,
      });
    }
  }

  // Sort descending by recency (most recently added/analyzed first), then by stars
  return tools.sort((a, b) => {
    const recA = getToolRecency(a);
    const recB = getToolRecency(b);
    if (recB !== recA) return recB - recA;
    return (b.frontmatter.stars || 0) - (a.frontmatter.stars || 0);
  });
}

export function updateToolNote(slug: string, updates: {
  name?: string;
  url?: string;
  status?: ToolStatus;
  notes?: string;
  category?: string;
  conjunto?: ToolConjunto;
  tags?: string[];
  author?: string;
  author_handle?: string;
  source_tweet?: string;
  location?: string;
  salary?: string;
  price?: string;
  company?: string;
  has_academic_promo?: boolean;
  academic_promo_details?: string;
  entry_type?: EntryType;
}): boolean {
  let filePath = path.join(toolsDir(), `${slug}.md`);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(tipsDir(), `${slug}.md`);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(jobsDir(), `${slug}.md`);
      if (!fs.existsSync(filePath)) {
        return false;
      }
    }
  }

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const parsed = matter(fileContent);

  const updatedFrontmatter = {
    ...parsed.data,
    ...(updates.name ? { name: updates.name } : {}),
    ...(updates.url ? { url: updates.url } : {}),
    ...(updates.status ? { status: updates.status } : {}),
    ...(updates.category ? { category: updates.category } : {}),
    ...(updates.conjunto ? { conjunto: updates.conjunto } : {}),
    ...(updates.tags ? { tags: updates.tags } : {}),
    ...(updates.author !== undefined ? { author: updates.author } : {}),
    ...(updates.author_handle !== undefined ? { author_handle: updates.author_handle } : {}),
    ...(updates.source_tweet !== undefined ? { source_tweet: updates.source_tweet } : {}),
    ...(updates.location !== undefined ? { location: updates.location } : {}),
    ...(updates.salary !== undefined ? { salary: updates.salary } : {}),
    ...(updates.price !== undefined ? { price: updates.price } : {}),
    ...(updates.company !== undefined ? { company: updates.company } : {}),
    ...(updates.has_academic_promo !== undefined ? { has_academic_promo: updates.has_academic_promo } : {}),
    ...(updates.academic_promo_details !== undefined ? { academic_promo_details: updates.academic_promo_details } : {}),
    ...(updates.entry_type ? { entry_type: updates.entry_type } : {}),
    updated_at: new Date().toISOString(),
  };

  const category = coerceCategory(String(updatedFrontmatter.category || ''), updatedFrontmatter.entry_type);
  const entryType = resolveEntryType(updatedFrontmatter.entry_type, category);
  updatedFrontmatter.category = category;
  updatedFrontmatter.entry_type = entryType;

  let body = parsed.content;
  if (updates.notes !== undefined) {
    body = updates.notes;
  }

  ensureToolsDirExists();

  const targetDir = directoryForEntry(entryType, category);

  const targetPath = path.join(targetDir, `${slug}.md`);
  const newContent = matter.stringify(body, cleanFrontmatter(updatedFrontmatter));

  fs.writeFileSync(targetPath, newContent, 'utf-8');
  unmarkRepoPathDeleted(targetPath);
  if (targetPath !== filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    markRepoPathDeleted(filePath);
  }
  return true;
}

export function deleteToolNote(slug: string): boolean {
  let filePath = path.join(toolsDir(), `${slug}.md`);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(tipsDir(), `${slug}.md`);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(jobsDir(), `${slug}.md`);
      if (!fs.existsSync(filePath)) {
        return false;
      }
    }
  }

  try {
    fs.unlinkSync(filePath);
    markRepoPathDeleted(filePath);
    return true;
  } catch (err) {
    console.error(`Error al eliminar archivo ${filePath}:`, err);
    return false;
  }
}

export function deleteToolNotes(slugs: string[]): { deleted: string[]; notFound: string[] } {
  const deleted: string[] = [];
  const notFound: string[] = [];
  for (const slug of slugs) {
    if (deleteToolNote(slug)) {
      deleted.push(slug);
    } else {
      notFound.push(slug);
    }
  }
  return { deleted, notFound };
}

/**
 * Restaura en disco (y prepara para sincronización con GitHub) fichas provenientes del
 * respaldo persistente del navegador cuando un contenedor efímero (ej. Render) se reinicia.
 */
export function restoreToolNotes(items: Array<{
  slug: string;
  frontmatter: ToolFrontmatter;
  content?: string;
}>): { restoredCount: number; updatedCount: number } {
  ensureToolsDirExists();
  let restoredCount = 0;
  let updatedCount = 0;

  const allDirs = [toolsDir(), tipsDir(), jobsDir()];

  for (const item of items) {
    if (!item || !item.slug || !item.frontmatter || !item.frontmatter.name) continue;
    const safeSlug = slugify(item.slug);
    const category = coerceCategory(item.frontmatter.category, item.frontmatter.entry_type);
    const entryType = resolveEntryType(item.frontmatter.entry_type, category);
    const fm: ToolFrontmatter = {
      ...item.frontmatter,
      category,
      entry_type: entryType,
      url: preferredDisplayUrl([item.frontmatter.url, item.frontmatter.website_url]) || item.frontmatter.url,
    };
    const targetDir = directoryForEntry(entryType, category);

    const byIdentity = findExistingTool({
      name: fm.name,
      url: fm.url,
      websiteUrl: fm.website_url,
    });
    let existingPath: string | null = byIdentity?.filePath || null;
    if (!existingPath) {
      for (const d of allDirs) {
        const candidate = path.join(d, `${safeSlug}.md`);
        if (fs.existsSync(candidate)) {
          existingPath = candidate;
          break;
        }
      }
    }

    const writeSlug = byIdentity?.slug || safeSlug;
    const targetPath = path.join(targetDir, `${writeSlug}.md`);

    if (!existingPath) {
      const fileContent = matter.stringify((item.content || '').trim() + '\n', cleanFrontmatter(fm));
      fs.writeFileSync(targetPath, fileContent, 'utf-8');
      unmarkRepoPathDeleted(targetPath);
      restoredCount++;
    } else {
      // Si ya existe en disco, verificar si la versión del respaldo tiene ediciones más recientes
      try {
        const diskRaw = fs.readFileSync(existingPath, 'utf-8');
        const diskParsed = matter(diskRaw);
        const diskUpdated = diskParsed.data?.updated_at ? new Date(diskParsed.data.updated_at).getTime() : 0;
        const clientUpdated = fm.updated_at ? new Date(fm.updated_at).getTime() : 0;

        if (clientUpdated > diskUpdated && clientUpdated > 0) {
          const fileContent = matter.stringify((item.content ?? diskParsed.content).trim() + '\n', cleanFrontmatter(fm));
          fs.writeFileSync(targetPath, fileContent, 'utf-8');
          unmarkRepoPathDeleted(targetPath);
          if (existingPath !== targetPath && fs.existsSync(existingPath)) {
            fs.unlinkSync(existingPath);
            markRepoPathDeleted(existingPath);
          }
          updatedCount++;
        }
      } catch {}
    }
  }

  return { restoredCount, updatedCount };
}
