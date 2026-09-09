import { editDistance } from "@truspec/core/format";

/**
 * The closest candidate to `input`, or nothing if the nearest one isn't close enough to be a
 * plausible typo. Same shape as the schema-key suggester in `@truspec/core/format`: a little more
 * slack for longer words, never enough for an unrelated name to match — a wrong guess is worse
 * than no guess, because the reader acts on it.
 */
export function closest(input: string, candidates: readonly string[]): string | undefined {
  const limit = Math.min(3, Math.max(1, Math.floor(input.length / 3)));
  let best: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = editDistance(input.toLowerCase(), candidate.toLowerCase());
    if (distance < bestScore) {
      bestScore = distance;
      best = candidate;
    }
  }
  return bestScore <= limit ? best : undefined;
}

/**
 * Turn a `parseArgs` failure into a message about the mistake the user actually made.
 *
 * Node's own text for an unknown option explains how to pass a *positional* argument that starts
 * with a dash — accurate, and almost never the answer, because the overwhelmingly common cause is
 * a typo. `truspec lint --stict` deserves "did you mean '--strict'?", not a paragraph about `--`.
 */
export function argError(
  e: unknown,
  command: string,
  options: Record<string, unknown>,
  usage = "",
): string {
  const err = e as { code?: string; message?: string };
  if (err.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    const flag = /'(--?[^']+)'/.exec(err.message ?? "")?.[1];
    const bare = flag?.replace(/^--?/, "");
    const guess = bare === undefined ? undefined : closest(bare, Object.keys(options));
    const head = `Unknown option '${flag ?? bare ?? "?"}' for 'truspec ${command}'`;
    return guess !== undefined
      ? `${head} — did you mean '--${guess}'?\n${usage}`
      : `${head}\n${usage}`;
  }
  return `${(e as Error).message}\n${usage}`;
}

/**
 * Resolve a command's single main argument from a positional or its equivalent flag.
 *
 * Three commands used `parseArgs({ allowPositionals: true })` and then never read the positionals:
 * `serve`, `mock` and `gen`. `truspec serve examples` was therefore *accepted and discarded* — the
 * server came up on the current directory instead. `mock` and `gen` at least failed, but their
 * usage line never said the path you typed had been thrown away.
 *
 * Both forms are accepted, because the flag is what these commands have always documented. Giving
 * both with different values is a mistake rather than a preference to resolve silently — the same
 * reasoning as the format's `.strict()`: surface it, don't guess.
 *
 * Returns `{ error }` for the caller to print, or `{ value }` — `undefined` when neither was given,
 * so each command applies its own default or its own "required" message.
 */
export function mainArg(
  positionals: string[],
  flagValue: string | undefined,
  opts: { what: string; flag: string; usage: string },
): { value?: string; error?: string } {
  if (positionals.length > 1) {
    return { error: `Too many arguments: ${positionals.join(" ")}. Expected one ${opts.what}.\n${opts.usage}` };
  }
  const positional = positionals[0];
  if (positional !== undefined && flagValue !== undefined && positional !== flagValue) {
    return {
      error: `Conflicting ${opts.what}: "${positional}" and ${opts.flag} "${flagValue}". Give one.\n${opts.usage}`,
    };
  }
  return { value: positional ?? flagValue };
}
