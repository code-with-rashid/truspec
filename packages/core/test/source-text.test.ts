import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

/** Every tracked text source file, straight from git so build output and ignored files never count. */
function trackedSources(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\u0000").filter((f) => /\.(ts|tsx|js|jsx|json|md|ya?ml|css|html)$/.test(f));
}

describe("source files stay plain text", () => {
  it("contains no raw control characters", () => {
    // A NUL separator (`domain\0path\0name`) is a fine *value* and a bad *encoding*. Written as a
    // literal byte it makes `file` call the source binary — and grep/ripgrep then skip it in
    // silence, so the module drops out of every code search. The OAuth token cache and the cookie
    // jar were both invisible that way for as long as they had existed. Write the escape, not the
    // byte. Tab, LF and CR are the only control characters a source file has business holding.
    const control = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
    const offenders: string[] = [];
    for (const file of trackedSources()) {
      // latin1: one byte to one code unit, so a stray byte is never smoothed into U+FFFD.
      const text = readFileSync(resolve(ROOT, file), "latin1");
      const match = control.exec(text);
      if (!match) continue;
      const line = text.slice(0, match.index).split("\n").length;
      const code = match[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
      offenders.push(`${file}:${line} contains U+${code}`);
    }
    expect(offenders).toEqual([]);
  });
});
