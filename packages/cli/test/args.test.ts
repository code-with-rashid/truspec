import { parseArgs } from "node:util";
import { describe, expect, it } from "vitest";
import { argError, closest } from "../src/args";
import { lintCommand } from "../src/commands/lint";
import { main } from "../src/dispatch";

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

/** Runs `parseArgs` so the assertions are against Node's real error, not a hand-built stand-in. */
function unknownOptionError(argv: string[], options: Record<string, { type: "boolean" | "string" }>): unknown {
  try {
    parseArgs({ args: argv, allowPositionals: true, options });
    throw new Error("expected parseArgs to reject");
  } catch (e) {
    return e;
  }
}

describe("closest", () => {
  it("finds the intended word through a typo, an omission, and a transposition", () => {
    expect(closest("stict", ["strict", "json", "output"])).toBe("strict");
    expect(closest("lnit", ["init", "run", "lint"])).toBe("init");
    expect(closest("coverge", ["coverage", "contract"])).toBe("coverage");
  });

  it("refuses to guess when nothing is close — a wrong guess is worse than none", () => {
    expect(closest("frobnicate", ["init", "run", "lint", "docs"])).toBeUndefined();
    expect(closest("zzzzzz", ["strict", "json"])).toBeUndefined();
  });

  it("is case-insensitive, since a shouted flag is still the same flag", () => {
    expect(closest("STRICT", ["strict"])).toBe("strict");
  });

  it("has nothing to offer against an empty candidate list", () => {
    expect(closest("strict", [])).toBeUndefined();
  });
});

describe("argError", () => {
  const options = { strict: { type: "boolean" }, json: { type: "boolean" } } as const;

  it("names the command and the flag that was probably meant", () => {
    const e = unknownOptionError(["--stict"], { ...options });
    expect(argError(e, "lint", { ...options })).toContain(
      "Unknown option '--stict' for 'truspec lint' — did you mean '--strict'?",
    );
  });

  it("names the command without guessing when nothing is close", () => {
    const e = unknownOptionError(["--zzzzzz"], { ...options });
    const msg = argError(e, "lint", { ...options });
    expect(msg).toContain("Unknown option '--zzzzzz' for 'truspec lint'");
    expect(msg).not.toContain("did you mean");
  });

  it("handles a short flag", () => {
    const e = unknownOptionError(["-x"], { ...options });
    expect(argError(e, "run", { ...options })).toContain("Unknown option '-x' for 'truspec run'");
  });

  it("appends the command's usage when there is one", () => {
    const e = unknownOptionError(["--stict"], { ...options });
    expect(argError(e, "lint", { ...options }, "Usage: truspec lint\n")).toContain("Usage: truspec lint");
  });

  it("passes a non-parseArgs failure through unchanged", () => {
    expect(argError(new Error("something else broke"), "lint", { ...options })).toContain("something else broke");
  });
});

describe("the messages a mistyped invocation actually produces", () => {
  it("suggests the command", async () => {
    const d = capture();
    const code = await main(["lnit"], { stdout: d.stdout, stderr: d.stderr });
    expect(code).toBe(2);
    expect(d.err).toContain("did you mean 'truspec init'?");
  });

  it("does not invent a command that was never close", async () => {
    const d = capture();
    const code = await main(["frobnicate"], { stdout: d.stdout, stderr: d.stderr });
    expect(code).toBe(2);
    expect(d.err).toContain("Unknown command: frobnicate");
    expect(d.err).not.toContain("did you mean");
  });

  it("suggests the flag, and shows the usage line that lists the real ones", async () => {
    const d = capture();
    const code = await lintCommand(["--stict"], { stdout: d.stdout, stderr: d.stderr });
    expect(code).toBe(2);
    expect(d.err).toContain("did you mean '--strict'?");
    expect(d.err).toContain("Usage: truspec lint");
  });
});
