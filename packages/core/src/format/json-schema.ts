import { zodToJsonSchema } from "zod-to-json-schema";
import {
  EnvironmentSchema,
  FolderConfigSchema,
  RequestSchema,
} from "./schema";

/**
 * Builds the published JSON Schemas (written to `packages/core/schema/*.json` by
 * `scripts/emit-schema.mjs`). The Zod schema is the source of truth; these
 * artifacts let agents and editors validate `.tspec.yaml` files without TruSpec.
 */
export function buildJsonSchemas(): Record<string, unknown> {
  return {
    "request.schema.json": zodToJsonSchema(RequestSchema, {
      name: "TruSpecRequest",
      $refStrategy: "none",
    }),
    "folder.schema.json": zodToJsonSchema(FolderConfigSchema, {
      name: "TruSpecFolderConfig",
      $refStrategy: "none",
    }),
    "environment.schema.json": zodToJsonSchema(EnvironmentSchema, {
      name: "TruSpecEnvironment",
      $refStrategy: "none",
    }),
  };
}
