export type ToolCategory =
  | 'CLI & Terminal'
  | 'Frontend & UI'
  | 'Backend & APIs'
  | 'DevOps & Cloud'
  | 'AI & Machine Learning'
  | 'Databases & Storage'
  | 'Productivity & Tools'
  | 'Documentation & Resources'
  | 'Other';

export type ToolStatus = 'to_try' | 'in_use' | 'archived';

export interface ToolFrontmatter {
  name: string;
  url: string;
  category: ToolCategory;
  tags: string[];
  stars?: number;
  status: ToolStatus;
  date_added: string;
  source_tweet?: string;
  author?: string;
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
  category: ToolCategory;
  tags: string[];
  oneLiner: string;
  keyHighlights: string[];
  recommendedNotes: string;
}
