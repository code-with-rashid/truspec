import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/format";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

interface Block {
  where: string;
  kind: "request" | "environment" | "folderConfig";
  body: string;
}

/**
 * Every fenced YAML block in the shipped prose that is a whole collection file.
 *
 * Identified by shape rather than by a marker, so a new example is covered the moment it is
 * written — an opt-in marker is a marker someone forgets.
 */
function collectionExamples(): Block[] {
  const files = [
    ...readdirSync(join(repoRoot, "docs"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(repoRoot, "docs", f)),
    join(repoRoot, "README.md"),
    join(repoRoot, "CLAUDE.md"),
  ];
  const out: Block[] = [];
  for (const file of files) {
    // Normalise line endings first. Git for Windows checks these files out with CRLF, so a fence
    // regex anchored on "```yaml\n" matches nothing there — and this suite would then find zero
    // examples and report green while checking nothing. Its own vacuity guard caught exactly that
    // on the first Windows CI run.
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    for (const m of text.matchAll(/```yaml\n([\s\S]*?)```/g)) {
      const body = m[1] as string;
      const line = text.slice(0, m.index).split("\n").length;
      const where = `${relative(repoRoot, file)}:${line}`;
      const named = /^\s*name:/m.test(body);
      if (named && /^\s*variables:/m.test(body)) out.push({ where, kind: "environment", body });
      else if (named && /^\s*url:/m.test(body)) out.push({ where, kind: "request", body });
      else if (/^\s*baseUrl:/m.test(body) && !/^\s*url:/m.test(body))
        out.push({ where, kind: "folderConfig", body });
    }
  }
  return out;
}

/**
 * The docs are where a person — or an agent reading `CLAUDE.md` — copies a file from, and nothing
 * checked that what they copy parses. The schema is `.strict()` and has moved a great deal; a block
 * written against an older shape stays in the prose looking authoritative.
 *
 * This caught the canonical request example in **`CLAUDE.md` itself** — the file whose stated job
 * is telling agents how to author *valid* files. It listed `options:` with a trailing comment and
 * no value, which YAML reads as `null`, which the schema rejects.
 */
describe("every collection example in the docs parses", () => {
  const examples = collectionExamples();

  it("finds examples to check, so this suite cannot pass vacuously", () => {
    expect(examples.length).toBeGreaterThanOrEqual(10);
    // The three kinds a collection is made of should all be represented.
    expect(new Set(examples.map((e) => e.kind)).size).toBeGreaterThanOrEqual(2);
  });

  for (const { where, kind, body } of examples) {
    it(`${where} (${kind})`, () => {
      expect(() => parse[kind].parse(body)).not.toThrow();
    });
  }
});
