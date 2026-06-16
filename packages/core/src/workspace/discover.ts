import { readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";

/**
 * Recursively find request files (`*.tspec.yaml`, excluding `folder.tspec.yaml`).
 *
 * Symlinks are followed but kept honest: each directory is resolved with
 * `realpathSync` so a symlink cycle (`dir/link -> dir`) can't recurse forever,
 * and a link pointing outside the workspace root is not traversed (it would
 * otherwise walk the whole disk and surface foreign `.tspec.yaml` files).
 * Returned paths stay logical (under `dir`) so callers' `relative()` still works.
 */
export function discoverRequests(dir: string): string[] {
  const out: string[] = [];
  let root: string;
  try {
    root = realpathSync(dir);
  } catch {
    return out;
  }
  const visited = new Set<string>();
  const walk = (d: string): void => {
    let real: string;
    try {
      real = realpathSync(d);
    } catch {
      return;
    }
    if (real !== root && !real.startsWith(root + sep)) return; // escaped the workspace
    if (visited.has(real)) return; // cycle or already-seen real directory
    visited.add(real);
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (name === "node_modules" || name === ".git") continue;
      const full = join(d, name);
      let isDir: boolean;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue; // broken symlink or vanished entry
      }
      if (isDir) walk(full);
      else if (name.endsWith(".tspec.yaml") && name !== "folder.tspec.yaml") out.push(full);
    }
  };
  walk(dir);
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
