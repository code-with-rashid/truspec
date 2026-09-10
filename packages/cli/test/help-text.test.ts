import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, HELP } from "../src/dispatch";

const commandsDir = resolve(import.meta.dirname, "..", "src", "commands");

/** Every long flag a command's `parseArgs` accepts. */
function optionsOf(command: string): Set<string> | undefined {
  const file = join(commandsDir, `${command}.ts`);
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const block = /const options = \{(.*?)\n {2}\} as const;/s.exec(src);
  if (!block) return undefined;
  return new Set(
    [...(block[1] ?? "").matchAll(/(?:^|[{,])\s*"?([a-z][a-z-]*)"?\s*:\s*\{/g)].map((m) => m[1] as string),
  );
}

/** The (possibly wrapped) usage block for each command, from `--help`'s `Usage:` section. */
function usageBlocks(): Map<string, string> {
  const lines = HELP.split("\n");
  const start = lines.findIndex((l) => l.trim() === "Usage:") + 1;
  const out = new Map<string, string>();
  let current: string | undefined;
  for (const line of lines.slice(start)) {
    if (!line.trim()) break;
    const named = /^\s*truspec ([a-z-]+)/.exec(line);
    if (named && !line.trim().startsWith("truspec --")) {
      current = named[1] as string;
      out.set(current, (out.get(current) ?? "") + line);
    } else if (current && /^\s{20,}/.test(line)) {
      // A continuation line of the previous command's usage.
      out.set(current, `${out.get(current)}${line}`);
    } else {
      current = undefined;
    }
  }
  return out;
}

/**
 * `--help` is the usage text people read most — it ships inside the binary and needs no network —
 * and nothing checked it. Iteration 86 gated the flags named in the *docs*, in both directions, and
 * left the binary's own help unguarded; iteration 85 then moved three commands to a positional
 * main argument, updated nineteen usages across eight documentation files, and did not touch
 * `--help`, which kept advertising `truspec mock --spec <openapi>`.
 */
describe("the CLI's own --help", () => {
  const blocks = usageBlocks();

  it("has a usage block for every command the dispatcher accepts", () => {
    expect(blocks.size).toBeGreaterThan(0);
    for (const command of COMMANDS) {
      expect(blocks.has(command), `--help has no usage line for 'truspec ${command}'`).toBe(true);
    }
  });

  it("describes every command in the Commands list too", () => {
    const described = new Set([...HELP.matchAll(/^ {2}([a-z-]+)\s{2,}[A-Z]/gm)].map((m) => m[1] as string));
    for (const command of COMMANDS) {
      expect(described.has(command), `--help never describes 'truspec ${command}'`).toBe(true);
    }
  });

  it("never advertises a flag the command does not accept", () => {
    let checked = 0;
    for (const [command, text] of blocks) {
      const real = optionsOf(command);
      if (!real) continue;
      checked++;
      for (const m of text.matchAll(/--([a-z][a-z-]*)/g)) {
        const flag = m[1] as string;
        expect(real.has(flag), `--help shows 'truspec ${command} --${flag}', which it does not accept`).toBe(true);
      }
    }
    // Guard against a parse that silently matched nothing.
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  /**
   * The check that would have caught iteration 85's miss: a command that reads a positional should
   * lead with it, so the help agrees with the docs and with what people type.
   */
  it("shows a positional for every command that reads one", () => {
    for (const command of COMMANDS) {
      const src = (() => {
        try {
          return readFileSync(join(commandsDir, `${command}.ts`), "utf8");
        } catch {
          return "";
        }
      })();
      if (!/\bpositionals\b/.test(src.replace(/allowPositionals/g, ""))) continue;
      // Strip `--flag <arg>` pairs first. Without this the check passes on
      // `truspec mock --spec <openapi>` — matching the *flag's* argument and calling it a
      // positional, which is the very form this is meant to reject.
      const bare = (blocks.get(command) ?? "")
        .replace(/--[a-z][a-z-]*(?:[ =]<[^>]+>)?/g, "")
        .replace(/^\s*truspec [a-z-]+/, "");
      expect(
        /<[^>]+>/.test(bare),
        `'truspec ${command}' reads a positional but --help shows none outside a flag's argument`,
      ).toBe(true);
    }
  });

  it("covers every command module that exists, so none ships undiscoverable", () => {
    const modules = readdirSync(commandsDir)
      .filter((f) => f.endsWith(".ts") && f !== "deps.ts")
      .map((f) => f.slice(0, -3));
    for (const m of modules) {
      // `COMMANDS` is a readonly tuple of literals, so widen for the membership test.
      expect((COMMANDS as readonly string[]).includes(m), `'${m}.ts' is a command module the dispatcher does not list`).toBe(
        true,
      );
    }
  });
});
