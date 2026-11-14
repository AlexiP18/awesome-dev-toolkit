import {
  APPS_CATEGORY,
  CREDITOS_CATEGORY,
  CURSOS_CATEGORY,
  EMPLEO_CATEGORY,
  GUIAS_CATEGORY,
  INSPIRACION_CATEGORY,
  PAPERS_CATEGORY,
  TERMINAL_CATEGORY,
  aliasTarget,
  categoryOmitsConjunto,
  codeHostPattern,
  foldText,
  isTaxonomyCategory,
  legacyAlias,
} from './taxonomy.js';

export interface ClassifyInput {
  slug: string;
  category?: string | null;
  conjunto?: string | null;
  entryType?: string | null;
  tags?: string[] | null;
  name?: string | null;
  summary?: string | null;
  url?: string | null;
}

export interface ClassifyOutcome {
  category: string;
  review: boolean;
  ruleStep: string;
  area?: string;
}

const JOBS_RLHF = 'invisible imerit labelbox dataannotation innodata clickworker alignerr objectways mercor appen oneforma microworkers rws prolific welocalize toloka remotasks surge telus turing outlier scale'.split(' ');
const JOBS_WEB3 = 'bug-bounty bounty plether sherlock galxe dework laborx layer3 superteam anambra web3 dao crypto'.split(' ');
const CREDITOS_KW = ['credito', 'creditos', 'credits', 'free-tier', 'creditos-gratis', 'plan-gratuito', 'estudiantes', 'students', 'developer-program', 'promo', 'uspromo', 'hackathon', 'x-premium'];
const PAPERS_KW = ['papers', 'arxiv', 'busqueda-academica', 'busqueda-cientifica', 'investigacion-academica', 'sci-hub', 'acceso-abierto', 'survey'];
const LEARN_KW = ['curso', 'cursos', 'course', 'libro', 'libros', 'book', 'books', 'ebooks', 'tutorial', 'tutorials', 'curriculum', 'educacion', 'education', 'educational', 'aprendizaje', 'learning', 'roadmap', 'biblioteca', 'for-beginners', 'from-scratch', 'interview'];
const LEARN_KEEP = ['curso', 'cursos', 'course', 'libro', 'libros', 'book', 'curriculum'];
const HARDWARE_KW = ['hardware', 'sbc', 'raspberrypi', 'esp32'];
const SECURITY_KW = ['seguridad', 'security', 'ciberseguridad', 'vpn', 'malware', 'passwords', 'brechas-de-datos', 'email-temporal', 'pentesting', 'osint', 'privacidad', 'privacy'];
const SECURITY_CATS = new Set(['Productivity & Tools', 'DevOps & Cloud', 'CLI & Terminal', 'Backend & APIs']);
const CODE_ASSIST_KW = ['claude-code', 'codex', 'cursor', 'coding-agents', 'coding_agents', 'agent-skills', 'skills', 'skill', 'ai-skill', 'vibe-coding', 'vibecoding', 'agent-harness', 'harness-engineering', 'ide', 'opencode', 'gemini-cli', 'copilot'];
const AGENTS_KW = ['mcp', 'mcp-server', 'ai-agents', 'agents', 'agent', 'agentes', 'agente', 'agentes-ia', 'multi-agent', 'agent-framework', 'memory', 'browser-automation', 'langgraph', 'a2a', 'agentic-ai', 'n8n', 'workflows', 'automatizacion', 'automation'];
const RAG_KW = ['rag', 'pdf', 'ocr', 'extraccion', 'extraccion-datos', 'documentos', 'search-api', 'vector-database', 'embeddings', 'deep-research', 'web-scraping', 'scraping', 'notebooklm', 'knowledge-graph', 'grafo'];
const VOICE_KW = ['tts', 'text-to-speech', 'speech-to-text', 'speech', 'whisper', 'transcription', 'transcripcion', 'audio-generation', 'voice', 'voz', 'yolov9', 'computer-vision', 'vision', 'segmentation', 'earth-observation', 'geospatial', 'satelite', 'aerial', 'traduccion', 'nlp', 'ocr'];
const AI_SCOPE = new Set(['AI & Machine Learning', 'Agentes & Protocolo MCP', 'DevTools & IDEs', 'CLI & Terminal', 'Productivity & Tools', 'Backend & APIs', 'DevOps & Cloud']);
const PROD_DEVOPS = ['self-hosted', 'selfhosted', 'docker', 'dns', 'media-server', 'homelab'];
const PROD_BACKEND = ['api', 'apis', 'database', 'sql', 'scraping', 'web-scraping', 'crawler', 'backend'];
const PROD_TERMINAL = ['cli', 'terminal', 'git', 'editor', 'vscode'];
const PROD_VIDEO = ['video', 'audio', 'musica', 'music', 'podcast', 'grabacion', 'screen-recording', 'imagenes', 'fotos', 'edicion-video'];
const PROD_AI = ['ia', 'ai', 'llm', 'chatgpt'];
const PROD_UTIL = ['pdf', 'conversion', 'convertidor', 'descargas', 'downloader', 'archivo', 'archive', 'web-archive', 'paywall', 'compresion', 'utilidades', 'utility', 'json', 'temp'];
const PROMPT_KW = ['prompts', 'prompt', 'image-generation', 'midjourney', 'nano-banana', 'generacion-imagenes', 'ai-video', 'sora', 'veo', 'kling', 'higgsfield', 'ai-art', 'ia-generativa', 'text-to-image', 'text-to-video', 'seedance'];
const MOTION_A = ['animation', 'animaciones', 'animacion', 'motion', 'motion-graphics', 'gsap', 'lottie'];
const MOTION_B = ['web', 'css', 'react', 'javascript', 'framer', 'svg'];
const GRAPHIC_KW = ['icons', 'iconos', 'icon', 'fonts', 'fuentes', 'tipografia', 'typography', 'colores', 'color', 'colors', 'paletas', 'ilustraciones', 'illustrations', 'mockups', 'mockup', 'gradients', 'gradientes', 'patterns', 'logos', 'fondos', 'backgrounds', 'emojis', '3d-icons', 'avatars'];
const GRAPHIC_KW_2 = [...GRAPHIC_KW, 'svg-icons', 'imagenes', 'stock'];
const INSP_KW = ['inspiracion', 'galeria', 'gallery', 'showcase', 'landing-pages', 'portfolio', 'portafolio', 'awwwards', 'directorio', 'directory', 'ux', 'design-system', 'design-systems', 'branding', 'figma', 'ux-ui', 'uiux', 'guidelines'];
const FRONT_MOTION = ['animation', 'animaciones', 'animacion', 'animations', 'motion', 'gsap', 'webgl', 'threejs', 'three-js', 'shaders', 'scroll', 'framer-motion', 'lottie', '3d', 'particles', 'creative-coding', 'canvas'];

