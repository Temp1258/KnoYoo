import type { IndustryNode } from "../types";

/** Flatten tree into layers by depth */
export function flattenByDepth(roots: IndustryNode[]): IndustryNode[][] {
  const layers: IndustryNode[][] = [];
  const dfs = (n: IndustryNode, d: number) => {
    if (!layers[d]) layers[d] = [];
    layers[d].push(n);
    (n.children || []).forEach((c) => dfs(c, d + 1));
  };
  roots.forEach((r) => dfs(r, 0));
  return layers;
}

/** Find node by id in tree */
export function findNodeById(roots: IndustryNode[], id: number): IndustryNode | null {
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    if (n.children?.length) stack.push(...n.children);
  }
  return null;
}

/** Find node by name (case-insensitive) in tree */
export function findNodeByName(roots: IndustryNode[], name: string): IndustryNode | null {
  const key = name.trim().toLowerCase();
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.name.trim().toLowerCase() === key) return n;
    if (n.children?.length) stack.push(...n.children);
  }
  return null;
}

/** Find path from root to node with given id */
export function findPathToNode(roots: IndustryNode[], id: number): IndustryNode[] | null {
  for (const r of roots) {
    const stack: { node: IndustryNode; path: IndustryNode[] }[] = [];
    stack.push({ node: r, path: [r] });
    while (stack.length) {
      const { node, path } = stack.pop()!;
      if (node.id === id) return path;
      if (node.children && node.children.length) {
        for (const c of node.children) {
          stack.push({ node: c, path: [...path, c] });
        }
      }
    }
  }
  return null;
}

/** Deep-copy subtree rooted at given id */
export function extractSubtree(roots: IndustryNode[], id: number): IndustryNode | null {
  const src = findNodeById(roots, id);
  if (!src) return null;
  const clone = (n: IndustryNode): IndustryNode => ({
    id: n.id,
    name: n.name,
    required_level: n.required_level,
    importance: n.importance,
    mastery: n.mastery ?? null,
    children: (n.children || []).map(clone),
  });
  return clone(src);
}

/** Calculate dynamic node width based on name length */
export function getNodeWidth(name: string, baseNodeW = 160, maxNodeW = 400): number {
  const len = name?.trim().length || 0;
  const estimated = 24 + len * 14;
  return Math.min(maxNodeW, Math.max(baseNodeW, estimated));
}
