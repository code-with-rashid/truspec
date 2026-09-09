import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { coverageReport, driftReport } from "@truspec/core/spec";
import { findWorkspaceRoot, runPath } from "@truspec/core/workspace";
import * as vscode from "vscode";
import { renderCoverage, renderDrift, renderResults } from "./results";

let panel: vscode.WebviewPanel | undefined;

function show(title: string, html: string): void {
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      "truspec.results",
      "TruSpec",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: false },
    );
    panel.onDidDispose(() => {
      panel = undefined;
    });
  }
  panel.title = `TruSpec — ${title}`;
  panel.webview.html = html;
  panel.reveal(vscode.ViewColumn.Beside, true);
}

/** A folder config is inherited *by* requests; it is not one, and can never be run on its own. */
const isFolderConfig = (file: string): boolean => basename(file) === "folder.tspec.yaml";

function activeTspecFile(opts: { allowFolderConfig: boolean }): string | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc?.fileName.endsWith(".tspec.yaml")) {
    vscode.window.showWarningMessage("TruSpec: open a .tspec.yaml request first.");
    return undefined;
  }
  if (!opts.allowFolderConfig && isFolderConfig(doc.fileName)) {
    vscode.window.showWarningMessage(
      "TruSpec: folder.tspec.yaml is folder configuration, not a request — use Run collection.",
    );
    return undefined;
  }
  return doc.fileName;
}

async function pickEnv(dir: string): Promise<string | undefined> {
  const configured = vscode.workspace.getConfiguration("truspec").get<string>("environment");
  if (configured) return configured;
  const envDir = resolve(dir, "environments");
  if (!existsSync(envDir)) return undefined;
  const envs = readdirSync(envDir)
    .filter((f) => f.endsWith(".env.yaml"))
    .map((f) => f.replace(/\.env\.yaml$/, ""));
  if (envs.length === 0) return undefined;
  if (envs.length === 1) return envs[0];
  return vscode.window.showQuickPick(envs, { placeHolder: "TruSpec: select environment" });
}

async function pickSpec(): Promise<string | undefined> {
  // `swagger.yaml` is as common a name as `openapi.yaml` — half the specs in the wild predate the
  // rename — and a spec the extension cannot see is a feature the user concludes does not work.
  const uris = await vscode.workspace.findFiles(
    "**/*{openapi,swagger}*.{yaml,yml,json}",
    "**/node_modules/**",
    50,
  );
  if (uris.length === 0) {
    vscode.window.showWarningMessage(
      "TruSpec: no OpenAPI spec found (looked for *openapi*/*swagger*.{yaml,yml,json}).",
    );
    return undefined;
  }
  if (uris.length === 1) return uris[0]?.fsPath;
  const pick = await vscode.window.showQuickPick(
    uris.map((u) => ({ label: vscode.workspace.asRelativePath(u), fsPath: u.fsPath })),
    { placeHolder: "TruSpec: select OpenAPI spec" },
  );
  return pick?.fsPath;
}

export function activate(context: vscode.ExtensionContext): void {
  const runRequests = async (scope: "file" | "collection"): Promise<void> => {
    const file = activeTspecFile({ allowFolderConfig: scope === "collection" });
    if (!file) return;
    const root = findWorkspaceRoot(dirname(file));
    const env = await pickEnv(root);
    // The folder the open file is in — not the workspace root. `truspec init` puts `environments/`
    // at the repo root, so the root is usually the whole repository: running it from a lens sitting
    // on one file would send every request in the project, POSTs and DELETEs included, which is
    // not what anyone means by clicking the lens on `api/admin/create-user.tspec.yaml`.
    const target = scope === "file" ? file : dirname(file);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "TruSpec: running…" },
      async () => {
        try {
          const result = await runPath(target, { env: env || undefined, cwd: root });
          show(scope === "file" ? "run" : "folder", renderResults(result));
        } catch (e) {
          vscode.window.showErrorMessage(`TruSpec: ${(e as Error).message}`);
        }
      },
    );
  };

  const analyze = (kind: "drift" | "coverage") => async (): Promise<void> => {
    const spec = await pickSpec();
    if (!spec) return;
    const root = findWorkspaceRoot(dirname(spec));
    const rel = vscode.workspace.asRelativePath(spec);
    try {
      show(
        kind,
        kind === "drift"
          ? renderDrift(driftReport(root, spec), rel)
          : renderCoverage(coverageReport(root, spec), rel),
      );
    } catch (e) {
      vscode.window.showErrorMessage(`TruSpec: ${(e as Error).message}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("truspec.runRequest", () => runRequests("file")),
    vscode.commands.registerCommand("truspec.runCollection", () => runRequests("collection")),
    vscode.commands.registerCommand("truspec.drift", analyze("drift")),
    vscode.commands.registerCommand("truspec.coverage", analyze("coverage")),
    vscode.languages.registerCodeLensProvider(
      { pattern: "**/*.tspec.yaml" },
      {
        provideCodeLenses(document: vscode.TextDocument) {
          const top = new vscode.Range(0, 0, 0, 0);
          // `**/*.tspec.yaml` matches folder.tspec.yaml too. Offering "▶ Run" there invites a run
          // that cannot work — it is config, not a request — so leave that one lens off.
          const lenses = isFolderConfig(document.fileName)
            ? []
            : [new vscode.CodeLens(top, { title: "▶ Run", command: "truspec.runRequest" })];
          return [
            ...lenses,
            // "Run folder", because that is what it does. The command id keeps its old name so
            // anyone's keybinding still works.
            new vscode.CodeLens(top, { title: "Run folder", command: "truspec.runCollection" }),
            new vscode.CodeLens(top, { title: "Drift", command: "truspec.drift" }),
            new vscode.CodeLens(top, { title: "Coverage", command: "truspec.coverage" }),
          ];
        },
      },
    ),
  );
}

export function deactivate(): void {
  panel?.dispose();
}