/** Categorías exclusivas del toolkit → equivalente de la bóveda, antes de las reglas. */
const TOOLKIT_PREMAP: Record<string, string> = {
  'Consejos & Buenas Prácticas': 'Flujos de Trabajo',
  'Databases & Storage': 'Backend & APIs',
  'Data Engineering & ETL': 'Backend & APIs',
  'Document AI & Extracción': 'AI & Machine Learning',
  'Empresas & Productos': 'Productivity & Tools',
  'Productos Tecnológicos & Hardware': 'DevTools & IDEs',
  Other: 'Productivity & Tools',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Palabra completa: 'learning' no casa dentro de 'deep-learning'. */
export function hasWord(text: string, words: string[]): boolean {
  return words.some((word) => new RegExp(`(?<![a-z0-9-])${escapeRegExp(word)}(?![a-z0-9-])`).test(text));
}

export function premapToolkitCategory(category?: string | null): string {
  const trimmed = (category || '').trim();
  return TOOLKIT_PREMAP[trimmed] || trimmed;
}

function decided(category: string, ruleStep: string): ClassifyOutcome {
  return { category, review: false, ruleStep };
}

/**
 * Reglas de mapping.json → heuristic_rules, en el orden de reference_implementation_python.
 * La categoría de entrada ya debe haber pasado por premapToolkitCategory.
 */
export function classifyCategory(input: ClassifyInput): ClassifyOutcome {
  const slug = foldText(input.slug || '');
  const name = foldText(input.name || '');
  const tags = (input.tags || []).map((tag) => foldText(tag));
  const tg = tags.join(' ');
  const summary = foldText(input.summary || '');
  const text = [slug, name, tg, summary].join(' ');
  const cat = (input.category || '').trim();
  const conj = (input.conjunto || '').trim().toLowerCase();
  const entry = (input.entryType || '').trim();

  if (slug.startsWith('revisar-bookmark')) return { category: '', review: true, ruleStep: '0' };

  if (cat === 'Trabajo & Freelance' || entry === 'job_remote') {
    if (JOBS_RLHF.some((word) => text.includes(word))) return decided('Entrenamiento de IA & microtareas', '1.rlhf');
    if (JOBS_WEB3.some((word) => text.includes(word))) return decided('Bounties, Web3 & concursos', '1.web3');
    return decided(EMPLEO_CATEGORY, '1.empleo');
  }

  const slugTags = `${slug} ${tg}`;
  if (hasWord(slugTags, CREDITOS_KW) || /cr[e]?dito|free-tier|plan-gratuito/.test(slug)) {
    return decided(CREDITOS_CATEGORY, '2');
  }
  if (hasWord(text, PAPERS_KW)) return decided(PAPERS_CATEGORY, '3');
  if (entry === 'tech_tip' || cat === 'Flujos de Trabajo') return decided(GUIAS_CATEGORY, '4');
  if (cat === 'Documentation & Resources' || hasWord(tg, LEARN_KW)) {
    if (conj === 'consejos' && !hasWord(tg, LEARN_KEEP)) return decided(GUIAS_CATEGORY, '5.guias');
    return decided(CURSOS_CATEGORY, '5');
  }
  if (entry === 'tech_product' || hasWord(tg, HARDWARE_KW)) return decided(TERMINAL_CATEGORY, '6');
  if (hasWord(tg, SECURITY_KW) && SECURITY_CATS.has(cat)) return decided('Seguridad & privacidad', '7');

  const ai = cat === 'AI & Machine Learning' || cat === 'Agentes & Protocolo MCP';
  if (AI_SCOPE.has(cat)) {
    if (/claude-code|codex|cursor|skill/.test(slug) && ai) return decided('Asistentes de código & skills', '8.slug');
    if (hasWord(tg, CODE_ASSIST_KW) && (ai || cat === 'DevTools & IDEs' || hasWord(tg, ['claude-code', 'codex', 'agent-skills']))) {
      return decided('Asistentes de código & skills', '8.asistentes');
    }
    if (hasWord(tg, AGENTS_KW) && (ai || hasWord(tg, ['mcp', 'ai-agents', 'agentes']))) {
      return decided('Agentes, MCP & automatización', '8.agentes');
    }
    if (ai && hasWord(tg, RAG_KW)) return decided('RAG, búsqueda & datos para IA', '8.rag');
    if (ai && hasWord(tg, VOICE_KW)) return decided('Voz, visión & IA aplicada', '8.voz');
    if (ai) return decided('Modelos, inferencia & APIs de IA', '8.modelos');
  }

  if (cat === 'Backend & APIs') return decided('Backend, APIs & datos', '9');
  if (cat === 'DevOps & Cloud') return decided('DevOps, cloud & self-hosting', '10');
  if (cat === 'CLI & Terminal' || cat === 'DevTools & IDEs') return decided(TERMINAL_CATEGORY, '11');

  if (cat === 'Productivity & Tools') {
    if (hasWord(tg, PROD_DEVOPS)) return decided('DevOps, cloud & self-hosting', '12.devops');
    if (hasWord(tg, PROD_BACKEND)) return decided('Backend, APIs & datos', '12.backend');
    if (hasWord(tg, PROD_TERMINAL)) return decided(TERMINAL_CATEGORY, '12.terminal');
    if (hasWord(tg, PROD_VIDEO)) return decided('Video, audio, imagen & 3D', '12.video');
    if (hasWord(tg, PROD_AI)) return decided('Modelos, inferencia & APIs de IA', '12.ia');
    if (hasWord(tg, PROD_UTIL)) return decided('Utilidades web & archivos', '12.util');
    return decided(APPS_CATEGORY, '12.apps');
  }

  if (cat === 'Prompts, Art & Video') {
    if (hasWord(tg, PROMPT_KW)) return decided('Prompts & generación visual con IA', '13.prompts');
    if (hasWord(tg, MOTION_A) && hasWord(tg, MOTION_B)) return decided('Animación & motion web', '13.motion');
    return decided('Video, audio, imagen & 3D', '13.video');
  }

  if (cat === 'Frontend & UI') {
    if (hasWord(tg, GRAPHIC_KW)) return decided('Recursos gráficos', '14.graficos');
    if (conj === 'inspiracion' || hasWord(tg, INSP_KW)) return decided(INSPIRACION_CATEGORY, '14.inspiracion');
    if (hasWord(tg, GRAPHIC_KW_2)) return decided('Recursos gráficos', '14.graficos2');
    if (hasWord(tg, FRONT_MOTION)) return decided('Animación & motion web', '14.motion');
    return decided('Componentes & frameworks UI', '14.ui');
  }

  if (isTaxonomyCategory(cat)) return decided(cat, 'identity');
  return { category: '', review: true, ruleStep: `sin-regla:${cat}` };
}

export function isCodeHost(url?: string | null): boolean {
  return codeHostPattern().test(url || '');
}

/**
 * Precedencia de conjunto (taxonomy.json + reference conj_new).
 * Los empleos y la bandeja quedan sin conjunto. Créditos sí lleva.
 */
export function assignConjunto(input: {
  category?: string | null;
  conjunto?: string | null;
  entryType?: string | null;
  url?: string | null;
  review?: boolean;
}): string | undefined {
  if (input.review || !input.category) return undefined;
  if (categoryOmitsConjunto(input.category)) return undefined;
  const conj = (input.conjunto || '').trim().toLowerCase();
  const entry = (input.entryType || '').trim();
  const category = input.category;
  const code = isCodeHost(input.url);
  if (conj === 'inspiracion' || (category === INSPIRACION_CATEGORY && conj !== 'consejos' && !code)) {
    return 'inspiracion';
  }
  if (category === CURSOS_CATEGORY || category === PAPERS_CATEGORY) return 'aprender';
  if (conj === 'consejos' || entry === 'tech_tip' || category === GUIAS_CATEGORY) return 'consejos';
  if (code) return 'codigo';
  return 'app';
}

export interface ResolvedClassification {
  category: string;
  conjunto?: string;
  review: boolean;
  ruleStep: string;
}

/**
 * Identidad si el nombre ya es de la taxonomía.
 * Legacy con split: reglas. Legacy sin split: alias.
 * tech_tip, tech_product, job_remote y product_showcase aplican las reglas especiales.
 */
function withConjunto(category: string, input: ClassifyInput, entry: string, ruleStep: string, review = false): ResolvedClassification {
  return {
    category,
    conjunto: assignConjunto({ ...input, category, entryType: entry, review }),
    review,
    ruleStep,
  };
}

export function resolveClassification(input: ClassifyInput & { applySplit?: boolean }): ResolvedClassification {
  const raw = (input.category || '').trim();
  const entry = (input.entryType || '').trim();
  if (isTaxonomyCategory(raw)) return withConjunto(raw, input, entry, 'identity');

  if (input.applySplit === false) {
    const alias = legacyAlias(raw);
    if (alias) return withConjunto(alias.defaultNew, input, entry, 'alias');
    return { category: '', review: true, ruleStep: 'review' };
  }

  const alias = legacyAlias(raw);
  const needsRules = !alias || alias.splitRequired || entry === 'product_showcase' || entry === 'job_remote' || entry === 'tech_tip' || entry === 'tech_product' || !raw;
  if (!needsRules && alias) return withConjunto(alias.defaultNew, input, entry, 'alias');

  const seeded = raw || (entry === 'product_showcase' ? 'Empresas & Productos' : raw);
  const outcome = classifyCategory({ ...input, category: premapToolkitCategory(seeded), entryType: entry });
  if (!outcome.category) return { category: '', review: true, ruleStep: outcome.ruleStep };
  return withConjunto(outcome.category, input, entry, outcome.ruleStep, outcome.review);
}

/** Import del vault: identidad en nombres nuevos; alias default_new en legacy, sin re-split. */
export function mapImportedCategory(raw?: string | null, entryType?: string | null): { category: string; review: boolean } {
  const trimmed = (raw || '').trim();
  if (isTaxonomyCategory(trimmed)) return { category: trimmed, review: false };
  const alias = aliasTarget(trimmed);
  if (alias) return { category: alias, review: false };
  if (entryType === 'tech_tip') return { category: GUIAS_CATEGORY, review: Boolean(trimmed) };
  if (entryType === 'tech_product') return { category: TERMINAL_CATEGORY, review: Boolean(trimmed) };
  if (entryType === 'job_remote') return { category: EMPLEO_CATEGORY, review: Boolean(trimmed) };
  if (entryType === 'product_showcase') return { category: APPS_CATEGORY, review: Boolean(trimmed) };
  return { category: '', review: true };
}
