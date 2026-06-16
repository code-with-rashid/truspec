import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";

export interface WalkOptions {
  /** Directory names to skip entirely (in addition to `node_modules` and `.git`). */
  skip?: Iterable<string>;
}

/**
 * Walk `root` recursively, invoking `onFile(fullPath, name)` for every
 * non-directory entry.
 *
 * Symlinks are followed but kept honest: each directory is resolved with
 * `realpathSync`, so a symlink cycle (`a/link -> a`) cannot recurse forever and
 * a link resolving outside `root` is not traversed (it would otherwise walk the
 * whole disk and surface foreign files). Paths passed to `onFile` stay logical
 * (under `root`) so callers' `relative()` math is unaffected.
 */
export function walkDirSafe(
  root: string,
  onFile: (fullPath: string, name: string) => void,
  opts: WalkOptions = {},
): void {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return;
  }
  const skip = new Set<string>(["node_modules", ".git", ...(opts.skip ?? [])]);
  const visited = new Set<string>();
  const walk = (d: string): void => {
    let real: string;
    try {
      real = realpathSync(d);
    } catch {
      return;
    }
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return; // escaped root
    if (visited.has(real)) return; // cycle or already-seen real directory
    visited.add(real);
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (skip.has(name)) continue;
      const full = join(d, name);
      let isDir: boolean;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue; // broken symlink or vanished entry
      }
      if (isDir) walk(full);
      else onFile(full, name);
    }
  };
  walk(root);
}
