import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

export interface TaxonomyArea {
  id: string;
  name: string;
  definition: string;
  categories: string[];
}

export interface TaxonomyCategory {
  id: string;
  name: string;
  area: string;
  definition: string;
  inclusion_rules: string;
  moc: string;
}

export interface TaxonomyConjunto {
  id: string;
  name: string;
  definition: string;
  rule: string;
}

export interface TaxonomyFile {
  version: string;
  approved: string;
  approved_by: string;
  areas: TaxonomyArea[];
  categories: TaxonomyCategory[];
  conjuntos: TaxonomyConjunto[];
  conjunto_precedence: string[];
  code_hosts_regex: string;
  tag_facets: Array<{ facet: string; examples: string[]; why: string }>;
  tag_rules: { format: string; remove: string[]; order: string };
  tag_synonyms: Record<string, string[]>;
  tag_synonym_map: Record<string, string>;
  legacy_categories: string[];
  review_inbox: { id: string; name: string; definition: string };
}

export type CatalogSection = 'tools' | 'tips' | 'jobs';

export interface CategoryDefinition {
  name: string;
  id: string;
  area: string;
  section: CatalogSection;
  icon: string;
  color: string;
  description?: string;
  isDefault?: boolean;
}

/** Alias legacy → sucesora por defecto. Fuente: mapping.json category_rules (aprobado 2026-11-14). */
export interface LegacyAlias {
  old: string;
  defaultNew: string;
  defaultNewId: string;
  splitRequired: boolean;
}

export const LEGACY_ALIASES: LegacyAlias[] = [
  { old: 'Frontend & UI', defaultNew: 'Componentes & frameworks UI', defaultNewId: 'componentes-frameworks-ui', splitRequired: true },
  { old: 'AI & Machine Learning', defaultNew: 'Modelos, inferencia & APIs de IA', defaultNewId: 'modelos-inferencia-apis-de-ia', splitRequired: true },
  { old: 'Productivity & Tools', defaultNew: 'Apps de productividad & negocio', defaultNewId: 'apps-de-productividad-negocio', splitRequired: true },
  { old: 'Prompts, Art & Video', defaultNew: 'Video, audio, imagen & 3D', defaultNewId: 'video-audio-imagen-3d', splitRequired: true },
  { old: 'Agentes & Protocolo MCP', defaultNew: 'Agentes, MCP & automatización', defaultNewId: 'agentes-mcp-automatizacion', splitRequired: true },
  { old: 'Trabajo & Freelance', defaultNew: 'Empleo remoto & bolsas', defaultNewId: 'empleo-remoto-bolsas', splitRequired: true },
  { old: 'Documentation & Resources', defaultNew: 'Cursos, libros & rutas', defaultNewId: 'cursos-libros-rutas', splitRequired: true },
  { old: 'DevOps & Cloud', defaultNew: 'DevOps, cloud & self-hosting', defaultNewId: 'devops-cloud-self-hosting', splitRequired: true },
  { old: 'CLI & Terminal', defaultNew: 'Terminal, IDE & hardware', defaultNewId: 'terminal-ide-hardware', splitRequired: false },
  { old: 'Backend & APIs', defaultNew: 'Backend, APIs & datos', defaultNewId: 'backend-apis-datos', splitRequired: false },
  { old: 'Flujos de Trabajo', defaultNew: 'Guías, tips & buenas prácticas', defaultNewId: 'guias-tips-buenas-practicas', splitRequired: false },
  { old: 'DevTools & IDEs', defaultNew: 'Terminal, IDE & hardware', defaultNewId: 'terminal-ide-hardware', splitRequired: false },
  { old: 'Consejos & Buenas Prácticas', defaultNew: 'Guías, tips & buenas prácticas', defaultNewId: 'guias-tips-buenas-practicas', splitRequired: false },
  { old: 'Databases & Storage', defaultNew: 'Backend, APIs & datos', defaultNewId: 'backend-apis-datos', splitRequired: false },
  { old: 'Data Engineering & ETL', defaultNew: 'Backend, APIs & datos', defaultNewId: 'backend-apis-datos', splitRequired: false },
  { old: 'Empresas & Productos', defaultNew: 'Apps de productividad & negocio', defaultNewId: 'apps-de-productividad-negocio', splitRequired: false },
  { old: 'Productos Tecnológicos & Hardware', defaultNew: 'Terminal, IDE & hardware', defaultNewId: 'terminal-ide-hardware', splitRequired: false },
  { old: 'Document AI & Extracción', defaultNew: 'RAG, búsqueda & datos para IA', defaultNewId: 'rag-busqueda-datos-para-ia', splitRequired: false },
  { old: 'Other', defaultNew: 'Apps de productividad & negocio', defaultNewId: 'apps-de-productividad-negocio', splitRequired: false },
];

