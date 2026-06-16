import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import {
  bruToRequest,
  extractBlocks,
  importBrunoDir,
  importPostman,
  importPostmanFile,
} from "../src/importers";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const imports = resolve(repoRoot, "examples", "imports");

describe("importPostman", () => {
  const collection = JSON.parse(readFileSync(resolve(imports, "postman-collection.json"), "utf8"));

  it("converts folders and requests into valid TruSpec files", () => {
    const result = importPostman(collection);
    expect(result.stats).toEqual({ requests: 2, folders: 1 });

    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toContain("users/get-user.tspec.yaml");
    expect(paths).toContain("users/create-user.tspec.yaml");
    expect(paths).toContain("folder.tspec.yaml"); // collection-level bearer auth

    // every emitted file must parse back as valid TruSpec
    for (const f of result.files) {
      if (f.path.startsWith("folder")) parse.folderConfig.parse(f.content);
      else parse.request.parse(f.content);
    }
  });

  it("maps url/query/body/auth correctly", () => {
    const result = importPostman(collection);
    const get = parse.request.parse(
      result.files.find((f) => f.path.endsWith("get-user.tspec.yaml"))?.content ?? "",
    );
    expect(get.url).toBe("{{baseUrl}}/users/{{id}}");
    expect(get.query).toEqual({ expand: "profile" });

    const create = parse.request.parse(
      result.files.find((f) => f.path.endsWith("create-user.tspec.yaml"))?.content ?? "",
    );
    expect(create.method).toBe("POST");
    expect(create.body).toEqual({ type: "json", content: { name: "Rex" } });
  });

  it("reads from a file and rejects non-collections", () => {
    const result = importPostmanFile(resolve(imports, "postman-collection.json"));
    expect(result.stats.requests).toBe(2);
    expect(() => importPostman({ not: "a collection" })).toThrow(/Postman/);
  });
});

describe("Bruno .bru parsing", () => {
  it("splits brace blocks including JSON bodies", () => {
    const blocks = extractBlocks('meta {\n  name: x\n}\nbody:json {\n  { "a": 1 }\n}');
    expect(blocks.map((b) => b.name)).toEqual(["meta", "body"]);
    expect(blocks[1]?.sub).toBe("json");
    expect(blocks[1]?.body).toContain('"a": 1');
  });

  it("converts a .bru request with auth, query, and asserts", () => {
    const text = readFileSync(resolve(imports, "bruno", "get-user.bru"), "utf8");
    const { request, warnings } = bruToRequest(text);
    expect(warnings).toEqual([]);
    expect(request?.name).toBe("Get user");
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("{{baseUrl}}/users/{{id}}");
    expect(request?.query).toEqual({ expand: "profile" });
    expect(request?.auth).toEqual({ type: "bearer", token: "{{token}}" });
    expect(request?.assertions).toEqual([
      { type: "status", equals: 200 },
      { type: "jsonpath", path: "$.id", exists: true },
    ]);
    // round-trips as valid TruSpec
    if (request) parse.request.parse(parse.request.serialize(request));
  });
});

describe("importBrunoDir", () => {
  it("imports a directory of .bru files", () => {
    const result = importBrunoDir(resolve(imports, "bruno"));
    expect(result.stats.requests).toBe(1);
    expect(result.files[0]?.path).toBe("get-user.tspec.yaml");
    parse.request.parse(result.files[0]?.content ?? "");
  });

  it("terminates on a symlink cycle in the source directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-bru-"));
    try {
      writeFileSync(join(dir, "r.bru"), "get {\n  url: http://x\n}\n");
      symlinkSync(dir, join(dir, "loop")); // loop -> dir  (cycle)
      const result = importBrunoDir(dir);
      expect(result.stats.requests).toBe(1); // the one real .bru, discovered once
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
