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
