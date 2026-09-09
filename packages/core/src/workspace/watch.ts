import { existsSync, watch as fsWatch } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findWorkspaceRoot } from "./run";

/** Stop watching. */
export type Unwatch = () => void;

export interface WatchOptions {
  /** Base for resolving a relative `target`. Defaults to the process working directory. */
  cwd?: string;
  /** Quiet period after the last change before firing. Editors write in bursts. */
  debounceMs?: number;
  /** Injectable timers, so scheduling can be tested without real time passing. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Injectable file watcher, so tests never depend on real filesystem events. */
  watchDir?: (dir: string, onChange: (file: string) => void) => Unwatch;
  /** Called when a run throws. Watch mode continues either way. */
  onError?: (error: unknown) => void;
}

/** Files whose change should trigger a re-run: the collection, its environments, and `.env`. */
export function isRelevantChange(file: string): boolean {
  if (!file) return false;
  const name = file.replace(/\\/g, "/");
  return (
    name.endsWith(".tspec.yaml") ||
    name.endsWith(".env.yaml") ||
    name.endsWith("/.env") ||
    name === ".env" ||
    name.endsWith(".yaml") ||
    name.endsWith(".yml") ||
    name.endsWith(".json")
  );
}

/**
 * Watch a collection and invoke `onChange` when something that affects a run changes.
 *
 * Two behaviors matter more than the watching itself:
 *
 * - **Debounce.** Editors write in bursts (temp file, rename, permission bit), and a save often
 *   produces three events. Firing per event would run the collection three times.
 * - **No overlap.** A run in flight is never re-entered; a change during one is remembered and
 *   fires exactly once when it finishes. Otherwise a slow collection plus a fast typist queues
 *   runs faster than they complete.
 * - **A throwing run does not end the watch.** The callback runs detached from any caller, so an
 *   error escaping it would surface as an unhandled rejection and take the process down — the
 *   opposite of what a watcher is for, since a broken file is precisely when you keep editing.
 */
export function watchWorkspace(
  target: string,
  onChange: () => Promise<void> | void,
  opts: WatchOptions = {},
): Unwatch {
  const abs = resolve(opts.cwd ?? process.cwd(), target);
  const root = findWorkspaceRoot(existsSync(abs) ? abs : dirname(abs));
  const dirs = new Set<string>([root]);
  // The collection may sit outside the workspace root (`truspec run ../other/api`), and the
  // environments directory may sit above it; watch both rather than assuming one contains the other.
  dirs.add(existsSync(abs) ? abs : dirname(abs));
  const envDir = join(root, "environments");
  if (existsSync(envDir)) dirs.add(envDir);

  const debounceMs = opts.debounceMs ?? 150;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const watchDir = opts.watchDir ?? defaultWatchDir;

  let timer: unknown;
  let running = false;
  let pending = false;
  let stopped = false;

  const fire = async (): Promise<void> => {
    if (stopped) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await onChange();
    } catch (e) {
      opts.onError?.(e);
    } finally {
      running = false;
      if (pending && !stopped) {
        pending = false;
        void fire();
      }
    }
  };

  const schedule = (file: string): void => {
    if (stopped || !isRelevantChange(file)) return;
    if (timer !== undefined) clearTimer(timer);
    timer = setTimer(() => {
      timer = undefined;
      void fire();
    }, debounceMs);
  };

  const stops: Unwatch[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    stops.push(watchDir(dir, schedule));
  }

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimer(timer);
    for (const stop of stops) stop();
  };
}

/** Recursive `fs.watch`, degrading to a non-recursive watch where the platform refuses. */
function defaultWatchDir(dir: string, onChange: (file: string) => void): Unwatch {
  const handler = (_event: string, filename: string | Buffer | null): void => {
    if (filename) onChange(typeof filename === "string" ? filename : filename.toString());
  };
  try {
    const watcher = fsWatch(dir, { recursive: true }, handler);
    return () => watcher.close();
  } catch {
    // Some platforms/filesystems reject `recursive`. A flat watch still catches edits to files
    // directly in the directory, which is better than failing to watch at all.
    const watcher = fsWatch(dir, handler);
    return () => watcher.close();
  }
}
