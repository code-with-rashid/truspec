import type { RequestSummary } from "./api";

/** Server paths are OS-native (`\` on Windows); normalize before splitting/comparing on the client. */
export const normPath = (path: string): string => path.replace(/\\/g, "/");

export const folderOf = (path: string): string => {
  const p = normPath(path);
  const i = p.lastIndexOf("/");
  return i === -1 ? "·" : p.slice(0, i);
};

export const baseName = (dir: string): string => {
  const parts = normPath(dir).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? dir;
};

export const shortDir = (dir: string): string => {
  const parts = normPath(dir).split("/").filter(Boolean);
  return parts.length <= 2 ? dir : `…/${parts.slice(-2).join("/")}`;
};

export interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  requests: RequestSummary[];
}

/** Real nested tree (not a flat "a/b/c" label) so the sidebar can show a collapsible hierarchy like Bruno's. */
export function buildFolderTree(requests: RequestSummary[], folderPaths: string[] = []): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: [], requests: [] };
  const index = new Map<string, FolderNode>([["", root]]);
  const ensure = (dir: string): FolderNode => {
    const segments = dir ? dir.split("/") : [];
    let parent = root;
    let acc = "";
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      let node = index.get(acc);
      if (!node) {
        node = { name: seg, path: acc, folders: [], requests: [] };
        index.set(acc, node);
        parent.folders.push(node);
      }
      parent = node;
    }
    return parent;
  };
  // Seed folders that exist on disk but have no requests yet (e.g. just created), so they're
  // visible immediately instead of only appearing once a request is added inside them.
  for (const f of folderPaths) ensure(normPath(f));
  for (const r of requests) {
    const p = normPath(r.path);
    const slash = p.lastIndexOf("/");
    const dir = slash === -1 ? "" : p.slice(0, slash);
    ensure(dir).requests.push(r);
  }
  const sortRec = (n: FolderNode): void => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.folders.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

export function countRequests(node: FolderNode): number {
  return node.requests.length + node.folders.reduce((sum, f) => sum + countRequests(f), 0);
}

/** Same match predicate the command palette uses, for consistency. A folder whose own name
 * matches keeps its full subtree unfiltered; otherwise it survives only if a descendant matches. */
export function filterTree(node: FolderNode, query: string): FolderNode | null {
  const q = query.trim().toLowerCase();
  if (!q) return node;
  if (node.name.toLowerCase().includes(q)) return node;
  const requests = node.requests.filter((r) => `${r.name} ${r.method} ${r.url}`.toLowerCase().includes(q));
  const folders = node.folders.map((f) => filterTree(f, q)).filter((f): f is FolderNode => f !== null);
  if (requests.length === 0 && folders.length === 0) return null;
  return { ...node, requests, folders };
}
