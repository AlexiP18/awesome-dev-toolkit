import { HttpError } from './http.js';
import type { EntryType, ToolConjunto, ToolStatus } from '../pipeline/types.js';

const STATUSES: ToolStatus[] = ['to_try', 'in_use', 'archived'];
const ENTRY_TYPES: EntryType[] = ['tool', 'product_showcase', 'tech_tip', 'job_remote', 'tech_product'];
const CONJUNTOS: ToolConjunto[] = ['recursos', 'inspiracion', 'producto', 'consejos'];
const SECTIONS = ['all', 'tools', 'tips', 'jobs'] as const;
const COLORS = ['sky', 'emerald', 'amber', 'violet', 'rose', 'indigo', 'cyan', 'purple', 'teal', 'slate'] as const;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,159}$/i;

export function asObject(body: unknown, label = 'El cuerpo'): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, `${label} debe ser un objeto JSON.`);
  }
  return body as Record<string, unknown>;
}

function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `${field} debe ser texto.`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new HttpError(400, `${field} supera el máximo de ${max} caracteres.`);
  return trimmed;
}

function requiredString(value: unknown, field: string, max: number): string {
  const parsed = optionalString(value, field, max);
  if (!parsed) throw new HttpError(400, `${field} es requerido.`);
  return parsed;
}

export function parseAiProvider(value: unknown): string | undefined {
  const parsed = optionalString(value, 'aiProvider', 40);
  if (!parsed) return undefined;
  if (!/^[a-z0-9_-]{1,40}$/i.test(parsed)) {
    throw new HttpError(400, 'aiProvider contiene caracteres no permitidos.');
  }
  return parsed.toLowerCase();
}

export function parseIngestBody(body: unknown): {
  url?: string;
  urls?: string[];
  rawText?: string;
  sourceTweet?: string;
  author?: string;
  status?: ToolStatus;
  entryType?: EntryType;
  aiProvider?: string;
} {
  const data = asObject(body);
  const url = optionalString(data.url, 'url', 8000);
  let urls: string[] | undefined;
  if (data.urls !== undefined) {
    if (!Array.isArray(data.urls)) throw new HttpError(400, 'urls debe ser una lista de textos.');
    if (data.urls.length > 100) throw new HttpError(400, 'urls admite como máximo 100 enlaces.');
    urls = data.urls.map((item, index) => requiredString(item, `urls[${index}]`, 4000));
  }
  const rawText = optionalString(data.rawText, 'rawText', 500_000);
  const sourceTweet = optionalString(data.sourceTweet, 'sourceTweet', 4000);
  const author = optionalString(data.author, 'author', 200);
  let status: ToolStatus | undefined;
  if (data.status !== undefined && data.status !== null && data.status !== '') {
    if (typeof data.status !== 'string' || !STATUSES.includes(data.status as ToolStatus)) {
      throw new HttpError(400, 'status debe ser to_try, in_use o archived.');
    }
    status = data.status as ToolStatus;
  }
  let entryType: EntryType | undefined;
  if (data.entryType !== undefined && data.entryType !== null && data.entryType !== '') {
    if (typeof data.entryType !== 'string' || !ENTRY_TYPES.includes(data.entryType as EntryType)) {
      throw new HttpError(400, 'entryType no es un tipo de ficha válido.');
    }
    entryType = data.entryType as EntryType;
  }
  const aiProvider = parseAiProvider(data.aiProvider);
  if (!url && (!urls || urls.length === 0) && !rawText && !sourceTweet) {
    throw new HttpError(400, 'Debes enviar url, urls, rawText o sourceTweet.');
  }
  return { url, urls, rawText, sourceTweet, author, status, entryType, aiProvider };
}

export function parseSlug(value: string): string {
  const slug = value.trim();
  if (!SLUG.test(slug)) throw new HttpError(400, 'El identificador de la ficha no es válido.');
  return slug;
}

export function parseRestoreBody(body: unknown): Array<{ slug: string; frontmatter: Record<string, unknown>; content?: string }> {
  const data = asObject(body);
  if (!Array.isArray(data.tools)) throw new HttpError(400, 'tools debe ser una lista.');
  if (data.tools.length > 5000) throw new HttpError(400, 'tools admite como máximo 5000 fichas.');
  const tools: Array<{ slug: string; frontmatter: Record<string, unknown>; content?: string }> = [];
  for (const item of data.tools) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.slug !== 'string' || !row.slug.trim()) continue;
    if (!row.frontmatter || typeof row.frontmatter !== 'object' || Array.isArray(row.frontmatter)) continue;
    const frontmatter = row.frontmatter as Record<string, unknown>;
    if (typeof frontmatter.name !== 'string' || !frontmatter.name.trim()) continue;
    let content: string | undefined;
    if (row.content !== undefined && row.content !== null) {
      if (typeof row.content !== 'string') continue;
      if (row.content.length > 500_000) throw new HttpError(400, 'El contenido de una ficha restaurada es demasiado grande.');
      content = row.content;
    }
    tools.push({ slug: row.slug, frontmatter, content });
  }
  return tools;
}

