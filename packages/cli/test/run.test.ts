import { resolve } from "node:path";
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
});
