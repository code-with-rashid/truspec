/**
 * @truspec/core — the TruSpec engine.
 *
 * This entry deliberately carries **only the browser-safe modules**: `format` and `runner`, as
 * namespaces. Everything else — `workspace`, `spec`, `importers`, `exporters`, `codegen`, `lint`,
 * `docs`, `jsonpath`, `mock`, `http` — is reached by its own subpath, so importing the engine into
 * a browser build cannot drag `node:fs` or an HTTP server in behind it.
 *
 * Prefer a subpath even in Node: it is what the docs use, and it tree-shakes.
 */
export * as format from "./format";
export * as runner from "./runner";
