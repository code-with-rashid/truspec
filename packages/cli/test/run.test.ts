import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("truspec run — a file that does not parse", () => {
  const workspace = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-cli-parse-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "good.tspec.yaml"),
      'tspec: "0.1"\nname: Good\nmethod: GET\nurl: "http://x/good"\nassertions: [ { type: status, equals: 200 } ]\n',
    );
    writeFileSync(join(dir, "broken.tspec.yaml"), 'tspec: "0.1"\nname: Broken\nmethod: GET\nurl: "http://x"\nheadrs: { a: b }\n');
    return dir;
  };

  it("exits 1, names the file, suggests the key, and still reports the request that passed", async () => {
    const dir = workspace();
    const cap = capture();
    try {
      const code = await runCommand([dir], { cwd: repoRoot, stdout: cap.stdout, stderr: cap.stderr, fetch: okFetch({}) });
      expect(code).toBe(1);
      expect(cap.out).toContain("PASS  Good");        // the rest of the run was not lost
      expect(cap.out).toContain("broken.tspec.yaml"); // pre-fix: the message named no file at all
      expect(cap.out).toContain("did you mean 'headers'?");
      expect(cap.out).toContain("1 unparseable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not claim `no requests found` when the requests are there but unreadable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-cli-allbad-"));
    writeFileSync(join(dir, "broken.tspec.yaml"), 'tspec: "0.1"\nname: Broken\nheadrs: { a: b }\n');
    const cap = capture();
    try {
      const code = await runCommand([dir], { cwd: repoRoot, stdout: cap.stdout, stderr: cap.stderr, fetch: okFetch({}) });
      expect(code).toBe(1);
      expect(cap.err).not.toContain("no .tspec.yaml requests found");
      expect(cap.out).toContain("could not parse");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

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

  it("--reporter html writes a standalone report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-html-"));
    try {
      const cap = capture();
      const file = join(dir, "report.html");
      let t = 0;
      const code = await runCommand(
        ["examples/petstore", "--env", "local", "--reporter", "html", "-o", file],
        {
          cwd: repoRoot,
          fetch: okFetch({ id: 1 }),
          now: () => (t += 5),
          processEnv: { token: "secret" },
          stdout: cap.stdout,
          stderr: cap.stderr,
        },
      );
      expect(code).toBe(0);
      const html = readFileSync(file, "utf8");
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("Get pet by id");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown --reporter instead of silently falling back to human output", async () => {
    const cap = capture();
    const code = await runCommand(["examples/petstore", "--reporter", "xml"], {
      cwd: repoRoot,
      fetch: okFetch({ id: 1 }),
      processEnv: { token: "secret" },
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
    expect(cap.err).toMatch(/Unknown --reporter "xml"/);
    expect(cap.err).toMatch(/human, json, junit, html/);
  });

  it("warns loudly when TLS verification is disabled", async () => {
    const cap = capture();
    let t = 0;
    await runCommand(["examples/petstore", "--env", "local", "--insecure"], {
      cwd: repoRoot,
      fetch: okFetch({ id: 1 }),
      now: () => (t += 5),
      processEnv: { token: "secret" },
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    // A run that silently accepted any certificate would be a gate that proves nothing.
    expect(cap.err).toMatch(/--insecure disables TLS certificate verification/);
  });

  it("reports an unreadable certificate path instead of failing at connect time", async () => {
    const cap = capture();
    const code = await runCommand(["examples/petstore", "--ca", "nope.pem"], {
      cwd: repoRoot,
      processEnv: {},
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    expect(cap.err).toMatch(/could not configure transport/);
  });
});
