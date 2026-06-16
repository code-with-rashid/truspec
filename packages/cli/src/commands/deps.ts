import { writeFileSync } from "node:fs";

export interface CommandDeps {
  cwd: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  processEnv: NodeJS.ProcessEnv;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export function resolveDeps(deps: Partial<CommandDeps>): CommandDeps {
  return {
    cwd: deps.cwd ?? process.cwd(),
    fetch: deps.fetch,
    now: deps.now,
    processEnv: deps.processEnv ?? process.env,
    stdout: deps.stdout ?? ((s) => void process.stdout.write(s)),
    stderr: deps.stderr ?? ((s) => void process.stderr.write(s)),
  };
}

/** Parse a numeric CLI flag; returns undefined for missing or non-finite values. */
export function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Write newline-terminated `text` to a file (when `output` is set) or stdout. */
export function emit(d: CommandDeps, text: string, output?: string): void {
  const withNl = text.endsWith("\n") ? text : `${text}\n`;
  if (output) {
    writeFileSync(output, withNl);
    d.stdout(`Wrote output to ${output}\n`);
  } else {
    d.stdout(withNl);
  }
}
