import type { ToolItem } from './types.js';

let cache: { root: string; tools: ToolItem[] } | null = null;

export function getCachedTools(root: string): ToolItem[] | null {
  if (cache && cache.root === root) return cache.tools;
  return null;
}

export function setCachedTools(root: string, tools: ToolItem[]): void {
  cache = { root, tools };
}

export function invalidateCatalogCache(): void {
  cache = null;
}

export function isCatalogCached(): boolean {
  return cache !== null;
}
