import { describe, expect, it } from "vitest";
import type { RequestSummary } from "../src/api";
import {
  baseName,
  buildFolderTree,
  countRequests,
  filterTree,
  folderOf,
  normPath,
  shortDir,
} from "../src/tree";

const req = (path: string, over: Partial<RequestSummary> = {}): RequestSummary => ({
  path,
  name: over.name ?? path.split(/[\\/]/).pop() ?? path,
  method: over.method ?? "GET",
  url: over.url ?? "https://x.test/a",
  assertions: over.assertions ?? 1,
  ...over,
});

describe("path helpers", () => {
  it("normalizes Windows separators, which the server may send", () => {
    expect(normPath("api\\users\\get.tspec.yaml")).toBe("api/users/get.tspec.yaml");
    expect(normPath("api/users/get.tspec.yaml")).toBe("api/users/get.tspec.yaml");
  });

  it("takes the folder of a path, marking the root with a distinct token", () => {
    expect(folderOf("api/users/get.tspec.yaml")).toBe("api/users");
    expect(folderOf("api\\users\\get.tspec.yaml")).toBe("api/users");
    // A root-level request has no folder at all; "·" distinguishes that from a folder named "".
    expect(folderOf("get.tspec.yaml")).toBe("·");
  });

  it("takes the last segment of a directory, ignoring a trailing slash", () => {
    expect(baseName("api/users")).toBe("users");
    expect(baseName("api/users/")).toBe("users");
    expect(baseName("")).toBe("");
  });

  it("elides the middle of a deep directory but leaves a shallow one alone", () => {
    expect(shortDir("api")).toBe("api");
    expect(shortDir("api/users")).toBe("api/users");
    expect(shortDir("api/v1/users/admin")).toBe("…/users/admin");
  });
});

describe("buildFolderTree", () => {
  it("nests requests under their directories", () => {
    const root = buildFolderTree([req("api/users/get.tspec.yaml"), req("api/pets/get.tspec.yaml")]);
    expect(root.folders.map((f) => f.name)).toEqual(["api"]);
    const api = root.folders[0]!;
    expect(api.folders.map((f) => f.name)).toEqual(["pets", "users"]);
    expect(api.folders[0]!.requests.length).toBe(1);
  });

  it("keeps a root-level request on the root node", () => {
    const root = buildFolderTree([req("top.tspec.yaml")]);
    expect(root.requests.length).toBe(1);
    expect(root.folders).toEqual([]);
  });

  it("shows a folder that exists on disk but holds no requests yet", () => {
    // A folder just created in the UI would otherwise be invisible until something was put in it.
    const root = buildFolderTree([], ["api/empty"]);
    expect(root.folders[0]!.name).toBe("api");
    expect(root.folders[0]!.folders[0]!.name).toBe("empty");
    expect(countRequests(root)).toBe(0);
  });

  it("sorts folders by name at every level, leaving request order alone", () => {
    const root = buildFolderTree([
      req("api/zeta/a.tspec.yaml"),
      req("api/alpha/b.tspec.yaml"),
      req("api/alpha/deep/z.tspec.yaml"),
      req("api/alpha/deep/a.tspec.yaml"),
    ]);
    const api = root.folders[0]!;
    expect(api.folders.map((f) => f.name)).toEqual(["alpha", "zeta"]);
    expect(api.folders[0]!.folders.map((f) => f.name)).toEqual(["deep"]);
    expect(api.folders[0]!.folders[0]!.requests.map((r) => r.path)).toEqual([
      "api/alpha/deep/z.tspec.yaml",
      "api/alpha/deep/a.tspec.yaml",
    ]);
  });

  it("normalizes Windows paths on the way in", () => {
    const root = buildFolderTree([req("api\\users\\get.tspec.yaml")], ["api\\empty"]);
    expect(root.folders[0]!.folders.map((f) => f.name).sort()).toEqual(["empty", "users"]);
  });

  it("counts every request in the subtree", () => {
    const root = buildFolderTree([
      req("a.tspec.yaml"),
      req("api/b.tspec.yaml"),
      req("api/deep/c.tspec.yaml"),
    ]);
    expect(countRequests(root)).toBe(3);
    expect(countRequests(root.folders[0]!)).toBe(2);
  });
});

describe("filterTree", () => {
  const tree = buildFolderTree([
    req("api/users/create.tspec.yaml", { name: "Create user" }),
    req("api/users/list.tspec.yaml", { name: "List users" }),
    req("api/billing/invoice.tspec.yaml", { name: "Get invoice", method: "POST" }),
  ]);

  it("returns the tree unchanged for an empty query", () => {
    expect(filterTree(tree, "")).toBe(tree);
    expect(filterTree(tree, "   ")).toBe(tree);
  });

  it("keeps a folder's whole subtree when the folder's own name matches", () => {
    const filtered = filterTree(tree, "billing");
    expect(countRequests(filtered!)).toBe(1);
    expect(filtered!.folders[0]!.folders.map((f) => f.name)).toEqual(["billing"]);
  });

  it("keeps only matching requests when the folder name does not match", () => {
    const filtered = filterTree(tree, "create");
    expect(countRequests(filtered!)).toBe(1);
    expect(filtered!.folders[0]!.folders[0]!.requests[0]!.name).toBe("Create user");
  });

  it("matches on method and URL as well as name, like the command palette", () => {
    expect(countRequests(filterTree(tree, "POST")!)).toBe(1);
    expect(countRequests(filterTree(tree, "x.test")!)).toBe(3);
  });

  it("drops a branch with no match anywhere in it", () => {
    expect(filterTree(tree, "nothing-matches-this")).toBeNull();
  });

  it("does not mutate the tree it filters", () => {
    const before = countRequests(tree);
    filterTree(tree, "create");
    expect(countRequests(tree)).toBe(before);
  });
});
