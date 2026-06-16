import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { z } from "zod";
import {
  EnvironmentSchema,
  FolderConfigSchema,
  RequestSchema,
} from "./schema";

export interface ParseResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  issues?: z.ZodIssue[];
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("\n");
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
        throw new Error(`Invalid TruSpec ${label}:\n${formatIssues(result.error)}`);
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
          error: formatIssues(result.error),
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
            error: formatIssues(result.error),
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
