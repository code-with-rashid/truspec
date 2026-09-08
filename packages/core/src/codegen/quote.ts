/** Per-language string literal quoting. Every generator escapes through one of these. */

/** POSIX shell single-quoted literal — the only form with no interior escape sequences at all. */
export function sh(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** PowerShell single-quoted literal ('' escapes a quote). */
export function ps(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** A double-quoted literal for the C-family (JS, Java, C#, Go, Rust, Swift, Kotlin, Dart, PHP). */
export function dq(s: string): string {
  return `"${cEscape(s)}"`;
}

/** Python string literal — every C-family escape used here is also a valid Python escape. */
export const py = dq;

/** Ruby double-quoted literal; `#{` starts interpolation and must be escaped. */
export function rb(s: string): string {
  return `"${cEscape(s).replace(/#\{/g, "\\#{")}"`;
}

function cEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    // Any other control character would otherwise land raw inside the literal.
    .replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Indent every line after the first by `n` spaces (for embedding a block in a call argument). */
export function indentRest(block: string, n: number): string {
  return block.split("\n").join(`\n${" ".repeat(n)}`);
}
