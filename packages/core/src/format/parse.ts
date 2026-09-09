import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { z } from "zod";
import {
  EnvironmentSchema,
  FolderConfigSchema,
  RequestSchema,
} from "./schema";
import { suggestKey } from "./suggest";

export interface ParseResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  issues?: z.ZodIssue[];
}

/**
 * Render Zod issues, adding a "did you mean" for a mistyped key.
 *
 * `.strict()` catches `headrs:` before it silently does nothing at run time; naming the key it was
 * one character away from is the rest of that job. `raw` is the parsed value, needed to narrow a
 * discriminated union to the branch whose keys are the relevant ones.
 */
function formatIssues(error: z.ZodError, schema: z.ZodTypeAny, raw: unknown): string {
  return error.issues
    .map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}${hint(i, schema, raw)}`)
    .join("\n");
}

function hint(issue: z.ZodIssue, schema: z.ZodTypeAny, raw: unknown): string {
  if (issue.code !== "unrecognized_keys") return "";
  const pairs = issue.keys
    .map((key) => ({ key, did: suggestKey(schema, issue.path, key, raw) }))
    .filter((p): p is { key: string; did: string } => p.did !== undefined);
  if (pairs.length === 0) return "";
  // With one key the reader already knows which one; repeating it back is noise.
  const body =
    pairs.length === 1 ? `'${pairs[0]!.did}'` : pairs.map((p) => `'${p.key}' → '${p.did}'`).join(", ");
  return ` (did you mean ${body}?)`;
}

/**
 * Builds a parse/serialize/validate helper for one of the TruSpec file schemas.
 * `serialize` validates before producing YAML so agents never emit invalid files.
 */
function makeParser<S extends z.ZodTypeAny>(schema: S, label: string) {
  type T = z.infer<S>;
  return {
    /** Parse YAML text; throws with a readable message on invalid input. */
    parse(text: string): T {
      const raw = parseYaml(text);
      const result = schema.safeParse(raw);
      if (!result.success) {
        throw new Error(`Invalid TruSpec ${label}:\n${formatIssues(result.error, schema, raw)}`);
      }
      return result.data;
    },
    /** Parse YAML text without throwing. */
    safeParse(text: string): ParseResult<T> {
      let raw: unknown;
      try {
        raw = parseYaml(text);
      } catch (e) {
        return { ok: false, error: `YAML parse error: ${(e as Error).message}` };
      }
      const result = schema.safeParse(raw);
      if (!result.success) {
        return {
          ok: false,
          error: formatIssues(result.error, schema, raw),
          issues: result.error.issues,
        };
      }
      return { ok: true, data: result.data };
    },
    /** Validate an already-parsed object (e.g. an MCP write payload). */
    validate(value: unknown): ParseResult<T> {
      const result = schema.safeParse(value);
      return result.success
        ? { ok: true, data: result.data }
        : {
            ok: false,
            error: formatIssues(result.error, schema, value),
            issues: result.error.issues,
          };
    },
    /** Validate, then serialize to clean, diff-friendly YAML. */
    serialize(value: T): string {
      const validated = schema.parse(value);
      return stringifyYaml(validated, { lineWidth: 0 });
    },
  };
}

export const request = makeParser(RequestSchema, "request");
export const folderConfig = makeParser(FolderConfigSchema, "folder config");
export const environment = makeParser(EnvironmentSchema, "environment");
