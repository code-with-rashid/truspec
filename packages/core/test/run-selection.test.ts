import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPath } from "../src/workspace";

let dir: string;

/** A collection of four requests with tags, so selection has something to select from. */
function seed(): void {
  mkdirSync(join(dir, "auth"), { recursive: true });
  mkdirSync(join(dir, "billing"), { recursive: true });
  const write = (path: string, name: string, tags?: string[], order?: number): void =>
    writeFileSync(
      join(dir, path),
      [
        'tspec: "0.1"',
        `name: ${name}`,
        "method: GET",
        'url: "https://api.test/x"',
        ...(order !== undefined ? [`order: ${order}`] : []),
        ...(tags ? [`tags: [${tags.join(", ")}]`] : []),
        "assertions:",
        "  - { type: status, equals: 200 }",
        "",
      ].join("\n"),
    );
  write("auth/login.tspec.yaml", "Login", ["smoke", "auth"], 1);
  write("auth/logout.tspec.yaml", "Logout", ["auth"], 2);
  write("billing/invoice.tspec.yaml", "Get invoice", ["smoke"], 3);
  write("billing/refund.tspec.yaml", "Refund", undefined, 4);
}

const ok = (async () => new Response("{}", { status: 200 })) as typeof fetch;
const fail = (async () => new Response("{}", { status: 500 })) as typeof fetch;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-select-"));
  seed();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const names = (r: Awaited<ReturnType<typeof runPath>>): string[] => r.results.map((x) => x.name);

describe("run selection", () => {
  it("runs everything when no selector is given", async () => {
    const r = await runPath(dir, { fetch: ok });
    expect(r.results.length).toBe(4);
    expect(r.deselected).toBeUndefined();
  });

  it("grep matches the request name, case-insensitively", async () => {
    const r = await runPath(dir, { fetch: ok, grep: "log" });
    expect(names(r).sort()).toEqual(["Login", "Logout"]);
    expect(r.deselected).toBe(2);
  });

  it("grep also matches the workspace-relative path, so a folder can be selected", async () => {
    const r = await runPath(dir, { fetch: ok, grep: "^billing/" });
    expect(names(r).sort()).toEqual(["Get invoice", "Refund"]);
  });

  it("rejects an invalid grep pattern with a clear message", async () => {
    await expect(runPath(dir, { fetch: ok, grep: "([" })).rejects.toThrow(/Invalid --grep pattern/);
  });

  it("tags select the union of the requests carrying any of them", async () => {
    expect(names(await runPath(dir, { fetch: ok, tags: ["smoke"] })).sort()).toEqual([
      "Get invoice",
      "Login",
    ]);
    expect((await runPath(dir, { fetch: ok, tags: ["smoke", "auth"] })).results.length).toBe(3);
  });

  it("combines grep and tags as an AND", async () => {
    const r = await runPath(dir, { fetch: ok, grep: "log", tags: ["smoke"] });
    expect(names(r)).toEqual(["Login"]);
  });

  it("reports an empty selection rather than silently passing", async () => {
    const r = await runPath(dir, { fetch: ok, tags: ["nope"] });
    expect(r.results).toEqual([]);
    expect(r.deselected).toBe(4);
  });

  it("ignores an empty tag string instead of matching nothing", async () => {
    expect((await runPath(dir, { fetch: ok, tags: [""] })).results.length).toBe(4);
  });
});

describe("run control", () => {
  it("bail stops at the first failure and reports the rest as skipped", async () => {
    const r = await runPath(dir, { fetch: fail, bail: true });
    expect(r.results.length).toBe(1);
    expect(r.results[0]!.name).toBe("Login"); // order: 1 runs first
    expect(r.skipped).toBe(3);
    expect(r.ok).toBe(false);
  });

  it("without bail every request still runs after a failure", async () => {
    const r = await runPath(dir, { fetch: fail });
    expect(r.results.length).toBe(4);
    expect(r.skipped).toBe(0);
  });

  it("bail on a passing run changes nothing", async () => {
    const r = await runPath(dir, { fetch: ok, bail: true });
    expect(r.results.length).toBe(4);
    expect(r.skipped).toBe(0);
  });

  it("delays between requests but never before the first one", async () => {
    const waits: number[] = [];
    const r = await runPath(dir, {
      fetch: ok,
      delayMs: 250,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(r.results.length).toBe(4);
    expect(waits).toEqual([250, 250, 250]);
  });

  it("does not sleep at all when no delay is configured", async () => {
    const waits: number[] = [];
    await runPath(dir, {
      fetch: ok,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([]);
  });

  it("applies --var overrides over the environment's variables", async () => {
    let seen = "";
    writeFileSync(
      join(dir, "var.tspec.yaml"),
      'tspec: "0.1"\nname: Var\nmethod: GET\nurl: "{{base}}/x"\nassertions: []\n',
    );
    await runPath(dir, {
      grep: "^Var$",
      vars: { base: "https://override.test" },
      fetch: (async (url: string) => {
        seen = url;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(seen).toBe("https://override.test/x");
  });
});
