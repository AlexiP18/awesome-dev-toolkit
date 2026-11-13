import { ToolItem } from './types.js';
import { sameProduct } from './url_normalize.js';

/** Agrupa fichas que son el mismo producto (URL canónica o repo + landing). */
export function groupDuplicateTools(tools: ToolItem[]): ToolItem[][] {
  const parent = tools.map((_, index) => index);

  function find(index: number): number {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  }

  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  }

  for (let i = 0; i < tools.length; i++) {
    for (let j = i + 1; j < tools.length; j++) {
      const left = tools[i].frontmatter;
      const right = tools[j].frontmatter;
      if (
        sameProduct(
          { url: left.url, website: left.website_url, name: left.name },
          { url: right.url, website: right.website_url, name: right.name }
        )
      ) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, ToolItem[]>();
  tools.forEach((tool, index) => {
    const root = find(index);
    const list = groups.get(root) || [];
    list.push(tool);
    groups.set(root, list);
  });

  return [...groups.values()].filter((group) => group.length > 1);
}