export function parseCategoryBody(body: unknown): {
  name: string;
  section?: 'all' | 'tools' | 'tips' | 'jobs';
  icon?: string;
  color?: string;
  description?: string;
} {
  const data = asObject(body);
  const name = requiredString(data.name, 'name', 80);
  if (/[\\/\0]/.test(name)) throw new HttpError(400, 'El nombre de la categoría no es válido.');
  let section: 'all' | 'tools' | 'tips' | 'jobs' | undefined;
  if (data.section !== undefined && data.section !== null && data.section !== '') {
    if (typeof data.section !== 'string' || !SECTIONS.includes(data.section as (typeof SECTIONS)[number])) {
      throw new HttpError(400, 'section debe ser all, tools, tips o jobs.');
    }
    section = data.section as 'all' | 'tools' | 'tips' | 'jobs';
  }
  const icon = optionalString(data.icon, 'icon', 16);
  let color: string | undefined;
  if (data.color !== undefined && data.color !== null && data.color !== '') {
    if (typeof data.color !== 'string' || !COLORS.includes(data.color as (typeof COLORS)[number])) {
      throw new HttpError(400, 'color no está en la paleta permitida.');
    }
    color = data.color;
  }
  const description = optionalString(data.description, 'description', 400);
  return { name, section, icon, color, description };
}

export function parseCategoryName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80 || /[\\/\0]/.test(name)) {
    throw new HttpError(400, 'El nombre de la categoría no es válido.');
  }
  return name;
}

export function parseBatchDelete(body: unknown): string[] {
  const data = asObject(body);
  if (!Array.isArray(data.slugs) || data.slugs.length === 0) {
    throw new HttpError(400, 'slugs debe ser una lista con al menos un elemento.');
  }
  if (data.slugs.length > 500) throw new HttpError(400, 'slugs admite como máximo 500 elementos.');
  const slugs: string[] = [];
  for (const item of data.slugs) {
    if (typeof item !== 'string') throw new HttpError(400, 'Cada slug debe ser texto.');
    slugs.push(parseSlug(item));
  }
  return [...new Set(slugs)];
}

export function parseThreadBody(body: unknown): { rawText: string; aiProvider?: string } {
  const data = asObject(body);
  const rawText = requiredString(data.rawText, 'rawText', 500_000);
  return { rawText, aiProvider: parseAiProvider(data.aiProvider) };
}

export function parseAuthorAnalyzeBody(body: unknown): { authorName: string; authorHandle?: string; aiProvider?: string } {
  const data = asObject(body);
  const authorName = requiredString(data.authorName, 'authorName', 120);
  let authorHandle = optionalString(data.authorHandle, 'authorHandle', 32);
  if (authorHandle) {
    authorHandle = authorHandle.replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(authorHandle)) {
      throw new HttpError(400, 'authorHandle no es un usuario de X válido.');
    }
  }
  return { authorName, authorHandle, aiProvider: parseAiProvider(data.aiProvider) };
}

export interface ToolPatch {
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
}

export function parseToolPatch(body: unknown): ToolPatch {
  const data = asObject(body);
  const patch: ToolPatch = {};
  if ('name' in data) patch.name = requiredString(data.name, 'name', 200);
  if ('url' in data) patch.url = requiredString(data.url, 'url', 4000);
  if ('status' in data) {
    if (typeof data.status !== 'string' || !STATUSES.includes(data.status as ToolStatus)) {
      throw new HttpError(400, 'status debe ser to_try, in_use o archived.');
    }
    patch.status = data.status as ToolStatus;
  }
  if ('notes' in data) {
    if (typeof data.notes !== 'string') throw new HttpError(400, 'notes debe ser texto.');
    if (data.notes.length > 500_000) throw new HttpError(400, 'notes supera el máximo permitido.');
    patch.notes = data.notes;
  }
  if ('category' in data) patch.category = requiredString(data.category, 'category', 80);
  if ('conjunto' in data) {
    if (typeof data.conjunto !== 'string' || !CONJUNTOS.includes(data.conjunto as ToolConjunto)) {
      throw new HttpError(400, 'conjunto debe ser recursos, inspiracion, producto o consejos.');
    }
    patch.conjunto = data.conjunto as ToolConjunto;
  }
  if ('tags' in data) {
    if (!Array.isArray(data.tags)) throw new HttpError(400, 'tags debe ser una lista de textos.');
    if (data.tags.length > 40) throw new HttpError(400, 'tags admite como máximo 40 elementos.');
    patch.tags = data.tags.map((tag, index) => requiredString(tag, `tags[${index}]`, 40));
  }
  const optionalFields = ['author', 'author_handle', 'source_tweet', 'location', 'salary', 'price', 'company', 'academic_promo_details'] as const;
  for (const field of optionalFields) {
    if (!(field in data)) continue;
    if (data[field] === null) {
      patch[field] = '';
      continue;
    }
    if (typeof data[field] !== 'string') throw new HttpError(400, `${field} debe ser texto.`);
    if ((data[field] as string).length > 4000) throw new HttpError(400, `${field} es demasiado largo.`);
    patch[field] = data[field] as string;
  }
  if ('has_academic_promo' in data) {
    if (typeof data.has_academic_promo !== 'boolean') throw new HttpError(400, 'has_academic_promo debe ser booleano.');
    patch.has_academic_promo = data.has_academic_promo;
  }
  if ('entry_type' in data) {
    if (typeof data.entry_type !== 'string' || !ENTRY_TYPES.includes(data.entry_type as EntryType)) {
      throw new HttpError(400, 'entry_type no es un tipo de ficha válido.');
    }
    patch.entry_type = data.entry_type as EntryType;
  }
  return patch;
}

export function parseSince(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new HttpError(400, 'since debe ser una fecha ISO o YYYY-MM-DD.');
  }
  return value;
}
