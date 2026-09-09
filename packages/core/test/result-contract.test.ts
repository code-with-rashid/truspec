import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

/**
 * Every field a `RunResult` can carry, read off the type that defines it.
 *
 * `--json` and the MCP tools hand this object to machines — CI reporters, agents, the web client —
 * and the two places that describe it for them (`docs/api.md`, `docs/cli.md`) had already fallen
 * behind by four fields before anyone noticed. Reading the source means the gate cannot be
 * satisfied by updating a list of names in the test.
 */
function declaredFields(source: string, from: string, to: string): string[] {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  expect(start, `${from} not found`).toBeGreaterThan(-1);
  expect(end, `${to} not found after ${from}`).toBeGreaterThan(start);
  const block = source.slice(start, end);
  const names = new Set<string>();
  // `name: string;` / `bytes?: number;` at any indent, ignoring comment bodies.
  for (const line of block.split("\n")) {
    const m = /^\s{2,}([A-Za-z_][\w]*)\??:/.exec(line);
    if (m?.[1]) names.add(m[1]);
  }
  return [...names];
}

describe("the run result is the machine-facing contract, and the docs are part of it", () => {
  const runSource = readFileSync(resolve(ROOT, "packages/core/src/runner/run.ts"), "utf8");
  const apiDocs = readFileSync(resolve(ROOT, "docs/api.md"), "utf8");
  const cliDocs = readFileSync(resolve(ROOT, "docs/cli.md"), "utf8");

  const resultFields = declaredFields(runSource, "export interface RunResult {", "\n}");
  // The nested `response` object, whose own fields are the ones most often read.
  const responseFields = declaredFields(runSource, "  response?: {", "\n  };");

  it("finds the fields it is supposed to check, so an empty pass is impossible", () => {
    expect(resultFields).toContain("ok");
    expect(resultFields).toContain("assertions");
    expect(responseFields).toContain("status");
    expect(responseFields.length).toBeGreaterThanOrEqual(5);
  });

  it.each([
    ["docs/api.md", () => apiDocs],
    ["docs/cli.md", () => cliDocs],
  ])("%s describes every field a result can carry", (_name, read) => {
    const text = read();
    const missing = [...resultFields, ...responseFields].filter((f) => !text.includes(f));
    expect(missing, `undocumented result fields: ${missing.join(", ")}`).toEqual([]);
  });
});
