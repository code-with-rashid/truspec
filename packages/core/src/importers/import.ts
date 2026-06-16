import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
    if (name.endsWith(".bru") && name !== "collection.bru" && name !== "folder.bru") out.push(full);
  });
  return out;
}

export function importBrunoDir(dir: string): ImportResult {
  const warnings: string[] = [];
  const files: ImportedFile[] = [];
  const stats = { requests: 0, folders: 0 };
  for (const file of findBruFiles(dir)) {
    const { request, warnings: w } = bruToRequest(readFileSync(file, "utf8"));
    warnings.push(...w);
    if (!request) continue;
    stats.requests++;
    const rel = relative(dir, file).replace(/\.bru$/, ".tspec.yaml");
    files.push({ path: rel, content: parse.request.serialize(request) });
  }
  return { files, warnings, stats };
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
