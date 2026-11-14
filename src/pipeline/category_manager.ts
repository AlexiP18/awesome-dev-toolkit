import fs from 'fs';
import path from 'path';
import { unmarkRepoPathDeleted } from './github_sync.js';
import { ClassifyInput, mapImportedCategory, resolveClassification } from './classify_rules.js';
import {
  CatalogSection,
  CategoryDefinition,
  LEGACY_ALIASES,
  aliasTarget,
  canonicalCategoryName,
  categoryDefinitions,
  isTaxonomyCategory,
  legacyAlias,
} from './taxonomy.js';

export type { CategoryDefinition };

export const DEFAULT_CATEGORIES: CategoryDefinition[] = categoryDefinitions();

const CATEGORIES_FILE = path.resolve(process.cwd(), 'data/categories.json');

export function ensureCategoriesFile(): void {
  const dir = path.dirname(CATEGORIES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(CATEGORIES_FILE)) {
    fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(DEFAULT_CATEGORIES, null, 2), 'utf-8');
  }
}

function isLegacyName(name: string): boolean {
  return LEGACY_ALIASES.some((alias) => alias.old.toLowerCase() === name.trim().toLowerCase());
}

/**
 * Los defaults salen de taxonomy.json. El archivo solo puede ajustar icono,
 * color o descripción de una categoría de la taxonomía. Un nombre legacy no reaparece.
 */
export function getAllCategories(): CategoryDefinition[] {
  ensureCategoriesFile();
  const map = new Map<string, CategoryDefinition>();
  for (const category of categoryDefinitions()) map.set(category.name.toLowerCase(), category);
  try {
    const parsed = JSON.parse(fs.readFileSync(CATEGORIES_FILE, 'utf-8'));
    if (Array.isArray(parsed)) {
      for (const item of parsed as CategoryDefinition[]) {
        if (!item?.name || isLegacyName(item.name) || !isTaxonomyCategory(item.name)) continue;
        const key = item.name.toLowerCase();
        const base = map.get(key);
        if (!base) continue;
        map.set(key, {
          ...base,
          icon: item.icon?.trim() || base.icon,
          color: item.color || base.color,
          description: item.description?.trim() || base.description,
          isDefault: true,
        });
      }
    }
  } catch (err) {
    console.warn('[Category Manager] Error leyendo data/categories.json:', err);
  }
  return categoryDefinitions().map((category) => map.get(category.name.toLowerCase()) || category);
}

export function getAllCategoryNames(): string[] {
  return getAllCategories().map((category) => category.name);
}

/** legacy → sucesora por defecto. Los splits finos viven en classify_rules. */
export const CATEGORY_ALIASES: Record<string, string> = Object.fromEntries([
  ...LEGACY_ALIASES.map((alias) => [alias.old.toLowerCase(), alias.defaultNew]),
  ['ides & development software', 'Terminal, IDE & hardware'],
  ['ides and development software', 'Terminal, IDE & hardware'],
  ['ides', 'Terminal, IDE & hardware'],
  ['document ai', 'RAG, búsqueda & datos para IA'],
  ['document ai & extraccion', 'RAG, búsqueda & datos para IA'],
  ['document ai & extracción', 'RAG, búsqueda & datos para IA'],
]);

/** Palabras de las reglas heurísticas, para quien clasifique sin el texto completo. */
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Backend, APIs & datos': ['backend', 'api', 'apis', 'database', 'sql', 'scraping', 'crawler'],
  'DevOps, cloud & self-hosting': ['devops', 'cloud', 'docker', 'self-hosted', 'homelab', 'dns'],
  'Terminal, IDE & hardware': ['cli', 'terminal', 'git', 'editor', 'vscode', 'hardware', 'ide'],
  'Seguridad & privacidad': ['seguridad', 'security', 'vpn', 'malware', 'privacy', 'osint'],
  'Modelos, inferencia & APIs de IA': ['llm', 'modelo', 'inferencia', 'chatgpt'],
  'Agentes, MCP & automatización': ['mcp', 'agente', 'agent', 'n8n', 'automation'],
  'Asistentes de código & skills': ['claude-code', 'codex', 'cursor', 'skill', 'copilot'],
  'RAG, búsqueda & datos para IA': ['rag', 'embeddings', 'ocr', 'pdf', 'vector-database'],
  'Voz, visión & IA aplicada': ['tts', 'whisper', 'vision', 'voz', 'transcripcion'],
  'Componentes & frameworks UI': ['react', 'css', 'tailwind', 'componente', 'ui'],
  'Animación & motion web': ['gsap', 'motion', 'webgl', 'threejs', 'shader', 'lottie'],
  'Recursos gráficos': ['icon', 'font', 'mockup', 'ilustracion', 'palette'],
  'Inspiración, UX & design systems': ['inspiracion', 'gallery', 'figma', 'ux', 'design-system'],
  'Video, audio, imagen & 3D': ['video', 'audio', 'blender', 'musica', 'imagen'],
  'Prompts & generación visual con IA': ['prompt', 'midjourney', 'sora', 'text-to-image'],
  'Apps de productividad & negocio': ['productividad', 'notas', 'finanzas', 'saas'],
  'Utilidades web & archivos': ['pdf', 'convertidor', 'downloader', 'paywall', 'json'],
  'Cursos, libros & rutas': ['curso', 'libro', 'roadmap', 'tutorial', 'curriculum'],
  'Guías, tips & buenas prácticas': ['tip', 'guia', 'cheatsheet', 'practica'],
  'Investigación & papers': ['paper', 'arxiv', 'survey'],
  'Empleo remoto & bolsas': ['empleo', 'vacante', 'remoto', 'hiring'],
  'Entrenamiento de IA & microtareas': ['rlhf', 'microtarea', 'anotacion'],
  'Bounties, Web3 & concursos': ['bounty', 'web3', 'dao'],
  'Créditos, planes gratis & programas': ['credito', 'free-tier', 'hackathon', 'estudiante'],
};

