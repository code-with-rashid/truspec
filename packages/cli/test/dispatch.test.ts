import { beforeEach, describe, expect, it, vi } from "vitest";

// Every command module is stubbed, so this exercises the routing table itself — which command
// name reaches which function, and with which arguments — without running any of them. Until the
// dispatch moved out of `index.ts`, coverage skipped it entirely as a "re-export barrel", so a
// mis-wired `case` (the classic copy-paste slip: `case "docs": return driftCommand(rest)`) would
// have been caught by nothing here.
const S = vi.hoisted(() => ({ calls: [] as string[] }));

function stub(name: string) {
  return {
    [`${name}Command`]: (argv: string[]) => {
      S.calls.push(`${name}(${argv.join(" ")})`);
      return Promise.resolve(0);
    },
  };
}

vi.mock("../src/commands/init", () => stub("init"));
vi.mock("../src/commands/run", () => stub("run"));
vi.mock("../src/commands/drift", () => stub("drift"));
vi.mock("../src/commands/coverage", () => stub("coverage"));
vi.mock("../src/commands/contract", () => stub("contract"));
vi.mock("../src/commands/gen", () => stub("gen"));
vi.mock("../src/commands/codegen", () => stub("codegen"));
vi.mock("../src/commands/lint", () => stub("lint"));
vi.mock("../src/commands/docs", () => stub("docs"));
vi.mock("../src/commands/env", () => stub("env"));
vi.mock("../src/commands/import", () => stub("import"));
vi.mock("../src/commands/mock", () => stub("mock"));
vi.mock("../src/commands/serve", () => stub("serve"));

const { main } = await import("../src/dispatch");

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

const COMMANDS = [
  "init",
  "run",
  "drift",
  "coverage",
  "contract",
  "gen",
  "codegen",
  "lint",
  "docs",
  "env",
  "import",
  "mock",
  "serve",
];

describe("command dispatch", () => {
  beforeEach(() => {
    S.calls.length = 0;
  });

  it("routes every command to its own handler, passing the remaining argv through", async () => {
    for (const name of COMMANDS) {
      S.calls.length = 0;
      const d = capture();
      const code = await main([name, "alpha", "--beta"], d);
      expect(code, `${name} should return its handler's code`).toBe(0);
      expect(S.calls).toEqual([`${name}(alpha --beta)`]);
    }
  });

  it("prints help for no command, and for the three ways of asking for it", async () => {
    for (const argv of [[], ["help"], ["--help"], ["-h"]]) {
      const d = capture();
      expect(await main(argv, d)).toBe(0);
      expect(d.out).toContain("Usage:");
      expect(S.calls).toEqual([]);
    }
  });

  it("prints the version for --version and -v", async () => {
    for (const flag of ["--version", "-v"]) {
      const d = capture();
      expect(await main([flag], d)).toBe(0);
      expect(d.out.trim()).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it("writes to the real process streams when nothing is injected", async () => {
    // The injectable streams exist for these tests; the default path is what users actually get,
    // so it needs an assertion of its own rather than being covered only by never being run.
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      expect(await main(["--version"])).toBe(0);
      expect(out).toHaveBeenCalled();
      expect(await main(["definitely-not-a-command"])).toBe(2);
      expect(err).toHaveBeenCalled();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it("rejects an unknown command with usage and a suggestion, running nothing", async () => {
    const d = capture();
    expect(await main(["lnit"], d)).toBe(2);
    expect(d.err).toContain("did you mean 'truspec init'?");
    expect(d.err).toContain("Usage:");
    expect(S.calls).toEqual([]);
  });
});
