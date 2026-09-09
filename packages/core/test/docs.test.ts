import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectionDocs } from "../src/docs";
import { generateCode } from "../src/codegen";
import { parse } from "../src/format";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-docs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(path: string, body: string): void {
  const full = join(dir, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

const REQUEST = `tspec: "0.1"
name: Get pet
method: GET
url: "{{baseUrl}}/pets/{{petId}}"
query:
  expand: owner
headers:
  Accept: application/json
tags: [smoke]
docs: Fetch a single pet.
capture:
  ownerId: "$.owner.id"
assertions:
  - { type: status, equals: 200 }
spec:
  operation: "GET /pets/{id}"
`;

describe("collectionDocs", () => {
  it("documents a request's endpoint, prose, params, headers, asserts and captures", () => {
    write("api/get-pet.tspec.yaml", REQUEST);
    const { markdown, count } = collectionDocs(dir);
    expect(count).toBe(1);
    expect(markdown).toContain("### Get pet");
    expect(markdown).toContain("`GET {{baseUrl}}/pets/{{petId}}`");
    expect(markdown).toContain("Fetch a single pet.");
    expect(markdown).toContain("| `expand` | `owner` |");
    expect(markdown).toContain("| `Accept` | `application/json` |");
    // In words, not as the internal object: this document is read by people who do not have the
    // schema open.
    expect(markdown).toContain("- status is 200");
    expect(markdown).not.toContain('{"type":"status"');
    expect(markdown).toContain("`{{ownerId}}` ← `$.owner.id`");
    expect(markdown).toContain("**Spec operation:** `GET /pets/{id}`");
    expect(markdown).toContain("**Tags:** `smoke`");
    expect(markdown).toContain("`api/get-pet.tspec.yaml`");
  });

  it("is deterministic: the same files always produce byte-identical output", () => {
    write("api/get-pet.tspec.yaml", REQUEST);
    const a = collectionDocs(dir).markdown;
    const b = collectionDocs(dir).markdown;
    expect(a).toBe(b);
    // A timestamp would make every regeneration a diff, which is how generated docs stop being
    // regenerated. There must be no date, and no absolute path, anywhere in the output.
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(a).not.toContain(dir);
  });

  it("includes an example that has the folder's base URL applied exactly once", () => {
    write("api/folder.tspec.yaml", 'tspec: "0.1"\nbaseUrl: "{{baseUrl}}"\nheaders: { Accept: application/json }\n');
    write("api/get-pet.tspec.yaml", REQUEST);
    const { markdown } = collectionDocs(dir);
    expect(markdown).toContain("curl -X GET");
    expect(markdown).toContain("{{baseUrl}}/pets/{{petId}}");
    // The bug this pins: the folder base was prepended to a URL that already began with it.
    expect(markdown).not.toContain("{{baseUrl}}/{{baseUrl}}");
  });

  it("renders the example in another language, or omits it entirely", () => {
    write("api/get-pet.tspec.yaml", REQUEST);
    expect(collectionDocs(dir, { lang: "python-requests" }).markdown).toContain("import requests");
    const none = collectionDocs(dir, { lang: "none" }).markdown;
    expect(none).not.toContain("<details>");
  });

  it("groups by folder and links a table of contents when there are several requests", () => {
    write("api/a.tspec.yaml", 'tspec: "0.1"\nname: Alpha\nurl: "https://x.test/a"\nassertions: []\n');
    write("api/deep/b.tspec.yaml", 'tspec: "0.1"\nname: Beta\nurl: "https://x.test/b"\nassertions: []\n');
    const { markdown } = collectionDocs(dir);
    expect(markdown).toContain("[Alpha](#alpha)");
    expect(markdown).toContain("[Beta](#beta)");
    expect(markdown).toContain("## `api/`");
    expect(markdown).toContain("## `api/deep/`");
  });

  it("orders requests by folder, then run order, then path", () => {
    write("api/z.tspec.yaml", 'tspec: "0.1"\nname: Last\norder: 9\nurl: "https://x.test/z"\nassertions: []\n');
    write("api/a.tspec.yaml", 'tspec: "0.1"\nname: First\norder: 1\nurl: "https://x.test/a"\nassertions: []\n');
    const { markdown } = collectionDocs(dir);
    expect(markdown.indexOf("### First")).toBeLessThan(markdown.indexOf("### Last"));
  });

  it("reports an unreadable file in the document instead of blanking it", () => {
    write("api/good.tspec.yaml", 'tspec: "0.1"\nname: Good\nurl: "https://x.test/a"\nassertions: []\n');
    write("api/broken.tspec.yaml", "name: [unclosed\n");
    const { markdown, count, errors } = collectionDocs(dir);
    expect(count).toBe(1);
    expect(errors.map((e) => e.path)).toEqual(["api/broken.tspec.yaml"]);
    expect(markdown).toContain("### Good");
    expect(markdown).toContain("Could not be read");
    expect(markdown).toContain("api/broken.tspec.yaml");
  });

  it("escapes a pipe in a name or value so a table cannot break out", () => {
    write("api/x.tspec.yaml", 'tspec: "0.1"\nname: "a | b"\nurl: "https://x.test/a"\nquery: { "k|1": "v|2" }\nassertions: []\n');
    const { markdown } = collectionDocs(dir);
    expect(markdown).toContain("a \\| b");
    expect(markdown).toContain("`k\\|1`");
  });

  it("shifts every heading when embedded at a deeper level", () => {
    write("api/x.tspec.yaml", 'tspec: "0.1"\nname: X\nurl: "https://x.test/a"\nassertions: []\n');
    const { markdown } = collectionDocs(dir, { baseLevel: 3 });
    expect(markdown.startsWith("### ")).toBe(true);
    expect(markdown).toContain("##### X");
  });

  it("renders each body type in a sensible fence", () => {
    write(
      "api/j.tspec.yaml",
      'tspec: "0.1"\nname: J\nmethod: POST\nurl: "https://x.test/j"\nbody:\n  type: json\n  content: { a: 1 }\nassertions: []\n',
    );
    write(
      "api/g.tspec.yaml",
      'tspec: "0.1"\nname: G\nmethod: POST\nurl: "https://x.test/g"\nbody:\n  type: graphql\n  query: "{ me { id } }"\nassertions: []\n',
    );
    const { markdown } = collectionDocs(dir);
    expect(markdown).toContain("```json");
    expect(markdown).toContain("```graphql");
    expect(markdown).toContain("{ me { id } }");
  });

  it("documents the repository's own example collection end to end", () => {
    const { markdown, count, errors } = collectionDocs(join(repoRoot, "examples", "blog"));
    expect(errors).toEqual([]);
    expect(count).toBe(3);
    expect(markdown).toContain("[Create post](#create-post)");
  });
});

describe("resolveRequest base-URL handling (regression)", () => {
  it("does not prepend a folder base URL to a URL that already starts with a placeholder", () => {
    const req = parse.request.parse('name: r\nurl: "{{baseUrl}}/pets"\nassertions: []');
    const { code } = generateCode(req, "curl", {
      folder: { tspec: "0.1", baseUrl: "{{baseUrl}}" },
    });
    expect(code).toContain("'{{baseUrl}}/pets'");
  });

  it("still prepends it to a genuinely relative URL", () => {
    const req = parse.request.parse('name: r\nurl: "/pets"\nassertions: []');
    const { code } = generateCode(req, "curl", {
      folder: { tspec: "0.1", baseUrl: "https://api.test" },
    });
    expect(code).toContain("'https://api.test/pets'");
  });
});
