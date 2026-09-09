import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

// Shared mock state (hoisted so the vi.mock factory and the test see the same object).
/** Targets passed to `runPath`, so a test can assert *what* a command decided to run. */
const runTargets = vi.hoisted(() => [] as string[]);

const S = vi.hoisted(() => ({
  commands: new Map<string, (...a: unknown[]) => unknown>(),
  codeLens: null as { provideCodeLenses: (d: { fileName: string }) => unknown[] } | null,
  // The extension reuses a single webview panel (module singleton), so createWebviewPanel fires once;
  // its `.title`/`.webview.html` are updated on each command. Track that one panel.
  panel: null as { title: string; webview: { html: string }; reveal: () => void } | null,
  warnings: [] as string[],
  errors: [] as string[],
  activeFile: undefined as string | undefined,
  config: undefined as string | undefined,
  specFiles: [] as Array<{ fsPath: string }>,
  quickPick: undefined as unknown,
  /** Observes the glob `pickSpec` searches with. */
  findPattern: ((_p: string) => {}) as (p: string) => void,
}));

vi.mock("vscode", () => ({
  window: {
    createWebviewPanel: () => {
      const p = { title: "", webview: { html: "" }, reveal: () => {}, onDidDispose: (_cb: () => void) => {}, dispose: () => {} };
      S.panel = p;
      return p;
    },
    get activeTextEditor() { return S.activeFile ? { document: { fileName: S.activeFile } } : undefined; },
    showWarningMessage: (m: string) => { S.warnings.push(m); },
    showErrorMessage: (m: string) => { S.errors.push(m); },
    withProgress: async (_o: unknown, task: () => Promise<unknown>) => task(),
    showQuickPick: async () => S.quickPick,
  },
  commands: { registerCommand: (id: string, cb: (...a: unknown[]) => unknown) => { S.commands.set(id, cb); return { dispose() {} }; } },
  languages: { registerCodeLensProvider: (_s: unknown, p: { provideCodeLenses: (d: { fileName: string }) => unknown[] }) => { S.codeLens = p; return { dispose() {} }; } },
  workspace: {
    getConfiguration: () => ({ get: () => S.config }),
    findFiles: async (pattern: string) => {
      S.findPattern(pattern);
      return S.specFiles;
    },
    asRelativePath: (u: unknown) => (typeof u === "string" ? u : (u as { fsPath: string }).fsPath),
  },
  ViewColumn: { Beside: 2 },
  ProgressLocation: { Window: 10 },
  Range: class { constructor(..._a: unknown[]) {} },
  CodeLens: class { constructor(public range: unknown, public command: unknown) {} },
}));

// Spy on the one decision these commands make — which path to run — while leaving the real engine
// in place, so the assertions are about behaviour rather than about a stub.
vi.mock("@truspec/core/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@truspec/core/workspace")>();
  return {
    ...actual,
    runPath: (target: string, opts?: unknown) => {
      runTargets.push(target);
      return actual.runPath(target, opts as never);
    },
  };
});

import { activate, deactivate } from "../src/extension";

