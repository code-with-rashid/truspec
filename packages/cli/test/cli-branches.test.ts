import { createServer } from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractCommand } from "../src/commands/contract";
import { coverageCommand } from "../src/commands/coverage";
import { driftCommand } from "../src/commands/drift";
import { genCommand } from "../src/commands/gen";
import { importCommand } from "../src/commands/import";
import { mockCommand } from "../src/commands/mock";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const cap = () => { let o = "", e = ""; return { stdout: (s: string) => (o += s), stderr: (s: string) => (e += s), get out() { return o; }, get err() { return e; } }; };
const okFetch = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
const petstore = resolve(repoRoot, "examples", "petstore");

describe("CLI branch coverage", () => {
  // ---- coverage ----
  it("coverage: bad flag → 2, no spec → 2", async () => {
    expect(await coverageCommand(["--nope"], { cwd: repoRoot, ...cap() })).toBe(2);
    expect(await coverageCommand(["examples/petstore"], { cwd: repoRoot, ...cap() })).toBe(2);
  });
  it("coverage: bad spec path → 1", async () => {
    expect(await coverageCommand(["--spec", "nope.yaml", "examples/petstore"], { cwd: repoRoot, ...cap() })).toBe(1);
  });
  it("coverage: --min above actual fails (1), --json emits report", async () => {
    const c = cap();
    expect(await coverageCommand(["--spec", "openapi.yaml", "--min", "100", "--json"], { cwd: petstore, stdout: c.stdout, stderr: c.stderr })).toBe(1);
    expect(JSON.parse(c.out)).toHaveProperty("percent");
  });
  it("coverage: --min 0 passes (0)", async () => {
    expect(await coverageCommand(["--spec", "openapi.yaml", "--min", "0"], { cwd: petstore, ...cap() })).toBe(0);
  });

  // ---- gen ----
  it("gen: bad flag → 2, spec not found → 1", async () => {
    expect(await genCommand(["--nope"], { cwd: repoRoot, ...cap() })).toBe(2);
    expect(await genCommand(["--spec", "nope.yaml", "--out", "/tmp/x"], { cwd: repoRoot, ...cap() })).toBe(1);
  });
  it("gen: custom --base-url-var + skips unsupported methods", async () => {
    const out = mkdtempSync(resolve(tmpdir(), "gen-"));
    try {
      const c = cap();
      // a spec with a TRACE op (unsupported) to exercise the skipped branch
      const dir = mkdtempSync(resolve(tmpdir(), "spec-"));
      const { writeFileSync } = await import("node:fs");
      writeFileSync(resolve(dir, "s.yaml"), 'openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths:\n  /a: { get: { responses: { "200": {} } }, trace: { responses: { "200": {} } } }\n');
      const code = await genCommand(["--spec", resolve(dir, "s.yaml"), "--out", out, "--base-url-var", "API"], { cwd: repoRoot, stdout: c.stdout, stderr: c.stderr });
      expect(code).toBe(0);
      expect(c.out).toMatch(/Generated 1 request/);
      expect(c.err).toMatch(/skipped \(unsupported method\)/);
      rmSync(dir, { recursive: true, force: true });
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  // ---- drift (incl. --live + --json) ----
  it("drift: bad flag → 2, no spec → 2", async () => {
    expect(await driftCommand(["--nope"], { cwd: repoRoot, ...cap() })).toBe(2);
    expect(await driftCommand(["examples/petstore"], { cwd: repoRoot, ...cap() })).toBe(2);
  });
  it("drift: --json emits report; bad spec → 1", async () => {
    const c = cap();
    await driftCommand(["--spec", "openapi.yaml", "--json"], { cwd: petstore, stdout: c.stdout, stderr: c.stderr });
    expect(JSON.parse(c.out)).toHaveProperty("added");
    expect(await driftCommand(["--spec", "nope.yaml"], { cwd: petstore, ...cap() })).toBe(1);
  });
  it("drift: --live probes a running API", async () => {
    const server = createServer((q, res) => { res.writeHead(q.url?.startsWith("/pets") ? 200 : 404); res.end(); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const c = cap();
      await driftCommand(["--spec", "openapi.yaml", "--live", `http://127.0.0.1:${port}`, "--json", "--timeout", "2000"], { cwd: petstore, stdout: c.stdout, stderr: c.stderr });
      expect(JSON.parse(c.out)).toHaveProperty("liveMissing");
    } finally { await new Promise((r) => server.close(() => r(undefined))); }
  });

  // ---- mock ----
  it("mock: bad flag → 2, no spec → 2, spec not found → 1", async () => {
    expect(await mockCommand(["--nope"], { cwd: repoRoot, ...cap(), block: false })).toBe(2);
    expect(await mockCommand([], { cwd: repoRoot, ...cap(), block: false })).toBe(2);
    expect(await mockCommand(["--spec", "nope.yaml"], { cwd: repoRoot, ...cap(), block: false })).toBe(1);
  });
  it("mock: starts with --validate + --delay", async () => {
    const c = cap();
    let handle: { url: string; routes: number; close: () => Promise<void> } | undefined;
    const code = await mockCommand(["--spec", "openapi.yaml", "--port", "0", "--validate", "--delay", "1"], { cwd: petstore, stdout: c.stdout, stderr: c.stderr, block: false, onReady: (h) => { handle = h; } });
    try { expect(code).toBe(0); expect(handle?.routes).toBeGreaterThan(0); expect(c.out).toMatch(/Mock server on/); } finally { await handle?.close(); }
  });

  // ---- import ----
  it("import: bad source → 2, missing input → 2, not found → 1", async () => {
    expect(await importCommand(["nope", "x"], { cwd: repoRoot, ...cap() })).toBe(2);
    expect(await importCommand(["postman"], { cwd: repoRoot, ...cap() })).toBe(2);
    expect(await importCommand(["postman", "nope.json"], { cwd: repoRoot, ...cap() })).toBe(1);
  });

  // ---- contract ----
  it("contract: no spec → 2, --json with injected fetch → 0/1, bad spec → 1", async () => {
    expect(await contractCommand([], { cwd: petstore, ...cap() })).toBe(2);
    const c = cap();
    await contractCommand(["--spec", "openapi.yaml", "--env", "local", "--json"], { cwd: petstore, stdout: c.stdout, stderr: c.stderr, fetch: okFetch({ id: 1, name: "Rex" }), processEnv: { token: "secret" }, now: () => 0 });
    expect(JSON.parse(c.out)).toHaveProperty("conformed");
    expect(await contractCommand(["--spec", "nope.yaml"], { cwd: petstore, ...cap() })).toBe(1);
  });
});
