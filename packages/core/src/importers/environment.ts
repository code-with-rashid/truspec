import { environment as environmentParser } from "../format/parse";
import { SCHEMA_VERSION } from "../format/schema";
import { CREDENTIAL_NAME } from "../lint/rules";
import type { ImportedFile } from "./types";

/** `Base Environment` -> `base-environment`, so the name works as `truspec run --env <name>`. */
export function envSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "imported";
}

/**
 * An `environments/<name>.env.yaml` for variables carried by an imported collection.
 *
 * Both importers dropped them. Postman keeps a collection-level `variable` array; Insomnia keeps
 * `_type: "environment"` resources — and neither reached the output, so **every import produced a
 * collection that could not run**: `{{baseUrl}}` referenced by every request and declared nowhere,
 * which `truspec lint` then reported once per request. The on-ramp left you at a dead end.
 *
 * A credential-named variable becomes a **secret name only**. `CLAUDE.md` states the rule plainly —
 * *never inline secrets into request or environment files* — and an import is exactly where it
 * would be broken at scale: Postman collections routinely carry a live `token` value, and writing
 * it into a file the user then commits is the failure this format exists to prevent. The name is
 * declared so the variable resolves from the OS environment or a `.env`; the value is reported in a
 * warning so it is not silently lost.
 */
export function environmentFile(
  name: string,
  vars: Record<string, string>,
  warnings: string[],
): ImportedFile | undefined {
  const variables: Record<string, string> = {};
  const secrets: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (CREDENTIAL_NAME.test(key)) secrets.push(key);
    else variables[key] = value;
  }
  if (Object.keys(variables).length === 0 && secrets.length === 0) return undefined;
  if (secrets.length > 0) {
    warnings.push(
      `Environment "${name}": ${secrets.join(", ")} declared as secret(s), value(s) not written — ` +
        `set them in your shell or a .env file.`,
    );
  }
  const slug = envSlug(name);
  return {
    path: `environments/${slug}.env.yaml`,
    // Serialized through the parser, so an import can never write a file that does not parse.
    // `secrets: []` appears when there are none: the schema defaults the field, and `serialize`
    // re-parses before stringifying, so an omitted empty array comes back anyway.
    content: environmentParser.serialize({
      tspec: SCHEMA_VERSION,
      name: slug,
      variables,
      secrets: secrets.sort(),
    }),
  };
}
