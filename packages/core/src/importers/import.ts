import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { parse } from "../format";
import { walkDirSafe } from "../workspace/walk";
import { bruToRequest } from "./bru";
import { importPostman } from "./postman";
import type { ImportedFile, ImportResult } from "./types";

export function importPostmanFile(file: string): ImportResult {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Failed to read Postman file: ${(e as Error).message}`);
  }
  return importPostman(json);
}

function findBruFiles(dir: string): string[] {
  const out: string[] = [];
  walkDirSafe(dir, (full, name) => {
    if (isBruRequestFile(name)) out.push(full);
  });
  return out;
}

/** `collection.bru`/`folder.bru` are Bruno metadata, not requests; only convert everything else. */
function isBruRequestFile(name: string): boolean {
  return name.endsWith(".bru") && name !== "collection.bru" && name !== "folder.bru";
}

/**
 * Convert in-memory `.bru` file contents (path + content) into `ImportResult`. Unlike
 * `importBrunoDir`, this never touches disk — the web UI's browser-uploaded Bruno import
 * (a `<input webkitdirectory>` picker) has file contents but no real directory to walk.
 */
export function importBrunoFiles(files: ImportedFile[]): ImportResult {
  const warnings: string[] = [];
  const out: ImportedFile[] = [];
  const stats = { requests: 0, folders: 0 };
  for (const f of files) {
    const normPath = f.path.replace(/\\/g, "/");
    if (!isBruRequestFile(basename(normPath))) continue;
    const { request, warnings: w } = bruToRequest(f.content);
    warnings.push(...w);
    if (!request) continue;
    stats.requests++;
    out.push({ path: normPath.replace(/\.bru$/, ".tspec.yaml"), content: parse.request.serialize(request) });
  }
  return { files: out, warnings, stats };
}

export function importBrunoDir(dir: string): ImportResult {
  return importBrunoFiles(
    findBruFiles(dir).map((file) => ({ path: relative(dir, file), content: readFileSync(file, "utf8") })),
  );
}

/** Write an import result to disk under `outDir`; returns the absolute paths written. */
export function writeImport(result: ImportResult, outDir: string): string[] {
  const written: string[] = [];
  for (const f of result.files) {
    const p = join(outDir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
    written.push(p);
  }
  return written;
}