/** Nombres que la IA o un respaldo escribieron y que no están en las 19 legacy. */
const EXTRA_ALIASES: Record<string, string> = {
  'ides & development software': 'Terminal, IDE & hardware',
  'ides and development software': 'Terminal, IDE & hardware',
  ides: 'Terminal, IDE & hardware',
  'document ai': 'RAG, búsqueda & datos para IA',
  'document ai & extraccion': 'RAG, búsqueda & datos para IA',
  'document ai & extracción': 'RAG, búsqueda & datos para IA',
};

const AREA_STYLE: Record<string, { color: string; icon: string }> = {
  'desarrollo-software': { color: 'sky', icon: '🛠️' },
  'inteligencia-artificial': { color: 'purple', icon: '🤖' },
  'diseno-creatividad': { color: 'rose', icon: '🎨' },
  'productividad-utilidades': { color: 'teal', icon: '⚡' },
  aprendizaje: { color: 'violet', icon: '📚' },
  'trabajo-oportunidades': { color: 'amber', icon: '💼' },
};

const CATEGORY_ICONS: Record<string, string> = {
  'backend-apis-datos': '⚙️',
  'devops-cloud-self-hosting': '🐳',
  'terminal-ide-hardware': '🖥️',
  'seguridad-privacidad': '🔒',
  'modelos-inferencia-apis-de-ia': '🧠',
  'agentes-mcp-automatizacion': '🤖',
  'asistentes-de-codigo-skills': '✨',
  'rag-busqueda-datos-para-ia': '🔎',
  'voz-vision-ia-aplicada': '🎙️',
  'componentes-frameworks-ui': '🧩',
  'animacion-motion-web': '🌀',
  'recursos-graficos': '🎨',
  'inspiracion-ux-design-systems': '💡',
  'video-audio-imagen-3d': '🎬',
  'prompts-generacion-visual-con-ia': '🖼️',
  'apps-de-productividad-negocio': '⚡',
  'utilidades-web-archivos': '📎',
  'cursos-libros-rutas': '📚',
  'guias-tips-buenas-practicas': '📝',
  'investigacion-papers': '🔬',
  'empleo-remoto-bolsas': '💼',
  'entrenamiento-de-ia-microtareas': '🧪',
  'bounties-web3-concursos': '🏆',
  'creditos-planes-gratis-programas': '🎟️',
};

const CONJUNTO_ICONS: Record<string, string> = {
  codigo: '📦',
  app: '🚀',
  inspiracion: '💡',
  aprender: '📚',
  consejos: '🧠',
};

export const GUIAS_CATEGORY = 'Guías, tips & buenas prácticas';
export const TERMINAL_CATEGORY = 'Terminal, IDE & hardware';
export const EMPLEO_CATEGORY = 'Empleo remoto & bolsas';
export const CREDITOS_CATEGORY = 'Créditos, planes gratis & programas';
export const CURSOS_CATEGORY = 'Cursos, libros & rutas';
export const PAPERS_CATEGORY = 'Investigación & papers';
export const INSPIRACION_CATEGORY = 'Inspiración, UX & design systems';
export const APPS_CATEGORY = 'Apps de productividad & negocio';

const EMPLOYMENT_CATEGORIES = new Set([
  'Empleo remoto & bolsas',
  'Entrenamiento de IA & microtareas',
  'Bounties, Web3 & concursos',
]);

let cached: TaxonomyFile | null = null;
let cachedPath = '';

export function taxonomyPath(): string {
  return path.resolve(process.cwd(), 'data/taxonomy.json');
}

