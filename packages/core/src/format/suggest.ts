import { z } from "zod";

/**
 * Suggest the key a typo was probably meant to be.
 *
 * `.strict()` exists to catch `headrs:` before it silently does nothing at run time — but stopping
 * at "Unrecognized key(s) in object: 'headrs'" leaves the reader to spot a one-character
 * difference themselves. The schema knows the answer; this asks it.
 *
 * Candidates come from the schema *at that path*, not from a flat list of every key in the format:
 * `name` is a valid key on a `header` assertion and meaningless on a `jsonpath` one, and a
 * suggestion that doesn't parse is worse than none.
 */

/** Distance beyond which two identifiers are different words, not a typo. */
const MAX_DISTANCE = 3;

/**
 * Optimal string alignment distance (Damerau-Levenshtein restricted to adjacent transpositions).
 *
 * Plain Levenshtein charges 2 for a swap, which makes `alpah` twice as far from `alpha` as
 * `alphaa` is — and a swap is the single most common way to mistype a word you know. Counting it
 * as one edit is what lets the threshold stay tight enough to refuse unrelated keys.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // Three rows: the transposition case needs the row before last.
  let twoBack: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, twoBack[j - 2]! + 1);
      }
      row[j] = best;
    }
    twoBack = prev;
    prev = row;
  }
  return prev[b.length]!;
}

/** Peel the wrappers (`.optional()`, `.default()`, `.catch()`, …) off a schema. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s = schema;
  for (let i = 0; i < 10; i++) {
    if (s instanceof z.ZodOptional || s instanceof z.ZodNullable || s instanceof z.ZodDefault) {
      s = (s._def as { innerType: z.ZodTypeAny }).innerType;
    } else if (s instanceof z.ZodEffects) {
      s = s.innerType();
    } else if (s instanceof z.ZodLazy) {
      s = (s._def as { getter: () => z.ZodTypeAny }).getter();
    } else {
      return s;
    }
  }
  return s;
}

/**
 * Walk a schema down a path of object keys / array indices, following the value in parallel so a
 * discriminated union can be narrowed to the branch that actually applies.
 */
function schemaAt(root: z.ZodTypeAny, path: Array<string | number>, value: unknown): z.ZodTypeAny | undefined {
  let schema: z.ZodTypeAny | undefined = root;
  let current: unknown = value;
  for (const segment of path) {
    if (!schema) return undefined;
    schema = resolveUnion(unwrap(schema), current);
    if (typeof segment === "number") {
      if (!(schema instanceof z.ZodArray)) return undefined;
      schema = (schema._def as { type: z.ZodTypeAny }).type;
      current = Array.isArray(current) ? current[segment] : undefined;
    } else if (schema instanceof z.ZodObject) {
      schema = (schema.shape as Record<string, z.ZodTypeAny>)[segment];
      current = isRecord(current) ? current[segment] : undefined;
    } else if (schema instanceof z.ZodRecord) {
      schema = (schema._def as { valueType: z.ZodTypeAny }).valueType;
      current = isRecord(current) ? current[segment] : undefined;
    } else {
      return undefined;
    }
  }
  return schema ? resolveUnion(unwrap(schema), current) : undefined;
}

/** Pick the union branch this value belongs to, by discriminator where there is one. */
function resolveUnion(schema: z.ZodTypeAny, value: unknown): z.ZodTypeAny {
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const def = schema._def as { discriminator: string; options: z.ZodTypeAny[] };
    const tag = isRecord(value) ? value[def.discriminator] : undefined;
    for (const option of def.options) {
      const shape = (unwrap(option) as z.ZodObject<z.ZodRawShape>).shape;
      const literal = unwrap(shape[def.discriminator] as z.ZodTypeAny);
      if (literal instanceof z.ZodLiteral && (literal._def as { value: unknown }).value === tag) {
        return unwrap(option);
      }
    }
    return schema;
  }
  return schema;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Every key accepted at this point in the schema, across union branches when it can't be narrowed. */
function keysAt(root: z.ZodTypeAny, path: Array<string | number>, value: unknown): string[] {
  const schema = schemaAt(root, path, value);
  if (!schema) return [];
  if (schema instanceof z.ZodObject) return Object.keys(schema.shape as Record<string, unknown>);
  if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion) {
    const options = (schema._def as { options: z.ZodTypeAny[] }).options;
    const out = new Set<string>();
    for (const option of options) {
      const o = unwrap(option);
      if (o instanceof z.ZodObject) for (const k of Object.keys(o.shape as Record<string, unknown>)) out.add(k);
    }
    return [...out];
  }
  return [];
}

/**
 * The most likely intended key, or `undefined` when nothing is close enough to be worth saying.
 *
 * The threshold scales with the word's length so `id` doesn't match `in`, while `assertoins` still
 * finds `assertions`.
 */
export function suggestKey(
  root: z.ZodTypeAny,
  path: Array<string | number>,
  unknown: string,
  value: unknown,
): string | undefined {
  const candidates = keysAt(root, path, value);
  if (candidates.length === 0) return undefined;
  const limit = Math.min(MAX_DISTANCE, Math.max(1, Math.floor(unknown.length / 3)));
  let best: { key: string; distance: number } | undefined;
  for (const key of candidates) {
    const lower = editDistance(unknown.toLowerCase(), key.toLowerCase());
    // A different case alone (`Method:`) is a typo worth catching, and scores 0 here.
    const distance = lower === 0 && key !== unknown ? 1 : lower;
    if (distance > limit) continue;
    if (!best || distance < best.distance || (distance === best.distance && key < best.key)) {
      best = { key, distance };
    }
  }
  return best?.key;
}
