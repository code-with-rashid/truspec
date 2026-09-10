import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatLint, lintCommand } from "../src/commands/lint";

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

async function run(argv: string[], cwd = repoRoot) {
  const cap = capture();
  const code = await lintCommand(argv, { cwd, processEnv: {}, stdout: cap.stdout, stderr: cap.stderr });
  return { code, out: cap.out, err: cap.err };
}

/** A throwaway collection with one warning-level and one error-level problem. */
function seed(): string {
  const dir = mkdtempSync(join(tmpdir(), "truspec-lint-cli-"));
  mkdirSync(join(dir, "api"), { recursive: true });
  writeFileSync(join(dir, "api", "warn.tspec.yaml"), 'tspec: "0.1"\nname: Warn\nurl: "https://api.test/x"\n');
  return dir;
}

describe("truspec lint", () => {
  it("passes on the bundled examples", async () => {
    const r = await run(["examples"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/no findings/);
  });

  it("exits 0 on warnings but 1 with --strict", async () => {
    const dir = seed();
    try {
      expect((await run([dir])).code).toBe(0);
      const strict = await run([dir, "--strict"]);
      expect(strict.code).toBe(1);
      expect(strict.out).toMatch(/no-assertions/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 on an error regardless of --strict", async () => {
    const dir = seed();
    try {
      // Assembled at run time: the value has to look like a real token for the rule to fire,
      // which is exactly what a secret scanner blocks when it appears as a literal.
      const token = `ghp${"_abcdefghijklmnopqrstuvwxyz0123"}`;
      writeFileSync(
        join(dir, "api", "secret.tspec.yaml"),
        `tspec: "0.1"\nname: S\nurl: "https://api.test/x"\nauth:\n  type: bearer\n  token: "${token}"\nassertions:\n  - { type: status, lt: 400 }\n`,
      );
      const r = await run([dir]);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/error inline-secret/);
      expect(r.out).toMatch(/1 error\(s\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits machine-readable JSON with --json", async () => {
    const dir = seed();
    try {
      const r = await run([dir, "--json"]);
      const report = JSON.parse(r.out) as { findings: Array<{ rule: string; severity: string }>; files: number };
      expect(report.files).toBe(1);
      expect(report.findings[0]!.rule).toBe("no-assertions");
      expect(report.findings[0]!.severity).toBe("warning");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("silences a rule with --disable", async () => {
    const dir = seed();
    try {
      const r = await run([dir, "--strict", "--disable", "no-assertions"]);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/no findings/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists every rule with --list-rules", async () => {
    const r = await run(["--list-rules"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/inline-secret\s+error/);
    expect(r.out).toMatch(/no-assertions\s+warning/);
  });

  it("prints each finding's line in a gutter, ordered down the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-lint-cli-"));
    try {
      const key = `AKIA${"IOSFODNN7EXAMPLE"}`;
      writeFileSync(
        join(dir, "bad.tspec.yaml"),
        `tspec: "0.1"\nname: Bad\nurl: "http://api.example.com/x"\nheaders:\n  X-Api-Key: "${key}"\nassertions:\n  - { type: status, equals: 200 }\n`,
      );
      const r = await run([dir]);
      const gutters = r.out
        .split("\n")
        .filter((l) => /warning|error/.test(l) && l.startsWith("  "))
        .map((l) => l.trim().split(" ")[0]);
      // insecure-url is on line 3, inline-secret on line 5, and they print in that order.
      expect(gutters).toEqual(["3", "5"]);
      expect(r.out).toMatch(/^ {2}5 {2}✗ error inline-secret:/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves the gutter blank for a finding with no line", async () => {
    const report = {
      ok: true,
      dir: "/tmp/x",
      files: 1,
      errors: 0,
      warnings: 2,
      findings: [
        { path: "a.tspec.yaml", severity: "warning" as const, rule: "whole-file", message: "no line here" },
        { path: "a.tspec.yaml", severity: "warning" as const, rule: "somewhere", message: "line 12", line: 12 },
      ],
    };
    const out = formatLint(report, "/tmp");
    // The located finding comes first; the unlocated one sorts last with an empty, padded gutter.
    expect(out.split("\n")[1]).toBe("  12  ! warning somewhere: line 12");
    expect(out.split("\n")[2]).toBe("      ! warning whole-file: no line here");
  });

  it("exits 1 for a missing path", async () => {
    const r = await run(["nope"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Path not found/);
  });
});