export function isAllowedCategory(name?: string | null): boolean {
  return isTaxonomyCategory(name);
}

export interface CoerceContext {
  slug?: string;
  name?: string;
  tags?: string[];
  summary?: string;
  conjunto?: string | null;
  url?: string | null;
}

/**
 * Categoría de la taxonomía.
 * Un nombre vigente se conserva. Un legacy con split pasa por las reglas si hay contexto;
 * si no, cae en la sucesora por defecto. Sin categoría reconocible, la ficha va a revisión.
 */
export function coerceCategory(raw?: string | null, entryType?: string | null, context?: CoerceContext): string {
  const trimmed = (raw || '').trim();
  const direct = canonicalCategoryName(trimmed);
  if (direct) return direct;

  const input: ClassifyInput = {
    slug: context?.slug || '',
    category: trimmed,
    conjunto: context?.conjunto,
    entryType,
    tags: context?.tags,
    name: context?.name,
    summary: context?.summary,
    url: context?.url,
  };
  const alias = legacyAlias(trimmed);
  if (alias?.splitRequired && context) {
    const resolved = resolveClassification({ ...input, applySplit: true });
    if (resolved.category) return resolved.category;
  }
  const target = aliasTarget(trimmed);
  if (target) return target;

  if (entryType === 'tech_tip' || entryType === 'tech_product' || entryType === 'job_remote' || entryType === 'product_showcase') {
    const resolved = resolveClassification({ ...input, applySplit: true });
    if (resolved.category) return resolved.category;
  }
  return '';
}

/** Identidad en las 24 categorías. Los 19 nombres legacy usan el alias, sin parecido por palabras. */
export function mapVaultCategory(raw?: string | null, entryType?: string | null): string {
  const mapped = mapImportedCategory(raw, entryType);
  return mapped.category;
}

export function categoryNeedsReview(raw?: string | null, entryType?: string | null): boolean {
  return mapImportedCategory(raw, entryType).review;
}

export function saveAllCategories(categories: CategoryDefinition[]): void {
  ensureCategoriesFile();
  const allowed = categories.filter((category) => isTaxonomyCategory(category.name) && !isLegacyName(category.name));
  fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(allowed, null, 2), 'utf-8');
  unmarkRepoPathDeleted(CATEGORIES_FILE);
}

export function addCustomCategory(newCat: Partial<CategoryDefinition> & { name: string; section?: CatalogSection | 'all' }): CategoryDefinition {
  const canonical = canonicalCategoryName(newCat.name);
  if (!canonical) {
    throw new Error(`"${newCat.name.trim()}" no está en la taxonomía. Elige una de las 24 categorías.`);
  }
  const all = getAllCategories();
  const existingIdx = all.findIndex((category) => category.name.toLowerCase() === canonical.toLowerCase());
  const base = all[existingIdx];
  const requested = newCat.section;
  const section: CatalogSection = requested === 'tips' || requested === 'jobs' || requested === 'tools' ? requested : base.section;
  const categoryItem: CategoryDefinition = {
    ...base,
    name: canonical,
    section,
    icon: newCat.icon?.trim() || base.icon,
    color: newCat.color || base.color,
    description: newCat.description?.trim() || base.description,
    isDefault: true,
  };
  all[existingIdx] = categoryItem;
  saveAllCategories(all);
  return categoryItem;
}

export function deleteCustomCategory(name: string): boolean {
  const all = getAllCategories();
  const target = all.find((category) => category.name.toLowerCase() === name.toLowerCase());
  if (!target) return false;
  if (target.isDefault || isTaxonomyCategory(target.name)) {
    throw new Error(`La categoría "${target.name}" pertenece a la taxonomía y no se puede eliminar.`);
  }
  saveAllCategories(all.filter((category) => category.name.toLowerCase() !== name.toLowerCase()));
  return true;
}
