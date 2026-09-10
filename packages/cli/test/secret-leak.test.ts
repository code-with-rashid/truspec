import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codegenCommand } from "../src/commands/codegen";
import { runCommand } from "../src/commands/run";

const SECRET = `SUPER${"SECRET"}VALUE123`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-secret-"));
  mkdirSync(join(dir, "environments"), { recursive: true });
  writeFileSync(
    join(dir, "environments", "local.env.yaml"),
    'tspec: "0.1"\nname: local\nvariables:\n  baseUrl: "https://api.test"\nsecrets:\n  - apiToken\n',
  );
  writeFileSync(
    join(dir, "req.tspec.yaml"),
    `tspec: "0.1"
name: Uses a secret
method: POST
url: "{{baseUrl}}/echo?t={{apiToken}}"
headers:
  Authorization: "Bearer {{apiToken}}"
body:
  type: json
  content: { token: "{{apiToken}}" }
assertions:
  - { type: status, equals: 200 }
`,
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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

const deps = (cap: ReturnType<typeof capture>) => ({
  cwd: dir,
  processEnv: { apiToken: SECRET },
  stdout: cap.stdout,
  stderr: cap.stderr,
});

/**
 * `truspec --help` says the env command "never prints secret values", and the run reporters mask
 * them. `codegen --env` did not: it baked the resolved credential into the URL, the Authorization
 * header and the body — and a snippet's documented purpose is being pasted into a bug report.
 * It was the only surface that leaked, and nothing said so.
 */
describe("a declared secret does not reach a generated snippet", () => {
  it("keeps its placeholder by default, as it does without --env", async () => {
    const cap = capture();
    const code = await codegenCommand(["req.tspec.yaml", "--env", "local"], deps(cap));
    expect(code).toBe(0);
    expect(cap.out).not.toContain(SECRET);
    expect(cap.out).toContain("{{apiToken}}");
  });

  it("still resolves the variables that are not secrets", async () => {
    const cap = capture();
    await codegenCommand(["req.tspec.yaml", "--env", "local"], deps(cap));
    expect(cap.out).toContain("https://api.test");
  });

  it("says which names it held back, and how to get them", async () => {
    const cap = capture();
    await codegenCommand(["req.tspec.yaml", "--env", "local"], deps(cap));
    expect(cap.err).toContain("apiToken");
    expect(cap.err).toContain("--with-secrets");
    // On stderr, so a redirected snippet is not polluted by the warning.
    expect(cap.out).not.toContain("--with-secrets");
  });

  it("inlines them only when explicitly asked", async () => {
    const cap = capture();
    await codegenCommand(["req.tspec.yaml", "--env", "local", "--with-secrets"], deps(cap));
    expect(cap.out).toContain(SECRET);
    expect(cap.err).not.toContain("--with-secrets");
  });

  it("holds them back in a file written with --output too", async () => {
    const cap = capture();
    // Absolute, because `emit` writes relative to `process.cwd()` rather than the injected `cwd`.
    // In the real binary those are the same directory; only an embedder sees the difference.
    const out = join(dir, "snippet.sh");
    await codegenCommand(["req.tspec.yaml", "--env", "local", "--output", out], deps(cap));
    expect(readFileSync(out, "utf8")).not.toContain(SECRET);
    expect(readFileSync(out, "utf8")).toContain("{{apiToken}}");
  });

  it("says nothing when the environment declares no secrets", async () => {
    writeFileSync(
      join(dir, "environments", "bare.env.yaml"),
      'tspec: "0.1"\nname: bare\nvariables:\n  baseUrl: "https://api.test"\n',
    );
    const cap = capture();
    await codegenCommand(["req.tspec.yaml", "--env", "bare"], deps(cap));
    expect(cap.err).toBe("");
  });
});

/** The surfaces that already masked, pinned so they stay that way. */
describe("no run reporter prints a declared secret", () => {
  const ok = (async () => new Response('{"id":1}', { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  for (const args of [["--json"], ["--reporter", "junit"], []]) {
    it(`truspec run ${args.join(" ") || "(human)"}`, async () => {
      const cap = capture();
      await runCommand([".", "--env", "local", ...args], { ...deps(cap), fetch: ok });
      expect(cap.out).not.toContain(SECRET);
      expect(cap.err).not.toContain(SECRET);
    });
  }
});
