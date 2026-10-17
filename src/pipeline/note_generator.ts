import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { ClassificationResult, ToolFrontmatter, ToolItem, ToolStatus } from './types.js';
import { GitHubMetadata } from './github.js';

const TOOLS_DIR = path.resolve(process.cwd(), 'content/tools');

export function ensureToolsDirExists(): void {
  if (!fs.existsSync(TOOLS_DIR)) {
    fs.mkdirSync(TOOLS_DIR, { recursive: true });
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
  if (!u || u.includes('x.com/') || u.includes('twitter.com/')) {
    return '';
  }
  u = u.replace(/^https?:\/\//, '');
  u = u.replace(/^www\./, '');
  u = u.split('?')[0].split('#')[0];
  u = u.replace(/\.git\/?$/, '');
  u = u.replace(/\/+$/, '');
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
}

export function createOrUpdateToolNote(
  params: {
    classification: ClassificationResult;
    githubMeta?: GitHubMetadata | null;
    sourceTweet?: string;
    author?: string;
    initialStatus?: ToolStatus;
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
    console.log(
      `[Deduplicación] ⏭️ La herramienta "${duplicate.frontmatter.name}" (${duplicate.frontmatter.url}) ya existe en ${duplicate.slug}.md. Se omite para no duplicar.`
    );
    return {
      filePath: duplicate.filePath,
      slug: duplicate.slug,
      alreadyExisted: true,
    };
  }

  const slug = slugify(params.classification.name);
  const filePath = path.join(TOOLS_DIR, `${slug}.md`);

  const today = new Date().toISOString().split('T')[0];

  const frontmatter: ToolFrontmatter = {
    name: params.classification.name,
    url: params.classification.canonicalUrl,
    category: params.classification.category,
    tags: params.classification.tags,
    stars: params.githubMeta?.stars,
    status: params.initialStatus || 'to_try',
    date_added: today,
    source_tweet: params.sourceTweet,
    author: params.author,
  };

  const highlightsMd = params.classification.keyHighlights.length
    ? params.classification.keyHighlights.map((h) => `- ${h}`).join('\n')
    : '- Herramienta guardada para evaluación técnica.';

  const markdownBody = `
# ${params.classification.name}

> ${params.classification.oneLiner}

## 💡 ¿Por qué destaca?
${highlightsMd}

## 📝 Notas Personales (Segundo Cerebro)
- ${params.classification.recommendedNotes || 'Pendiente de probar en un proyecto real.'}

## 🔗 Referencias
- Repositorio / Web oficial: [${params.classification.canonicalUrl}](${params.classification.canonicalUrl})
${params.sourceTweet ? `- Tweet origen: [Ver en X](${params.sourceTweet})` : ''}
`;

  const fileContent = matter.stringify(markdownBody.trim() + '\n', cleanFrontmatter(frontmatter));
  fs.writeFileSync(filePath, fileContent, 'utf-8');

  return { filePath, slug, alreadyExisted: false };
}

export function loadAllTools(): ToolItem[] {
  ensureToolsDirExists();
  const files = fs.readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.md'));

  const tools: ToolItem[] = [];

  for (const file of files) {
    const filePath = path.join(TOOLS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = matter(content);

    const slug = path.basename(file, '.md');
    tools.push({
      slug,
      filePath,
      frontmatter: parsed.data as ToolFrontmatter,
      content: parsed.content,
    });
  }

  // Sort descending by date_added or stars
  return tools.sort((a, b) => {
    return (b.frontmatter.stars || 0) - (a.frontmatter.stars || 0);
  });
}

export function updateToolNote(slug: string, updates: {
  status?: ToolStatus;
  notes?: string;
  category?: string;
  tags?: string[];
}): boolean {
  const filePath = path.join(TOOLS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const parsed = matter(fileContent);

  const updatedFrontmatter = {
    ...parsed.data,
    ...(updates.status ? { status: updates.status } : {}),
    ...(updates.category ? { category: updates.category } : {}),
    ...(updates.tags ? { tags: updates.tags } : {}),
  };

  let body = parsed.content;
  if (updates.notes !== undefined) {
    body = updates.notes;
  }

  const newContent = matter.stringify(body, cleanFrontmatter(updatedFrontmatter));
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return true;
}
