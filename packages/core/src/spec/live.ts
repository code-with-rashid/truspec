import type { SpecOperation } from "./openapi";

// Only side-effect-free methods are probed against a (possibly production) API.
const SAFE_METHODS = new Set(["GET", "HEAD"]);

export interface LiveProbeOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface LiveProbeResult {
  checked: number;
  /** Mutating operations that were not probed (for safety). */
  skipped: string[];
  /** Probed operations the live API does not serve (404/405/unreachable). */
  missing: string[];
}

/** Probe a running API for spec operations. Only GET/HEAD are sent (no side effects). */
export async function probeLiveOperations(
  operations: SpecOperation[],
  baseUrl: string,
  opts: LiveProbeOptions = {},
): Promise<LiveProbeResult> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const base = baseUrl.replace(/\/+$/, "");
  const missing: string[] = [];
  const skipped: string[] = [];
  let checked = 0;

  for (const op of operations) {
    if (!SAFE_METHODS.has(op.method)) {
      skipped.push(op.key);
      continue;
    }
    const url = base + op.path.replace(/\{[^}]+\}/g, "1");
    let status = 0;
    try {
      const res = await doFetch(url, {
        method: op.method,
        signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
      });
      status = res.status;
    } catch {
      status = 0; // unreachable
    }
    checked++;
    if (status === 404 || status === 405 || status === 0) missing.push(op.key);
  }

  return { checked, skipped: skipped.sort(), missing: missing.sort() };
}