export function loadTaxonomy(): TaxonomyFile {
  const file = taxonomyPath();
  if (cached && cachedPath === file) return cached;
  const raw = fs.readFileSync(file, 'utf-8');
  cached = JSON.parse(raw) as TaxonomyFile;
  cachedPath = file;
  return cached;
}

export function taxonomySha256(): string {
  const raw = fs.readFileSync(taxonomyPath());
  return createHash('sha256').update(raw).digest('hex');
}

export function codeHostPattern(): RegExp {
  return new RegExp(loadTaxonomy().code_hosts_regex, 'i');
}

export function categoryByName(name?: string | null): TaxonomyCategory | undefined {
  const target = (name || '').trim().toLowerCase();
  if (!target) return undefined;
  return loadTaxonomy().categories.find((category) => category.name.toLowerCase() === target);
}

export function categoryById(id?: string | null): TaxonomyCategory | undefined {
  if (!id) return undefined;
  return loadTaxonomy().categories.find((category) => category.id === id);
}

export function areaById(id?: string | null): TaxonomyArea | undefined {
  if (!id) return undefined;
  return loadTaxonomy().areas.find((area) => area.id === id);
}

export function canonicalCategoryName(name?: string | null): string | undefined {
  return categoryByName(name)?.name;
}

export function isTaxonomyCategory(name?: string | null): boolean {
  return Boolean(canonicalCategoryName(name));
}

export function legacyAlias(name?: string | null): LegacyAlias | undefined {
  const target = (name || '').trim().toLowerCase();
  if (!target) return undefined;
  return LEGACY_ALIASES.find((alias) => alias.old.toLowerCase() === target);
}

export function aliasTarget(name?: string | null): string | undefined {
  const legacy = legacyAlias(name);
  if (legacy) return legacy.defaultNew;
  const extra = EXTRA_ALIASES[(name || '').trim().toLowerCase()];
  return extra;
}

export function isEmploymentCategory(name?: string | null): boolean {
  const canonical = canonicalCategoryName(name);
  return Boolean(canonical && EMPLOYMENT_CATEGORIES.has(canonical));
}

export function categoryOmitsConjunto(name?: string | null): boolean {
  return isEmploymentCategory(name);
}

/** Trabajo & oportunidades → jobs. Guías → tips. El resto → tools. */
export function sectionForCategory(name?: string | null): CatalogSection {
  const category = categoryByName(name);
  if (!category) return 'tools';
  if (category.area === 'trabajo-oportunidades') return 'jobs';
  if (category.id === 'guias-tips-buenas-practicas') return 'tips';
  return 'tools';
}

export function areaIdForCategory(name?: string | null): string | undefined {
  return categoryByName(name)?.area;
}

export function areaNameForCategory(name?: string | null): string | undefined {
  const id = areaIdForCategory(name);
  return id ? areaById(id)?.name : undefined;
}

export function categoryDefinitions(): CategoryDefinition[] {
  const taxonomy = loadTaxonomy();
  return taxonomy.categories.map((category) => {
    const style = AREA_STYLE[category.area] || { color: 'slate', icon: '📁' };
    return {
      name: category.name,
      id: category.id,
      area: category.area,
      section: sectionForCategory(category.name),
      icon: CATEGORY_ICONS[category.id] || style.icon,
      color: style.color,
      description: category.definition,
      isDefault: true,
    };
  });
}

export function conjuntoIds(): string[] {
  return loadTaxonomy().conjuntos.map((conjunto) => conjunto.id);
}

export function isConjuntoId(value?: string | null): boolean {
  const id = (value || '').trim().toLowerCase();
  return conjuntoIds().includes(id);
}

export interface TaxonomyUiPayload {
  version: string;
  sha256: string;
  areas: Array<{
    id: string;
    name: string;
    definition: string;
    icon: string;
    color: string;
    categories: string[];
  }>;
  categories: CategoryDefinition[];
  conjuntos: Array<{ id: string; name: string; icon: string; definition: string }>;
  aliases: Record<string, string>;
  legacySections: Record<string, { area?: string; category?: string }>;
  legacyConjuntos: Record<string, string | string[]>;
}

