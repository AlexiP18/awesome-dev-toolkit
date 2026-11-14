export type StandardCategory =
  | 'Backend, APIs & datos'
  | 'DevOps, cloud & self-hosting'
  | 'Terminal, IDE & hardware'
  | 'Seguridad & privacidad'
  | 'Modelos, inferencia & APIs de IA'
  | 'Agentes, MCP & automatización'
  | 'Asistentes de código & skills'
  | 'RAG, búsqueda & datos para IA'
  | 'Voz, visión & IA aplicada'
  | 'Componentes & frameworks UI'
  | 'Animación & motion web'
  | 'Recursos gráficos'
  | 'Inspiración, UX & design systems'
  | 'Video, audio, imagen & 3D'
  | 'Prompts & generación visual con IA'
  | 'Apps de productividad & negocio'
  | 'Utilidades web & archivos'
  | 'Cursos, libros & rutas'
  | 'Guías, tips & buenas prácticas'
  | 'Investigación & papers'
  | 'Empleo remoto & bolsas'
  | 'Entrenamiento de IA & microtareas'
  | 'Bounties, Web3 & concursos'
  | 'Créditos, planes gratis & programas';

export type ToolCategory = StandardCategory | (string & {});

export type EntryType = 'tool' | 'product_showcase' | 'tech_tip' | 'job_remote' | 'tech_product';

export type ToolConjunto = 'codigo' | 'app' | 'inspiracion' | 'aprender' | 'consejos';

export type ToolStatus = 'to_try' | 'in_use' | 'archived';

export interface ToolFrontmatter {
  name: string;
  url: string; // URL principal (prioriza repositorios de GitHub/GitLab)
  website_url?: string; // Web oficial o landing page si existe
  category: ToolCategory;
  area?: string;
  conjunto?: ToolConjunto;
  /** Bandeja de revisión: la nota todavía no tiene categoría. */
  review?: boolean;
  tags: string[];
  stars?: number;
  status: ToolStatus;
  date_added: string;
  created_at?: string;
  updated_at?: string;
  source_tweet?: string;
  /** Tweets de origen adicionales cuando varias fichas del mismo producto se unieron. */
  source_tweets?: string[];
  author?: string;
  author_handle?: string;
  entry_type?: EntryType;
  company?: string;
  location?: string; // Modalidad/ubicación (ej. "Remoto (Mundial)", "Remoto (LATAM)", "Híbrido")
  salary?: string; // Rango salarial o tarifa (ej. "$60k - $80k USD/año", "$40/h")
  price?: string; // Precio del producto o hardware si está disponible
  job_type?: 'remote_job' | 'freelance' | 'job_board' | 'resource';
  has_academic_promo?: boolean;
  academic_promo_details?: string;
  classified_by?: string;
}

export interface ToolItem {
  slug: string;
  filePath: string;
  frontmatter: ToolFrontmatter;
  content: string; // The markdown body (personal notes, reasons, etc.)
  mtimeMs?: number;
}

export interface ClassificationResult {
  name: string;
  canonicalUrl: string;
  websiteUrl?: string;
  category: ToolCategory;
  conjunto?: ToolConjunto;
  tags: string[];
  oneLiner: string;
  keyHighlights: string[];
  recommendedNotes: string;
  entryType?: EntryType;
  company?: string;
  location?: string;
  salary?: string;
  price?: string;
  jobType?: 'remote_job' | 'freelance' | 'job_board' | 'resource';
  hasAcademicPromo?: boolean;
  academicPromoDetails?: string;
}
