import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { ClassificationResult, EntryType, ToolFrontmatter, ToolItem, ToolStatus } from './types.js';
import { GitHubMetadata } from './github.js';

const TOOLS_DIR = path.resolve(process.cwd(), 'content/tools');
const PRODUCTS_DIR = path.resolve(process.cwd(), 'content/products');
const TIPS_DIR = path.resolve(process.cwd(), 'content/tips');
const JOBS_DIR = path.resolve(process.cwd(), 'content/jobs');

export function ensureToolsDirExists(): void {
  if (!fs.existsSync(TOOLS_DIR)) {
    fs.mkdirSync(TOOLS_DIR, { recursive: true });
  }
  if (!fs.existsSync(PRODUCTS_DIR)) {
    fs.mkdirSync(PRODUCTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(TIPS_DIR)) {
    fs.mkdirSync(TIPS_DIR, { recursive: true });
  }
  if (!fs.existsSync(JOBS_DIR)) {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
  }
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
 * e.g. "https://github.com/astral-sh/uv.git/" -> "github.com/astral-sh/uv"
 */
export function normalizeUrlForComparison(rawUrl?: string): string {
  if (!rawUrl) return '';
  let u = rawUrl.trim().toLowerCase();
  if (!u) return '';
  u = u.replace(/^https?:\/\//, '');
  u = u.replace(/^www\./, '');
  u = u.split('?')[0].split('#')[0];
  u = u.replace(/\.git\/?$/, '');
  u = u.replace(/\/+$/, '');

  // Normalizar dominios de X / Twitter
  if (u.startsWith('twitter.com/')) {
    u = 'x.com/' + u.slice('twitter.com/'.length);
  }
  if (u.startsWith('x.com/')) {
    // Si no contiene un ID de status específico, ignorar para comparación de herramienta
    if (!u.includes('/status/')) {
      return '';
    }
  }
  return u;
}

/**
 * Checks if a tool already exists in the catalog by normalized URL or by slug/name.
 */
export function findExistingTool(
  candidate: { name?: string; url?: string },
  existingTools?: ToolItem[]
): ToolItem | undefined {
  const tools = existingTools || loadAllTools();
  const targetUrl = normalizeUrlForComparison(candidate.url);
  const targetSlug = candidate.name ? slugify(candidate.name) : '';

  for (const tool of tools) {
    // 1. Check by normalized canonical URL
    const toolUrl = normalizeUrlForComparison(tool.frontmatter.url);
    if (targetUrl && toolUrl && targetUrl === toolUrl) {
      return tool;
    }

    // 2. Check by slug or normalized name
    if (targetSlug) {
      const existingNameSlug = slugify(tool.frontmatter.name || '');
      if (tool.slug === targetSlug || existingNameSlug === targetSlug) {
        return tool;
      }
    }
  }

  return undefined;
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

function cleanFrontmatter(obj: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== '') {
      cleaned[key] = value;
    }
  }
  return cleaned;
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

  // Check if this tool is already registered (by URL or Name/Slug)
  const duplicate = findExistingTool(
    {
      name: params.classification.name,
      url: params.classification.canonicalUrl,
    },
    existingTools
  );

  if (duplicate) {
    const dupUrl = duplicate.frontmatter.url;
    const newUrl = params.classification.canonicalUrl;
    const isDupBroken =
      !dupUrl ||
      dupUrl === 'undefined' ||
      dupUrl === 'null' ||
      dupUrl.endsWith('/undefined') ||
      Boolean(
        newUrl &&
          dupUrl.toLowerCase() !== newUrl.toLowerCase() &&
          newUrl.toLowerCase().startsWith(dupUrl.toLowerCase())
      );
    const hasNewValidTweet = Boolean(
      params.sourceTweet &&
      /\/status\/\d{10,}/.test(params.sourceTweet) &&
      duplicate.frontmatter.source_tweet !== params.sourceTweet
    );
    const hasNewThreadPrompts = Boolean(
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

  const isJob = params.classification.entryType === 'job_remote' || params.classification.category === 'Trabajo & Freelance';
  const isTip = !isJob && params.classification.entryType === 'tech_tip';
  const isProduct = !isJob && !isTip && (
    params.classification.entryType === 'tech_product' ||
    params.classification.category === 'Productos Tecnológicos & Hardware'
  );
  const targetDir = isJob ? JOBS_DIR : isTip ? TIPS_DIR : isProduct ? PRODUCTS_DIR : TOOLS_DIR;

  const slug = slugify(params.classification.name);
  const filePath = path.join(targetDir, `${slug}.md`);

  const now = new Date();
  const nowIso = now.toISOString();
  const today = nowIso.split('T')[0];

  let finalUrl = (params.classification.canonicalUrl || '').trim();
  if (!finalUrl || finalUrl === 'undefined' || finalUrl === 'null') {
    finalUrl = params.classification.websiteUrl || params.sourceTweet || '#';
  }

  const tweetAuthorInfo = extractAuthorFromTweet(params.sourceTweet);
  const authorName = params.author?.trim() || tweetAuthorInfo.author;
  const authorHandle = tweetAuthorInfo.handle || (authorName?.startsWith('@') ? authorName.slice(1) : undefined);

  const frontmatter: ToolFrontmatter = {
    name: params.classification.name,
    url: finalUrl,
    website_url: params.classification.websiteUrl,
    category: params.classification.category,
    tags: params.classification.tags,
    stars: params.githubMeta?.stars,
    status: params.initialStatus || 'to_try',
    date_added: today,
    created_at: nowIso,
    source_tweet: params.sourceTweet,
    author: authorName,
    author_handle: authorHandle,
    entry_type: isJob ? 'job_remote' : isTip ? 'tech_tip' : isProduct ? 'tech_product' : 'tool',
    company: params.classification.company || (isProduct ? params.author : undefined),
    location: params.classification.location || undefined,
    salary: params.classification.salary || undefined,
    price: params.classification.price || undefined,
    job_type: params.classification.jobType || undefined,
    has_academic_promo: params.classification.hasAcademicPromo || undefined,
    academic_promo_details: params.classification.academicPromoDetails || undefined,
    classified_by: params.providerUsed || undefined,
  };

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

  const fileContent = matter.stringify(markdownBody.trim() + '\n', cleanFrontmatter(frontmatter));
  fs.writeFileSync(filePath, fileContent, 'utf-8');

  return { filePath, slug, alreadyExisted: false };
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
    { dir: TOOLS_DIR, defaultType: 'tool' as const },
    { dir: PRODUCTS_DIR, defaultType: 'tech_product' as const },
    { dir: TIPS_DIR, defaultType: 'tech_tip' as const },
    { dir: JOBS_DIR, defaultType: 'job_remote' as const },
  ];

  for (const { dir, defaultType } of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(content);

      const slug = path.basename(file, '.md');
      const data = parsed.data as ToolFrontmatter;
      if (!data.entry_type) {
        data.entry_type = defaultType;
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
  let filePath = path.join(TOOLS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PRODUCTS_DIR, `${slug}.md`);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(TIPS_DIR, `${slug}.md`);
      if (!fs.existsSync(filePath)) {
        filePath = path.join(JOBS_DIR, `${slug}.md`);
        if (!fs.existsSync(filePath)) {
          return false;
        }
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
  };

  let body = parsed.content;
  if (updates.notes !== undefined) {
    body = updates.notes;
  }

  ensureToolsDirExists();

  let targetDir = TOOLS_DIR;
  if (updatedFrontmatter.entry_type === 'job_remote') {
    targetDir = JOBS_DIR;
  } else if (updatedFrontmatter.entry_type === 'tech_tip') {
    targetDir = TIPS_DIR;
  } else if (updatedFrontmatter.entry_type === 'tech_product' || updatedFrontmatter.entry_type === 'product_showcase') {
    targetDir = PRODUCTS_DIR;
  } else if (updatedFrontmatter.entry_type === 'tool') {
    targetDir = TOOLS_DIR;
  } else {
    if (updatedFrontmatter.category === 'Trabajo & Freelance') targetDir = JOBS_DIR;
    else if (updatedFrontmatter.category === 'Consejos & Buenas Prácticas') targetDir = TIPS_DIR;
    else if (updatedFrontmatter.category === 'Productos Tecnológicos & Hardware') targetDir = PRODUCTS_DIR;
  }

  const targetPath = path.join(targetDir, `${slug}.md`);
  const newContent = matter.stringify(body, cleanFrontmatter(updatedFrontmatter));

  fs.writeFileSync(targetPath, newContent, 'utf-8');
  if (targetPath !== filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  return true;
}

export function deleteToolNote(slug: string): boolean {
  let filePath = path.join(TOOLS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PRODUCTS_DIR, `${slug}.md`);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(TIPS_DIR, `${slug}.md`);
      if (!fs.existsSync(filePath)) {
        filePath = path.join(JOBS_DIR, `${slug}.md`);
        if (!fs.existsSync(filePath)) {
          return false;
        }
      }
    }
  }

  try {
    fs.unlinkSync(filePath);
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
