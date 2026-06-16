import { realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

/**
 * Resolve `target` against `cwd` and confine it to the workspace, **following
 * symlinks** so a link inside the workspace can't point outside it. Works for
 * paths that don't exist yet (writes): it checks the deepest existing ancestor's
 * real path. Returns the resolved (logical) path; throws if it escapes `cwd`.
 */
export function confinePath(cwd: string, target: string): string {
  const abs = resolve(cwd, target);
  const root = realpathSync(cwd);
  let probe = abs;
  for (;;) {
    let real: string | null = null;
    try {
      real = realpathSync(probe);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (real !== null) {
      if (real !== root && !real.startsWith(root + sep)) {
        throw new Error(`Path escapes the workspace: ${target}`);
      }
      return abs;
    }
    const parent = dirname(probe);
    if (parent === probe) throw new Error(`Path escapes the workspace: ${target}`);
    probe = parent;
  }
}
