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

export function createOrUpdateToolNote(params: {
  classification: ClassificationResult;
  githubMeta?: GitHubMetadata | null;
  sourceTweet?: string;
  author?: string;
  initialStatus?: ToolStatus;
}): { filePath: string; slug: string } {
  ensureToolsDirExists();

  const slug = slugify(params.classification.name);
  const filePath = path.join(TOOLS_DIR, `${slug}.md`);

  const today = new Date().toISOString().split('T')[0];

  let frontmatter: ToolFrontmatter;
  let markdownBody: string;

  if (fs.existsSync(filePath)) {
    // Preserve existing personal notes if file already exists
    const existingFile = fs.readFileSync(filePath, 'utf-8');
    const parsed = matter(existingFile);
    frontmatter = {
      ...(parsed.data as ToolFrontmatter),
      name: params.classification.name,
      url: params.classification.canonicalUrl,
      category: params.classification.category,
      tags: Array.from(new Set([...(parsed.data.tags || []), ...params.classification.tags])),
      stars: params.githubMeta?.stars ?? parsed.data.stars,
      source_tweet: params.sourceTweet || parsed.data.source_tweet,
    };
    markdownBody = parsed.content;
  } else {
    frontmatter = {
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

    markdownBody = `
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
  }

  const fileContent = matter.stringify(markdownBody.trim() + '\n', cleanFrontmatter(frontmatter));
  fs.writeFileSync(filePath, fileContent, 'utf-8');

  return { filePath, slug };
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
    // If updating personal notes specifically
    body = updates.notes;
  }

  const newContent = matter.stringify(body, cleanFrontmatter(updatedFrontmatter));
  fs.writeFileSync(filePath, newContent, 'utf-8');
  return true;
}
