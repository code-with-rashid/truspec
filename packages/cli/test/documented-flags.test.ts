import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const commandsDir = join(repoRoot, "packages", "cli", "src", "commands");

/** Every long flag each command's `parseArgs` accepts, read from the command modules. */
function optionsByCommand(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const file of readdirSync(commandsDir)) {
    if (!file.endsWith(".ts") || file === "deps.ts") continue;
    const src = readFileSync(join(commandsDir, file), "utf8");
    const block = /const options = \{(.*?)\n {2}\} as const;/s.exec(src);
    if (!block) continue;
    const keys = [...(block[1] ?? "").matchAll(/^ {4}"?([a-z][a-z-]*)"?:\s*\{/gm)].map((m) => m[1] as string);
    out.set(file.slice(0, -3), new Set(keys));
  }
  return out;
}

/** All prose the project ships: the docs site, the README, and the agent guide. */
function allDocs(): Array<{ path: string; text: string }> {
  const files = [
    ...readdirSync(join(repoRoot, "docs"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(repoRoot, "docs", f)),
    join(repoRoot, "README.md"),
    join(repoRoot, "CLAUDE.md"),
  ];
  return files.map((path) => ({ path, text: readFileSync(path, "utf8") }));
}

/**
 * The docs are the product's front door, and every `truspec …` line in them is a promise that the
 * invocation works. Nothing checked either direction: a renamed flag would leave a documented
 * command that fails, and a new flag could ship undiscoverable — which is exactly what had happened
 * to seven of `@truspec/core`'s thirteen entry points before the surface was gated.
 */
describe("every documented truspec invocation is a real one", () => {
  const options = optionsByCommand();

  it("names a flag the command actually accepts", () => {
    const problems: string[] = [];
    for (const { path, text } of allDocs()) {
      text.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/(?:^|[\s`(|])(?:npx\s+)?truspec\s+([a-z-]+)([^\n`|]*)/g)) {
          const command = m[1] as string;
          const known = options.get(command);
          // `truspec --version` and the like are not commands; the dispatcher owns those.
          if (!known) continue;
          for (const flag of (m[2] ?? "").matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) {
            const name = flag[1] as string;
            if (!known.has(name)) {
              problems.push(`${path.replace(`${repoRoot}/`, "")}:${i + 1} — 'truspec ${command} --${name}'`);
            }
          }
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it("documents every flag that ships, so none is undiscoverable", () => {
    const prose = allDocs()
      .map((d) => d.text)
      .join("\n");
    const undocumented: string[] = [];
    for (const [command, flags] of options) {
      for (const flag of flags) {
        if (!prose.includes(`--${flag}`)) undocumented.push(`truspec ${command} --${flag}`);
      }
    }
    expect(undocumented).toEqual([]);
  });

  it("reads a real option set for every command, so neither check is vacuous", () => {
    expect(options.size).toBeGreaterThanOrEqual(13);
    expect(options.get("lint")).toContain("strict");
    expect(options.get("run")).toContain("env");
  });
});
