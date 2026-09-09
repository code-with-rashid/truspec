import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mainArg } from "../src/args";
import { genCommand } from "../src/commands/gen";
import { mockCommand } from "../src/commands/mock";
import { serveCommand } from "../src/commands/serve";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const SPEC = join(repoRoot, "examples", "petstore", "openapi.yaml");

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

describe("mainArg", () => {
  const opts = { what: "collection directory", flag: "--dir", usage: "USAGE\n" };

  it("takes the positional", () => {
    expect(mainArg(["examples"], undefined, opts).value).toBe("examples");
  });

  it("takes the flag when there is no positional", () => {
    expect(mainArg([], "examples", opts).value).toBe("examples");
  });

  it("is undefined when neither is given, leaving the default to the command", () => {
    expect(mainArg([], undefined, opts).value).toBeUndefined();
  });

  it("accepts both when they agree", () => {
    expect(mainArg(["api"], "api", opts).value).toBe("api");
  });

  it("refuses both when they disagree, rather than silently picking one", () => {
    const r = mainArg(["api"], "other", opts);
    expect(r.value).toBeUndefined();
    expect(r.error).toContain('Conflicting collection directory: "api" and --dir "other"');
    expect(r.error).toContain("USAGE");
  });

  it("refuses more than one positional, naming them", () => {
    const r = mainArg(["a", "b"], undefined, opts);
    expect(r.error).toContain("Too many arguments: a b");
  });
});

/**
 * `serve`, `mock` and `gen` all called `parseArgs({ allowPositionals: true })` and never read the
 * positionals. `truspec serve examples` was therefore accepted and discarded — the server came up
 * on the current directory instead, and the wrong collection was on screen with nothing wrong
 * anywhere to explain it.
 */
describe("the three commands that used to discard their argument", () => {
  it("serve takes the collection as a positional", async () => {
    const cap = capture();
    let served: string | undefined;
    const code = await serveCommand(["examples"], {
      cwd: repoRoot,
      processEnv: {},
      stdout: cap.stdout,
      stderr: cap.stderr,
      block: false,
      onReady: (h) => {
        served = h.dir;
      },
    });
    expect(code).toBe(0);
    expect(served).toBe(join(repoRoot, "examples"));
  });

  it("serve refuses a directory that is not there, instead of an empty workspace", async () => {
    const cap = capture();
    const code = await serveCommand(["definitely-not-here"], {
      cwd: repoRoot,
      processEnv: {},
      stdout: cap.stdout,
      stderr: cap.stderr,
      block: false,
    });
    expect(code).toBe(1);
    expect(cap.err).toContain("Path not found: definitely-not-here");
  });

  it("serve refuses a file where a directory belongs", async () => {
    const cap = capture();
    const code = await serveCommand(["README.md"], {
      cwd: repoRoot,
      processEnv: {},
      stdout: cap.stdout,
      stderr: cap.stderr,
      block: false,
    });
    expect(code).toBe(1);
    expect(cap.err).toContain("Not a directory: README.md");
  });

  it("gen takes the spec as a positional, and still accepts --spec", async () => {
    for (const argv of [[SPEC, "--out", "out"], ["--spec", SPEC, "--out", "out"]]) {
      const dir = mkdtempSync(join(tmpdir(), "truspec-mainarg-"));
      const cap = capture();
      try {
        const code = await genCommand(argv, { cwd: dir, processEnv: {}, stdout: cap.stdout, stderr: cap.stderr });
        expect(code, cap.err).toBe(0);
        expect(cap.out).toMatch(/Generated 3 request\(s\)/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("gen names the conflict instead of choosing", async () => {
    const cap = capture();
    const code = await genCommand([SPEC, "--spec", "other.yaml", "--out", "x"], {
      cwd: repoRoot,
      processEnv: {},
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
    expect(cap.err).toContain("Conflicting OpenAPI spec");
  });

  it("mock takes the spec as a positional", async () => {
    const cap = capture();
    let url: string | undefined;
    const code = await mockCommand([SPEC, "--port", "0"], {
      cwd: repoRoot,
      processEnv: {},
      stdout: cap.stdout,
      stderr: cap.stderr,
      block: false,
      onReady: (h) => {
        url = h.url;
        void h.close();
      },
    });
    expect(code, cap.err).toBe(0);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("mock refuses two specs", async () => {
    const cap = capture();
    const code = await mockCommand(["a.yaml", "b.yaml"], {
      cwd: repoRoot,
      processEnv: {},
      stdout: cap.stdout,
      stderr: cap.stderr,
      block: false,
    });
    expect(code).toBe(2);
    expect(cap.err).toContain("Too many arguments: a.yaml b.yaml");
  });
});

/**
 * The gate for the class, not just the three instances: a command that lets `parseArgs` accept
 * positionals and never reads them will silently discard whatever the user typed. Either read them
 * or don't allow them.
 */
describe("no command accepts positionals it never reads", () => {
  it("holds for every command module", () => {
    const dir = join(repoRoot, "packages", "cli", "src", "commands");
    const offenders: string[] = [];
    for (const file of ["run", "lint", "docs", "drift", "coverage", "contract", "codegen", "env", "gen", "import", "init", "mock", "serve"]) {
      const src = readFileSync(join(dir, `${file}.ts`), "utf8");
      if (src.includes("allowPositionals: true") && !/\bpositionals\b/.test(src.replace("allowPositionals", ""))) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
