export type ToolCategory =
  | 'CLI & Terminal'
  | 'Frontend & UI'
  | 'Backend & APIs'
  | 'DevOps & Cloud'
  | 'AI & Machine Learning'
  | 'Prompts, Art & Video'
  | 'Databases & Storage'
  | 'Productivity & Tools'
  | 'Documentation & Resources'
  | 'Empresas & Productos'
  | 'Consejos & Buenas Prácticas'
  | 'Trabajo & Freelance'
  | 'Other';

export type EntryType = 'tool' | 'product_showcase' | 'tech_tip' | 'job_remote';

export type ToolStatus = 'to_try' | 'in_use' | 'archived';

export interface ToolFrontmatter {
  name: string;
  url: string; // URL principal (prioriza repositorios de GitHub/GitLab)
  website_url?: string; // Web oficial o landing page si existe
  category: ToolCategory;
  tags: string[];
  stars?: number;
  status: ToolStatus;
  date_added: string;
  source_tweet?: string;
  author?: string;
  author_handle?: string;
  entry_type?: EntryType;
  company?: string;
  location?: string; // Modalidad/ubicación (ej. "Remoto (Mundial)", "Remoto (LATAM)", "Híbrido")
  salary?: string; // Rango salarial o tarifa (ej. "$60k - $80k USD/año", "$40/h")
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
}

export interface ClassificationResult {
  name: string;
  canonicalUrl: string;
  websiteUrl?: string;
  category: ToolCategory;
  tags: string[];
  oneLiner: string;
  keyHighlights: string[];
  recommendedNotes: string;
  entryType?: EntryType;
  company?: string;
  location?: string;
  salary?: string;
  jobType?: 'remote_job' | 'freelance' | 'job_board' | 'resource';
  hasAcademicPromo?: boolean;
  academicPromoDetails?: string;
}
