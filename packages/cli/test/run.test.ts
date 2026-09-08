import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../src/commands/run";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

function capture() {
  let out = "";
  let err = "";
  return {
    stdout: (s: string) => {
      out += s;
    },
    stderr: (s: string) => {
      err += s;
    },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

const okFetch = (body: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

describe("truspec run", () => {
  it("runs the petstore example and passes (exit 0)", async () => {
    const cap = capture();
    let t = 0;
    const code = await runCommand(["examples/petstore", "--env", "local"], {
      cwd: repoRoot,
      fetch: okFetch({ id: 1, name: "Rex" }),
      now: () => (t += 5),
      processEnv: { token: "secret" },
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out).toMatch(/PASS/);
    expect(cap.out).toMatch(/1 passed, 0 failed/);
  });

  it("reports assertion failures (exit 1)", async () => {
    const cap = capture();
    let t = 0;
    const code = await runCommand(["examples/petstore", "--env", "local"], {
      cwd: repoRoot,
      fetch: okFetch({}, 500),
      now: () => (t += 5),
      processEnv: { token: "secret" },
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    expect(cap.out).toMatch(/FAIL/);
  });

  it("emits machine-readable JSON with --json", async () => {
    const cap = capture();
    let t = 0;
    const code = await runCommand(["examples/petstore", "--env", "local", "--json"], {
      cwd: repoRoot,
      fetch: okFetch({ id: 1 }),
      now: () => (t += 5),
      processEnv: { token: "secret" },
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out);
    expect(parsed.ok).toBe(true);
    expect(parsed.results[0].assertions.length).toBeGreaterThan(0);
  });

  it("emits JUnit XML with --reporter junit", async () => {
    const cap = capture();
    let t = 0;
    const code = await runCommand(["examples/petstore", "--env", "local", "--reporter", "junit"], {
      cwd: repoRoot,
      fetch: okFetch({ id: 1 }),
      now: () => (t += 5),
      processEnv: { token: "secret" },
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out).toMatch(/<testsuites tests="1" failures="0">/);
    expect(cap.out).toMatch(/<testcase name="Get pet by id"/);
  });

  it("exits 2 when no path is given", async () => {
    const cap = capture();
    const code = await runCommand([], { stdout: cap.stdout, stderr: cap.stderr });
    expect(code).toBe(2);
    expect(cap.err).toMatch(/Usage/);
  });

  it("exits 1 when the environment is missing", async () => {
    const cap = capture();
    const code = await runCommand(["examples/petstore", "--env", "nope"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    expect(cap.err).toMatch(/not found/);
  });

  it("ignores a non-numeric --timeout instead of breaking the run", async () => {
    const cap = capture();
    let t = 0;
    const code = await runCommand(["examples/petstore", "--env", "local", "--timeout", "abc"], {
      cwd: repoRoot,
      fetch: okFetch({ id: 1 }),
      now: () => (t += 5),
      processEnv: { token: "secret" },
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out).toMatch(/1 passed/);
  });

  it("exits 1 (fails the CI gate) when no requests are found", async () => {
    // A green build when zero requests executed silently masks a misconfigured path / uncommitted
    // files / bad glob — the worst false-positive for a gate. `run` must fail loudly, not pass.
    const dir = mkdtempSync(join(tmpdir(), "truspec-empty-"));
    try {
      const cap = capture();
      const code = await runCommand([dir], { cwd: repoRoot, stdout: cap.stdout, stderr: cap.stderr });
      expect(code).toBe(1);
      expect(cap.err).toMatch(/no .tspec.yaml requests found/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--var overrides an environment variable", async () => {
    const cap = capture();
    let seen = "";
    const code = await runCommand(
      ["examples/petstore", "--env", "local", "--var", "petId=99"],
      {
        cwd: repoRoot,
        fetch: (async (url: string) => {
          seen = url;
          return new Response(JSON.stringify({ id: 99 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }) as unknown as typeof fetch,
        now: (() => {
          let t = 0;
          return () => (t += 5);
        })(),
        processEnv: { token: "secret" },
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(0);
    expect(seen).toContain("/pets/99");
  });

  it("rejects a malformed --var with exit 2", async () => {
    const cap = capture();
    const code = await runCommand(["examples/petstore", "--var", "nope"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
    expect(cap.err).toMatch(/Invalid --var "nope"/);
  });

  it("fails with a filter-specific message when --grep matches nothing", async () => {
    const cap = capture();
    const code = await runCommand(["examples/petstore", "--env", "local", "--grep", "zzz"], {
      cwd: repoRoot,
      fetch: okFetch({ id: 1 }),
      processEnv: { token: "secret" },
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    expect(cap.err).toMatch(/--grep\/--tag matched none of the 1 request/);
  });

  it("--grep selects a matching request and reports the deselected count", async () => {
    const cap = capture();
    let t = 0;
    const code = await runCommand(["examples/petstore", "--env", "local", "--grep", "pet"], {
      cwd: repoRoot,
      fetch: okFetch({ id: 1 }),
      now: () => (t += 5),
      processEnv: { token: "secret" },
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out).toMatch(/1 passed, 0 failed/);
  });
});