describe("vscode extension", () => {
  beforeEach(() => {
    // NB: don't reset S.panel — the extension's panel singleton persists across calls by design.
    S.commands.clear(); S.codeLens = null; S.warnings.length = 0; S.errors.length = 0;
    S.activeFile = undefined; S.config = undefined; S.specFiles = []; S.quickPick = undefined;
    runTargets.length = 0;
    activate({ subscriptions: [] } as never);
  });

  it("registers all commands and a CodeLens provider", () => {
    expect([...S.commands.keys()].sort()).toEqual(["truspec.coverage", "truspec.drift", "truspec.runCollection", "truspec.runRequest"]);
    expect(S.codeLens).not.toBeNull();
  });

  it("CodeLens provides Run / Run folder / Drift / Coverage lenses", () => {
    const lenses = S.codeLens?.provideCodeLenses({ fileName: "/w/get.tspec.yaml" }) as Array<{ command: { title: string } }>;
    expect(lenses.map((l) => l.command.title)).toEqual(["▶ Run", "Run folder", "Drift", "Coverage"]);
  });

  it("CodeLens does not offer '▶ Run' on a folder config, which can never be a request", () => {
    // `**/*.tspec.yaml` matches folder.tspec.yaml, and running it produced an empty panel.
    const lenses = S.codeLens?.provideCodeLenses({ fileName: "/w/folder.tspec.yaml" }) as Array<{ command: { title: string } }>;
    expect(lenses.map((l) => l.command.title)).toEqual(["Run folder", "Drift", "Coverage"]);
  });

  it("runRequest on a folder config explains itself instead of running nothing", async () => {
    S.panel = null;
    S.activeFile = resolve(repoRoot, "examples", "blog", "folder.tspec.yaml");
    await S.commands.get("truspec.runRequest")!();
    expect(S.warnings.some((w) => /folder configuration, not a request/.test(w))).toBe(true);
    expect(S.panel).toBeNull();
  });

  it("runRequest with no active .tspec.yaml warns instead of running", async () => {
    S.panel = null;
    S.activeFile = undefined;
    await S.commands.get("truspec.runRequest")!();
    expect(S.warnings.some((w) => /open a .tspec.yaml/.test(w))).toBe(true);
    expect(S.panel).toBeNull();
  });

  it("runRequest on a real request renders a results webview", async () => {
    S.activeFile = resolve(repoRoot, "examples", "petstore", "get-pet.tspec.yaml");
    await S.commands.get("truspec.runRequest")!();
    expect(S.panel?.title).toBe("TruSpec — run");
    expect(S.panel?.webview.html).toMatch(/TruSpec/);
  });

  it("runCollection runs the open file's folder, not the whole repository", async () => {
    // `truspec init` puts environments/ at the repo root, so the workspace root is usually the
    // whole project: running it from a lens on one file would send every request in the repo,
    // POSTs and DELETEs included. The lens means "this folder".
    S.activeFile = resolve(repoRoot, "examples", "petstore", "get-pet.tspec.yaml");
    await S.commands.get("truspec.runCollection")!();
    expect(S.panel?.title).toBe("TruSpec — folder");
    expect(runTargets.at(-1)).toBe(resolve(repoRoot, "examples", "petstore"));
  });

  it("runs the folder a nested request lives in, not its ancestors", async () => {
    S.activeFile = resolve(repoRoot, "examples", "blog", "posts", "create-post.tspec.yaml");
    await S.commands.get("truspec.runCollection")!();
    expect(runTargets.at(-1)).toBe(resolve(repoRoot, "examples", "blog", "posts"));
  });

  it("finds a spec named swagger.yaml as well as openapi.yaml", async () => {
    // Half the specs in the wild predate the rename, and a spec the extension cannot see is a
    // feature the user concludes does not work.
    const pattern = await new Promise<string>((r) => {
      S.specFiles = [];
      const original = S.findPattern;
      S.findPattern = (p: string) => r(p);
      void S.commands.get("truspec.drift")!();
      S.findPattern = original;
    });
    expect(pattern).toContain("swagger");
    expect(pattern).toContain("openapi");
  });

  it("drift with no spec found warns", async () => {
    S.specFiles = [];
    await S.commands.get("truspec.drift")!();
    expect(S.warnings.some((w) => /no OpenAPI spec/.test(w))).toBe(true);
  });

  it("drift renders a drift webview when a spec is present", async () => {
    S.specFiles = [{ fsPath: resolve(repoRoot, "examples", "petstore", "openapi.yaml") }];
    await S.commands.get("truspec.drift")!();
    expect(S.panel?.title).toBe("TruSpec — drift");
    expect(S.panel?.webview.html).toMatch(/· drift/);
  });

  it("coverage renders a coverage webview", async () => {
    S.specFiles = [{ fsPath: resolve(repoRoot, "examples", "petstore", "openapi.yaml") }];
    await S.commands.get("truspec.coverage")!();
    expect(S.panel?.title).toBe("TruSpec — coverage");
    expect(S.panel?.webview.html).toMatch(/· coverage/);
  });

  it("surfaces engine errors via showErrorMessage (bad spec path)", async () => {
    S.specFiles = [{ fsPath: resolve(repoRoot, "does-not-exist.yaml") }];
    await S.commands.get("truspec.drift")!();
    expect(S.errors.length).toBeGreaterThan(0);
  });

  it("deactivate disposes cleanly", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
