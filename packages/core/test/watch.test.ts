import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRelevantChange, watchWorkspace } from "../src/workspace";

/**
 * Poll until `ready()` holds, running `tick` before each attempt, and report how long it took.
 *
 * Fails loudly at the deadline rather than asserting on a sleep.
 */
async function waitFor(
  ready: () => boolean,
  { timeoutMs = 8000, tick }: { timeoutMs?: number; tick?: () => void } = {},
): Promise<number> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    tick?.();
    await new Promise((r) => setTimeout(r, 25));
  }
  return Date.now() - started;
}

let dir: string;
beforeEach(() => {
  // realpath, because macOS hands out /var/folders/… which is a symlink to /private/var/folders/…
  // — and a recursive fs.watch on the symlinked path reports paths under the real one, so a
  // watcher rooted at the link can miss its own events.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "truspec-watch-")));
  mkdirSync(join(dir, "api"), { recursive: true });
  mkdirSync(join(dir, "environments"), { recursive: true });
  writeFileSync(join(dir, "api", "a.tspec.yaml"), 'tspec: "0.1"\nname: A\nurl: "https://x.test"\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A controllable watcher + clock, so no test depends on real filesystem events or real time. */
function harness() {
  const listeners: Array<(file: string) => void> = [];
  const timers: Array<{ id: number; fn: () => void }> = [];
  let nextId = 1;
  const watched: string[] = [];
  const stopped: string[] = [];
  return {
    watched,
    stopped,
    emit: (file: string) => {
      for (const l of listeners) l(file);
    },
    /** Run every pending timer, as if the debounce window elapsed. */
    tick: () => {
      const due = timers.splice(0, timers.length);
      for (const t of due) t.fn();
    },
    get pendingTimers() {
      return timers.length;
    },
    options: {
      setTimer: (fn: () => void, _ms: number) => {
        const id = nextId++;
        timers.push({ id, fn });
        return id;
      },
      clearTimer: (h: unknown) => {
        const at = timers.findIndex((t) => t.id === h);
        if (at !== -1) timers.splice(at, 1);
      },
      watchDir: (d: string, onChange: (file: string) => void) => {
        watched.push(d);
        listeners.push(onChange);
        return () => stopped.push(d);
      },
    },
  };
}

describe("isRelevantChange", () => {
  it("accepts collection, environment, spec and .env files", () => {
    for (const f of ["a.tspec.yaml", "environments/local.env.yaml", ".env", "sub/.env", "openapi.yaml", "spec.json", "x.yml"]) {
      expect(isRelevantChange(f), f).toBe(true);
    }
  });

  it("ignores everything else, including the editor noise that shares a directory", () => {
    for (const f of ["", "notes.md", "a.tspec.yaml.swp", "README", ".DS_Store", "dist/bundle.js"]) {
      expect(isRelevantChange(f), f).toBe(false);
    }
  });
});

describe("watchWorkspace", () => {
  it("watches the collection, the workspace root and its environments directory", () => {
    const h = harness();
    const stop = watchWorkspace(join(dir, "api"), () => {}, h.options);
    expect(h.watched).toContain(join(dir, "api"));
    expect(h.watched).toContain(join(dir, "environments"));
    stop();
    expect(h.stopped.length).toBe(h.watched.length);
  });

  it("debounces a burst of events into a single run", async () => {
    const h = harness();
    let runs = 0;
    watchWorkspace(join(dir, "api"), () => {
      runs += 1;
    }, h.options);

    // One editor save typically produces several events (temp file, rename, chmod).
    h.emit("a.tspec.yaml");
    h.emit("a.tspec.yaml");
    h.emit("a.tspec.yaml");
    expect(h.pendingTimers).toBe(1);
    expect(runs).toBe(0);

    h.tick();
    await Promise.resolve();
    expect(runs).toBe(1);
  });

  it("ignores an irrelevant file without even arming the timer", () => {
    const h = harness();
    watchWorkspace(join(dir, "api"), () => {}, h.options);
    h.emit("notes.md");
    expect(h.pendingTimers).toBe(0);
  });

  it("never overlaps runs: a change during one fires exactly once afterwards", async () => {
    const h = harness();
    let started = 0;
    let release: (() => void) | undefined;
    watchWorkspace(
      join(dir, "api"),
      () =>
        new Promise<void>((r) => {
          started += 1;
          release = r;
        }),
      h.options,
    );

    h.emit("a.tspec.yaml");
    h.tick();
    await Promise.resolve();
    expect(started).toBe(1);

    // Two more changes land while the first run is still in flight.
    h.emit("a.tspec.yaml");
    h.tick();
    h.emit("a.tspec.yaml");
    h.tick();
    await Promise.resolve();
    expect(started, "must not re-enter a run in flight").toBe(1);

    release?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(started, "the queued changes coalesce into one follow-up run").toBe(2);
  });

  it("fires nothing after being stopped, including an already-armed timer", async () => {
    const h = harness();
    let runs = 0;
    const stop = watchWorkspace(join(dir, "api"), () => {
      runs += 1;
    }, h.options);
    h.emit("a.tspec.yaml");
    stop();
    h.tick();
    await Promise.resolve();
    expect(runs).toBe(0);
    // A late event from a watcher that hasn't fully torn down is ignored too.
    h.emit("a.tspec.yaml");
    h.tick();
    await Promise.resolve();
    expect(runs).toBe(0);
  });

  it("keeps watching when a run throws, and reports it instead of crashing", async () => {
    const h = harness();
    const errors: unknown[] = [];
    let runs = 0;
    watchWorkspace(
      join(dir, "api"),
      () => {
        runs += 1;
        if (runs === 1) throw new Error("boom");
      },
      { ...h.options, onError: (e) => errors.push(e) },
    );

    // The callback runs detached, so an escaping error would be an unhandled rejection and would
    // take the process down — the opposite of what a watcher is for.
    h.emit("a.tspec.yaml");
    h.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(1);
    expect((errors[0] as Error).message).toBe("boom");

    h.emit("a.tspec.yaml");
    h.tick();
    await Promise.resolve();
    expect(runs).toBe(2);
  });

  it("uses the real filesystem watcher by default and tears it down cleanly", async () => {
    // The default `watchDir` (recursive fs.watch, with a flat fallback) is otherwise never
    // exercised — and a leaked watcher keeps the process alive after a run finishes.
    let fired = 0;
    const stop = watchWorkspace(join(dir, "api"), () => {
      fired += 1;
    }, { debounceMs: 5 });

    // Keep writing until an event arrives, rather than writing once and waiting. `fs.watch` is
    // backed by FSEvents on macOS, which does not arm synchronously — a file written in the same
    // tick as the watcher is created can be missed entirely, so a single write is a coin toss
    // there (and was: this test timed out on every macOS run). What is being asserted is that a
    // real filesystem change reaches the watcher, not that the very first one does.
    const write = (name: string): void =>
      writeFileSync(join(dir, "api", name), `tspec: "0.1"\nname: B\nurl: "https://x.test"\n# ${Date.now()}\n`);
    const deliveryMs = await waitFor(() => fired >= 1, { tick: () => write("b.tspec.yaml") });
    stop();
    expect(fired).toBeGreaterThanOrEqual(1);

    // Nothing fires after teardown, which is what keeps a finished run from hanging. The wait has
    // to be a real one — the assertion is that nothing arrives — and it is scaled by how long
    // delivery actually took above, so on a platform where events lag it is not a vacuous pass.
    const after = fired;
    write("c.tspec.yaml");
    await new Promise((r) => setTimeout(r, Math.max(300, deliveryMs * 3)));
    expect(fired).toBe(after);
  });

  it("resolves a relative target against an explicit cwd", () => {
    const h = harness();
    const stop = watchWorkspace("api", () => {}, { ...h.options, cwd: dir });
    expect(h.watched).toContain(join(dir, "api"));
    stop();
  });

  it("watches the containing directory when the target is a single request file", () => {
    const h = harness();
    const stop = watchWorkspace(join(dir, "api", "a.tspec.yaml"), () => {}, h.options);
    expect(h.watched).toContain(join(dir, "api"));
    stop();
  });
});
