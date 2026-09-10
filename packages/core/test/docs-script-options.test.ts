import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectionDocs } from "../src/docs";
import { RequestSchema } from "../src/format/schema";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-docs-so-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(path: string, body: string): void {
  const full = join(dir, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

const docsFor = (body: string): string => {
  write("api/r.tspec.yaml", body);
  return collectionDocs(dir).markdown;
};

/**
 * The generated document described every part of a request except two: its `script` and its
 * `options`. Both change what the request does, and the `script` omission also made the **Asserts**
 * list wrong — a `post` script's `tr.expect(...)` calls are assertions, and that list is what a
 * reader takes as the definition of what the request checks.
 */
describe("transport options in the generated document", () => {
  it("says what a timeout and a retry policy actually do", () => {
    const md = docsFor(
      `tspec: "0.1"\nname: R\nurl: "https://api.test/x"\noptions: { timeoutMs: 3000, retries: 2, retryDelayMs: 250 }\nassertions: []\n`,
    );
    expect(md).toContain("**Transport:** times out after 3000ms");
    expect(md).toContain("re-sends up to 2 time(s) on a transient failure, first after 250ms");
  });

  it("mentions redirect following and its cap", () => {
    const md = docsFor(
      `tspec: "0.1"\nname: R\nurl: "https://api.test/x"\noptions: { followRedirects: true, maxRedirects: 3 }\nassertions: []\n`,
    );
    expect(md).toContain("follows redirects (max 3)");
  });

  it("says nothing for a request on the defaults", () => {
    const md = docsFor(`tspec: "0.1"\nname: R\nurl: "https://api.test/x"\nassertions: []\n`);
    expect(md).not.toContain("**Transport:**");
  });

  it("says nothing for options that are present but inert", () => {
    // `retries: 0` is the default behaviour spelled out; it is not a fact worth a line.
    const md = docsFor(
      `tspec: "0.1"\nname: R\nurl: "https://api.test/x"\noptions: { retries: 0, followRedirects: false }\nassertions: []\n`,
    );
    expect(md).not.toContain("**Transport:**");
  });
});

describe("scripts in the generated document", () => {
  it("shows a post script and warns that it adds assertions the list above does not have", () => {
    const md = docsFor(
      `tspec: "0.1"\nname: R\nurl: "https://api.test/x"\nscript:\n  post: |\n    tr.expect(tr.response.json.length > 0, "at least one")\nassertions:\n  - { type: status, equals: 200 }\n`,
    );
    expect(md).toContain("**Script**");
    expect(md).toContain("`tr.expect(...)` calls add assertions beyond the list above");
    expect(md).toContain("<code>script.post</code> — runs after the response arrives");
    expect(md).toContain('tr.expect(tr.response.json.length > 0, "at least one")');
  });

  it("warns that a script runs with the same access as the process", () => {
    const md = docsFor(
      `tspec: "0.1"\nname: R\nurl: "https://api.test/x"\nscript:\n  pre: |\n    tr.set("a", 1)\nassertions: []\n`,
    );
    expect(md).toContain("same access as the `truspec` process itself");
  });

  it("documents both phases, in run order", () => {
    const md = docsFor(
      `tspec: "0.1"\nname: R\nurl: "https://api.test/x"\nscript:\n  pre: |\n    tr.set("a", 1)\n  post: |\n    tr.set("b", 2)\nassertions: []\n`,
    );
    expect(md.indexOf("script.pre")).toBeLessThan(md.indexOf("script.post"));
    expect(md).toContain("runs before the request is sent");
  });

  it("says nothing for a request with no script", () => {
    expect(docsFor(`tspec: "0.1"\nname: R\nurl: "https://api.test/x"\nassertions: []\n`)).not.toContain("**Script**");
  });
});

/**
 * The gate for the class rather than the two instances: `truspec docs` claims to document a
 * collection, so a field the format has and the document never mentions is a silent omission —
 * which is exactly how `script` and `options` went missing.
 */
describe("every request field reaches the document", () => {
  it("holds for a request that sets all of them", () => {
    const md = docsFor(
      `tspec: "0.1"
name: Everything
method: POST
url: "https://api.test/things"
docs: "Prose about it."
headers: { Accept: application/json }
query: { limit: "10" }
tags: [smoke]
auth: { type: bearer, token: "{{tok}}" }
body: { type: json, content: { a: 1 } }
options: { timeoutMs: 1000, retries: 1 }
script:
  pre: |
    tr.set("tok", "x")
capture:
  id: "$.id"
order: 2
assertions:
  - { type: status, equals: 201 }
spec: { operation: "POST /things" }
`,
    );
    // Fields that are structural rather than descriptive: the schema version, and the run order
    // (which the document expresses by listing requests in it).
    const structural = new Set(["tspec", "order", "method", "url"]);
    const documented: Record<string, string> = {
      name: "Everything",
      docs: "Prose about it.",
      headers: "Accept",
      query: "limit",
      tags: "smoke",
      auth: "**Auth:**",
      body: "**Body**",
      options: "**Transport:**",
      script: "**Script**",
      capture: "**Captures**",
      assertions: "**Asserts**",
      spec: "**Spec operation:**",
    };
    // `POST /things` covers method and url together.
    expect(md).toContain("`POST https://api.test/things`");
    for (const [field, marker] of Object.entries(documented)) {
      expect(md, `the document never mentions the request's \`${field}\``).toContain(marker);
    }
    // If the format grows a field, this list has to grow with it.
    const known = new Set([...Object.keys(documented), ...structural]);
    for (const field of Object.keys(RequestSchema.shape)) {
      expect(known.has(field), `\`${field}\` is a request field with no documented marker`).toBe(true);
    }
  });
});
