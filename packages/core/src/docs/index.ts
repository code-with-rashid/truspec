import { readFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { generateCode } from "../codegen";
import { parse } from "../format";
import type { TruSpecRequest } from "../format/types";
import { loadFolderChain } from "../workspace/context";
import { discoverRequests } from "../workspace/discover";
import { findWorkspaceRoot } from "../workspace/run";

export interface DocsOptions {
  /** Document title. Defaults to the collection directory's name. */
  title?: string;
  /** Codegen target for the example snippet under each request. `none` omits it. */
  lang?: string;
  /** Heading level the document starts at, for embedding in a larger page. */
  baseLevel?: number;
}

export interface DocsResult {
  markdown: string;
  /** Requests documented, and files that could not be parsed (reported, not fatal). */
  count: number;
  errors: Array<{ path: string; error: string }>;
}

/**
 * Render a collection as Markdown.
 *
 * Deliberately **deterministic**: no timestamp, no absolute paths, no run data. The output is
 * meant to be committed next to the collection and reviewed in a diff — a "generated on
 * <date>" line would make every regeneration a change, which is how generated docs stop being
 * regenerated. Everything here is a function of the files alone.
 */
export function collectionDocs(dir: string, opts: DocsOptions = {}): DocsResult {
  const base = opts.baseLevel ?? 1;
  const h = (level: number, text: string): string => `${"#".repeat(base + level - 1)} ${text}`;
  const lang = opts.lang ?? "curl";
  const root = findWorkspaceRoot(dir);

  const files = discoverRequests(dir);
  const errors: Array<{ path: string; error: string }> = [];
  const parsed: Array<{ path: string; req: TruSpecRequest; folder: string }> = [];
  for (const file of files) {
    const path = relative(dir, file).split(sep).join("/");
    try {
      parsed.push({
        path,
        req: parse.request.parse(readFileSync(file, "utf8")),
        folder: dirname(path) === "." ? "" : dirname(path),
      });
    } catch (e) {
      // One unparseable file must not blank the whole document — report it in place.
      errors.push({ path, error: (e as Error).message });
    }
  }
  parsed.sort(
    (a, b) =>
      a.folder.localeCompare(b.folder) ||
      (a.req.order ?? 0) - (b.req.order ?? 0) ||
      a.path.localeCompare(b.path),
  );

  const out: string[] = [h(1, opts.title ?? dir.split(sep).filter(Boolean).pop() ?? "API"), ""];
  out.push(
    `${parsed.length} request${parsed.length === 1 ? "" : "s"}. Generated from the collection with \`truspec docs\`.`,
    "",
  );

  if (parsed.length > 1) {
    out.push(h(2, "Requests"), "");
    out.push("| | Request | Endpoint |", "|---|---|---|");
    for (const { req } of parsed) {
      out.push(`| \`${req.method}\` | [${escapeCell(req.name)}](#${anchor(req.name)}) | \`${escapeCell(req.url)}\` |`);
    }
    out.push("");
  }

  let currentFolder: string | null = null;
  for (const entry of parsed) {
    if (parsed.some((p) => p.folder !== "") && entry.folder !== currentFolder) {
      currentFolder = entry.folder;
      out.push(h(2, currentFolder === "" ? "Root" : `\`${currentFolder}/\``), "");
    }
    out.push(...requestSection(entry.req, entry.path, dirname(entry.path), dir, root, lang, h));
  }

  if (errors.length > 0) {
    out.push(h(2, "Could not be read"), "");
    for (const e of errors) out.push(`- \`${e.path}\` — ${escapeCell(e.error)}`);
    out.push("");
  }

  return { markdown: `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`, count: parsed.length, errors };
}

function requestSection(
  req: TruSpecRequest,
  path: string,
  reqDir: string,
  dir: string,
  root: string,
  lang: string,
  h: (level: number, text: string) => string,
): string[] {
  const out: string[] = [h(3, escapeCell(req.name)), ""];
  out.push(`\`${req.method} ${req.url}\``, "");
  if (req.docs) out.push(req.docs, "");
  if (req.spec?.operation || req.spec?.operationId) {
    out.push(`**Spec operation:** \`${req.spec.operation ?? req.spec.operationId}\``, "");
  }
  if (req.tags?.length) out.push(`**Tags:** ${req.tags.map((t) => `\`${t}\``).join(", ")}`, "");

  out.push(...kvTable("Query", "Value", "Query parameters", req.query));
  out.push(...kvTable("Header", "Value", "Headers", req.headers));

  if (req.auth && req.auth.type !== "none") {
    out.push(`**Auth:** \`${req.auth.type}\``, "");
  }
  if (req.body && req.body.type !== "none") {
    out.push("**Body**", "", "```" + bodyFence(req.body.type), bodySample(req.body), "```", "");
  }
  if (req.assertions.length > 0) {
    out.push("**Asserts**", "");
    for (const a of req.assertions) out.push(`- \`${JSON.stringify(a)}\``);
    out.push("");
  }
  if (req.capture && Object.keys(req.capture).length > 0) {
    out.push("**Captures**", "");
    for (const [name, source] of Object.entries(req.capture)) {
      out.push(`- \`{{${name}}}\` ← \`${typeof source === "string" ? source : JSON.stringify(source)}\``);
    }
    out.push("");
  }

  if (lang !== "none") {
    try {
      // Folder inheritance is applied, so the example shows the request as it is actually sent —
      // not a fragment missing the base URL and headers every request in the folder gets.
      const folder = loadFolderChain(reqDir === "." ? dir : `${dir}${sep}${reqDir}`, root);
      const { target, code } = generateCode(req, lang, { folder });
      out.push(`<details><summary>Example (${target.label})</summary>`, "", "```" + target.syntax, code, "```", "", "</details>", "");
    } catch {
      // A snippet is a convenience; never let it take the whole document down.
    }
  }
  out.push(`<sub>\`${path}\`</sub>`, "");
  return out;
}

function kvTable(
  keyHeader: string,
  valueHeader: string,
  title: string,
  map: Record<string, string | number | boolean> | undefined,
): string[] {
  if (!map || Object.keys(map).length === 0) return [];
  const rows = Object.entries(map).map(([k, v]) => `| \`${escapeCell(k)}\` | \`${escapeCell(String(v))}\` |`);
  return [`**${title}**`, "", `| ${keyHeader} | ${valueHeader} |`, "|---|---|", ...rows, ""];
}

function bodyFence(type: string): string {
  return type === "json" || type === "multipart" ? "json" : type === "graphql" ? "graphql" : "text";
}

function bodySample(body: NonNullable<TruSpecRequest["body"]>): string {
  switch (body.type) {
    case "json":
      return JSON.stringify(body.content, null, 2);
    case "text":
      return body.content;
    case "form":
      return JSON.stringify(body.content, null, 2);
    case "multipart":
      return JSON.stringify(body.fields, null, 2);
    case "graphql":
      return body.variables
        ? `${body.query}\n\n# variables\n${JSON.stringify(body.variables, null, 2)}`
        : body.query;
    default:
      return "";
  }
}

/** GitHub-style heading anchor. */
function anchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Escape the characters that would break out of a table cell or inline code span. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/`/g, "'").replace(/\r?\n/g, " ");
}
