import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateCaptures } from "../src/runner";
import { loadDotenv, runPath } from "../src/workspace";

describe("evaluateCaptures", () => {
  const res = {
    status: 201,
    headers: { "x-id": "h1" },
    bodyText: "{}",
    json: { token: "t", nested: { id: 5 } },
    durationMs: 1,
  };
  it("captures from jsonpath, header, and status", () => {
    expect(
      evaluateCaptures(
        { a: "$.token", b: { jsonpath: "$.nested.id" }, c: { header: "X-Id" }, d: { status: true } },
        res,
      ),
    ).toEqual({ a: "t", b: 5, c: "h1", d: 201 });
  });
  it("ignores captures that resolve to nothing", () => {
    expect(evaluateCaptures({ x: "$.nope" }, res)).toEqual({});
  });
});

describe("loadDotenv", () => {
  it("parses KEY=VALUE with quotes and comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-env-"));
    try {
      writeFileSync(join(dir, ".env"), '# comment\nA=1\nB="two"\nC=\n');
      expect(loadDotenv(dir)).toEqual({ A: "1", B: "two", C: "" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runPath chaining + .env", () => {
  it("threads captured values into later requests, ordered by `order`", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-chain-"));
    try {
      mkdirSync(join(dir, "environments"), { recursive: true });
      writeFileSync(
        join(dir, "environments", "local.env.yaml"),
        'tspec: "0.1"\nname: local\nvariables:\n  baseUrl: "http://api.test"\n',
      );
      writeFileSync(
        join(dir, "login.tspec.yaml"),
        'tspec: "0.1"\nname: Login\nmethod: POST\nurl: "{{baseUrl}}/login"\norder: 1\nassertions:\n  - { type: status, equals: 200 }\ncapture:\n  token: "$.access_token"\n',
      );
      writeFileSync(
        join(dir, "me.tspec.yaml"),
        'tspec: "0.1"\nname: Me\nurl: "{{baseUrl}}/me"\norder: 2\nauth: { type: bearer, token: "{{token}}" }\nassertions:\n  - { type: status, equals: 200 }\n',
      );

      const sentAuth: Array<string | undefined> = [];
      const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/login")) {
          return new Response(JSON.stringify({ access_token: "abc123" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        sentAuth.push((init?.headers as Record<string, string>).Authorization);
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;

      const result = await runPath(dir, { env: "local", cwd: dir, fetch: fetchMock });
      expect(result.ok).toBe(true);
      expect(result.results.map((r) => r.name)).toEqual(["Login", "Me"]);
      expect(sentAuth).toEqual(["Bearer abc123"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves a secret from a project .env file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-dotenv-"));
    try {
      mkdirSync(join(dir, "environments"), { recursive: true });
      writeFileSync(join(dir, ".env"), 'TOKEN="from-dotenv"\n');
      writeFileSync(
        join(dir, "environments", "local.env.yaml"),
        'tspec: "0.1"\nname: local\nvariables:\n  baseUrl: "http://api.test"\nsecrets:\n  - TOKEN\n',
      );
      writeFileSync(
        join(dir, "r.tspec.yaml"),
        'tspec: "0.1"\nname: R\nurl: "{{baseUrl}}/x"\nauth: { type: bearer, token: "{{TOKEN}}" }\nassertions:\n  - { type: status, equals: 200 }\n',
      );

      let auth: string | undefined;
      const fetchMock = (async (_url: string | URL | Request, init?: RequestInit) => {
        auth = (init?.headers as Record<string, string>).Authorization;
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;

      const result = await runPath(dir, { env: "local", cwd: dir, fetch: fetchMock, processEnv: {} });
      expect(result.missingSecrets).toEqual([]);
      expect(auth).toBe("Bearer from-dotenv");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
