export function alnum(value: unknown): string;
export function canonicalUrlKey(raw: unknown): string;
export function namesLookLikeSameProduct(a?: string, b?: string): boolean;
export function entryTypeOf(tool: { frontmatter?: { entry_type?: string; category?: string } }): string;
export function flagToolsNeedingReview(
  tools: Array<{ slug: string; content?: string; frontmatter?: Record<string, unknown> }>
): Record<string, string>;
export function sortTools<T extends { frontmatter?: { name?: string; stars?: number; date_added?: string; created_at?: string } }>(
  tools: T[],
  mode: string
): T[];
export function pageWindow(total: number, page: number, size: number): { pages: number; page: number; start: number; end: number };
export function resolveLegacyFilters(
  input: { cat?: string; conjunto?: string; area?: string; section?: string },
  tables: {
    aliases?: Record<string, string>;
    legacySections?: Record<string, { area?: string; category?: string }>;
    legacyConjuntos?: Record<string, string | string[]>;
  }
): { cat: string; conjunto: string; area: string; rewritten: boolean };
export function conjuntoMatches(value: string, filter: string): boolean;
