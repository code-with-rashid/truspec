import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

// Shared mock state (hoisted so the vi.mock factory and the test see the same object).
const S = vi.hoisted(() => ({
  commands: new Map<string, (...a: unknown[]) => unknown>(),
  codeLens: null as { provideCodeLenses: () => unknown[] } | null,
  // The extension reuses a single webview panel (module singleton), so createWebviewPanel fires once;
  // its `.title`/`.webview.html` are updated on each command. Track that one panel.
  panel: null as { title: string; webview: { html: string }; reveal: () => void } | null,
  warnings: [] as string[],
  errors: [] as string[],
  activeFile: undefined as string | undefined,
  config: undefined as string | undefined,
  specFiles: [] as Array<{ fsPath: string }>,
  quickPick: undefined as unknown,
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
  languages: { registerCodeLensProvider: (_s: unknown, p: { provideCodeLenses: () => unknown[] }) => { S.codeLens = p; return { dispose() {} }; } },
  workspace: {
    getConfiguration: () => ({ get: () => S.config }),
    findFiles: async () => S.specFiles,
    asRelativePath: (u: unknown) => (typeof u === "string" ? u : (u as { fsPath: string }).fsPath),
  },
  ViewColumn: { Beside: 2 },
  ProgressLocation: { Window: 10 },
  Range: class { constructor(..._a: unknown[]) {} },
  CodeLens: class { constructor(public range: unknown, public command: unknown) {} },
}));

import { activate, deactivate } from "../src/extension";

describe("vscode extension", () => {
  beforeEach(() => {
    // NB: don't reset S.panel — the extension's panel singleton persists across calls by design.
    S.commands.clear(); S.codeLens = null; S.warnings.length = 0; S.errors.length = 0;
    S.activeFile = undefined; S.config = undefined; S.specFiles = []; S.quickPick = undefined;
    activate({ subscriptions: [] } as never);
  });

  it("registers all commands and a CodeLens provider", () => {
    expect([...S.commands.keys()].sort()).toEqual(["truspec.coverage", "truspec.drift", "truspec.runCollection", "truspec.runRequest"]);
    expect(S.codeLens).not.toBeNull();
  });

  it("CodeLens provides Run / Run collection / Drift / Coverage lenses", () => {
    const lenses = S.codeLens?.provideCodeLenses() as Array<{ command: { title: string } }>;
    expect(lenses.map((l) => l.command.title)).toEqual(["▶ Run", "Run collection", "Drift", "Coverage"]);
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

  it("runCollection renders results for the whole folder", async () => {
    S.activeFile = resolve(repoRoot, "examples", "petstore", "get-pet.tspec.yaml");
    await S.commands.get("truspec.runCollection")!();
    expect(S.panel?.title).toBe("TruSpec — collection");
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