export function taxonomyUiPayload(): TaxonomyUiPayload {
  const taxonomy = loadTaxonomy();
  const definitions = categoryDefinitions();
  const byArea = new Map<string, string[]>();
  for (const category of taxonomy.categories) {
    const list = byArea.get(category.area) || [];
    list.push(category.name);
    byArea.set(category.area, list);
  }
  const aliases: Record<string, string> = {};
  for (const alias of LEGACY_ALIASES) aliases[alias.old.toLowerCase()] = alias.defaultNew;
  for (const [key, value] of Object.entries(EXTRA_ALIASES)) aliases[key.toLowerCase()] = value;

  return {
    version: taxonomy.version,
    sha256: taxonomySha256(),
    areas: taxonomy.areas.map((area) => {
      const style = AREA_STYLE[area.id] || { color: 'slate', icon: '📁' };
      return {
        id: area.id,
        name: area.name,
        definition: area.definition,
        icon: style.icon,
        color: style.color,
        categories: byArea.get(area.id) || [],
      };
    }),
    categories: definitions,
    conjuntos: taxonomy.conjuntos.map((conjunto) => ({
      id: conjunto.id,
      name: conjunto.name,
      icon: CONJUNTO_ICONS[conjunto.id] || '📁',
      definition: conjunto.definition,
    })),
    aliases,
    legacySections: {
      jobs: { area: 'trabajo-oportunidades' },
      tips: { category: GUIAS_CATEGORY },
      tools: { area: 'all' },
    },
    legacyConjuntos: {
      producto: 'app',
      recursos: ['codigo', 'app'],
    },
  };
}

export function taxonomyPromptBlock(): string {
  const taxonomy = loadTaxonomy();
  const areas = taxonomy.areas
    .map((area) => {
      const cats = taxonomy.categories
        .filter((category) => category.area === area.id)
        .map((category) => `  - "${category.name}": ${category.definition} ${category.inclusion_rules}`)
        .join('\n');
      return `Área "${area.name}": ${area.definition}\n${cats}`;
    })
    .join('\n');
  const conjuntos = taxonomy.conjuntos
    .map((conjunto) => `- "${conjunto.id}" (${conjunto.name}): ${conjunto.definition} ${conjunto.rule}`)
    .join('\n');
  return `TAXONOMÍA VIGENTE (elige EXACTAMENTE una categoría de esta lista; no uses nombres anteriores):
${areas}

Conjuntos (elige uno, salvo empleos de vacantes, microtareas o bounties, que van sin conjunto):
${conjuntos}
Precedencia del conjunto: ${taxonomy.conjunto_precedence.join(' → ')}.
Un empleo (entryType job_remote de vacante, microtarea o bounty) NO lleva conjunto. "Créditos, planes gratis & programas" sí lleva conjunto.
Tags: ${taxonomy.tag_rules.format}. No uses la etiqueta "tool" ni "conjunto-<x>".`;
}

const STACK_TAGS = new Set(
  (loadTaxonomy().tag_facets.find((facet) => facet.facet === 'stack')?.examples || []).map((tag) => tag.toLowerCase())
);

export function foldText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** minúsculas, kebab-case, sin acentos, y sinónimo canónico. */
export function normalizeTag(raw: unknown): string {
  const folded = foldText(raw)
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!folded) return '';
  const map = loadTaxonomy().tag_synonym_map;
  return map[folded] || folded;
}

export function normalizeTags(tags: unknown, conjunto?: string | null, limit?: number): string[] {
  const list = Array.isArray(tags) ? tags : [];
  const conjuntoId = (conjunto || '').trim().toLowerCase();
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const tag of list) {
    const next = normalizeTag(tag);
    if (!next || next === 'tool') continue;
    if (next.startsWith('conjunto-')) continue;
    if (conjuntoId && next === conjuntoId) continue;
    if (seen.has(next)) continue;
    seen.add(next);
    cleaned.push(next);
  }
  cleaned.sort((a, b) => {
    const aStack = STACK_TAGS.has(a) ? 0 : 1;
    const bStack = STACK_TAGS.has(b) ? 0 : 1;
    return aStack - bStack;
  });
  if (limit && cleaned.length > limit) return cleaned.slice(0, limit);
  return cleaned;
}
