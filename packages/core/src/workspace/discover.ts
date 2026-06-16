import { dirname } from "node:path";
import { walkDirSafe } from "./walk";

/**
 * Recursively find request files (`*.tspec.yaml`, excluding `folder.tspec.yaml`).
 * Traversal is cycle-safe and confined to the workspace (see {@link walkDirSafe}).
 */
export function discoverRequests(dir: string): string[] {
  const out: string[] = [];
  walkDirSafe(dir, (full, name) => {
    if (name.endsWith(".tspec.yaml") && name !== "folder.tspec.yaml") out.push(full);
  });
  return out;
}

/** Walk up from `startDir` (inclusive) returning the first directory matching `test`. */
export function findUp(startDir: string, test: (dir: string) => boolean): string | undefined {
  let dir = startDir;
  for (;;) {
    if (test(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
