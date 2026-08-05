import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { exportPostman } from "../src/exporters";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-export-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("exportPostman", () => {
  it("converts a nested workspace into a valid Postman v2.1 collection", () => {
    writeFileSync(
      join(dir, "folder.tspec.yaml"),
      parse.folderConfig.serialize({
        tspec: "0.1",
        name: "My Collection",
        auth: { type: "bearer", token: "{{token}}" },
      }),
    );
    writeFileSync(
      join(dir, "list-pets.tspec.yaml"),
      parse.request.serialize({
        tspec: "0.1",
        name: "List pets",
        method: "GET",
        url: "{{baseUrl}}/pets",
        query: { limit: "10" },
        assertions: [],
      }),
    );
    mkdirSync(join(dir, "users"));
    writeFileSync(
      join(dir, "users", "folder.tspec.yaml"),
      parse.folderConfig.serialize({ tspec: "0.1", name: "Users" }),
    );
    writeFileSync(
      join(dir, "users", "create-user.tspec.yaml"),
      parse.request.serialize({
        tspec: "0.1",
        name: "Create user",
        method: "POST",
        url: "{{baseUrl}}/users",
        headers: { "X-Trace": "1" },
        body: { type: "json", content: { name: "Rex" } },
        assertions: [],
      }),
    );
    mkdirSync(join(dir, "environments"));
    writeFileSync(join(dir, "environments", "local.env.yaml"), "tspec: '0.1'\nname: local\n");

    const result = exportPostman(dir);
    expect(result.warnings).toEqual([]);
    expect(result.stats).toEqual({ requests: 2, folders: 1 });
    expect(result.collection.info).toMatchObject({ name: "My Collection" });
    expect(result.collection.auth).toEqual({
      type: "bearer",
      bearer: [{ key: "token", value: "{{token}}", type: "string" }],
    });

    const items = result.collection.item as Array<Record<string, unknown>>;
    // folders sort before requests at the same level
    expect(items[0]).toMatchObject({ name: "Users" });
    expect(items[1]).toMatchObject({ name: "List pets" });

    const listPets = items[1] as { request: { url: string; method: string } };
    expect(listPets.request.url).toBe("{{baseUrl}}/pets?limit=10");
    expect(listPets.request.method).toBe("GET");

    const usersFolder = items[0] as { item: Array<Record<string, unknown>> };
    const createUser = usersFolder.item[0] as { name: string; request: Record<string, unknown> };
    expect(createUser.name).toBe("Create user");
    expect(createUser.request.header).toEqual([{ key: "X-Trace", value: "1" }]);
    expect(createUser.request.body).toEqual({
      mode: "raw",
      raw: JSON.stringify({ name: "Rex" }, null, 2),
      options: { raw: { language: "json" } },
    });

    // environments/ is never treated as a folder of requests
    expect(JSON.stringify(result.collection)).not.toContain("local.env");
  });

  it("falls back to the directory name when there's no folder.tspec.yaml", () => {
    writeFileSync(
      join(dir, "ping.tspec.yaml"),
      parse.request.serialize({ tspec: "0.1", name: "Ping", method: "GET", url: "{{baseUrl}}/ping", assertions: [] }),
    );
    const result = exportPostman(dir);
    expect(result.collection.info).toMatchObject({ name: /.+/ });
    expect(result.collection.auth).toBeUndefined();
  });

  it("skips an invalid request file with a warning instead of throwing", () => {
    writeFileSync(join(dir, "broken.tspec.yaml"), "tspec: '0.1'\nname: 1\n"); // name must be a string
    writeFileSync(
      join(dir, "ok.tspec.yaml"),
      parse.request.serialize({ tspec: "0.1", name: "Ok", method: "GET", url: "http://x", assertions: [] }),
    );
    const result = exportPostman(dir);
    expect(result.stats.requests).toBe(1);
    expect(result.warnings.some((w) => w.includes("broken.tspec.yaml"))).toBe(true);
  });
});
