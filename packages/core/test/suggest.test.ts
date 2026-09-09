import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { z } from "zod";
import { editDistance, suggestKey } from "../src/format/suggest";

const base = 'tspec: "0.1"\nname: X\nmethod: GET\nurl: "http://x/y"\n';

/** The message a mistyped file produces. */
function messageFor(yaml: string): string {
  const r = parse.request.safeParse(yaml);
  expect(r.ok).toBe(false);
  return r.error ?? "";
}

describe("did-you-mean suggestions for a mistyped key", () => {
  it("names the key a top-level typo was one edit away from", () => {
    // The whole point of `.strict()`: `headrs:` silently does nothing at run time.
    expect(messageFor(`${base}headrs: { Accept: application/json }\n`)).toContain("did you mean 'headers'?");
    expect(messageFor(`${base}quer: { a: b }\n`)).toContain("did you mean 'query'?");
    expect(messageFor(`${base}assertoins: []\n`)).toContain("did you mean 'assertions'?");
  });

  it("catches a key that is right except for its case", () => {
    expect(messageFor(`${base}Method: GET\n`)).toContain("did you mean 'method'?");
  });

  it("suggests from the branch of the union that actually applies, not from every branch", () => {
    // `equals` exists on the jsonpath assertion; the suggestion has to parse if you take it.
    const jsonpath = messageFor(`${base}assertions: [ { type: jsonpath, path: "$.id", equal: 1 } ]\n`);
    expect(jsonpath).toContain("did you mean 'equals'?");

    // `ltMs` belongs to `duration` only. Offered against a `status` assertion it would be advice
    // that does not parse, so it must not be offered at all.
    const status = messageFor(`${base}assertions: [ { type: status, ltMss: 5 } ]\n`);
    expect(status).not.toContain("did you mean");
  });

  it("says nothing when the key is not close to anything", () => {
    const m = messageFor(`${base}completelyUnrelated: 1\n`);
    expect(m).toContain("completelyUnrelated");
    expect(m).not.toContain("did you mean");
  });

  it("maps each key when several are wrong at once", () => {
    const m = messageFor(`${base}headrs: { a: b }\nquer: { c: d }\n`);
    expect(m).toContain("'headrs' → 'headers'");
    expect(m).toContain("'quer' → 'query'");
  });

  it("works inside a nested object, not just at the root", () => {
    expect(messageFor(`${base}auth: { type: bearer, tokn: "t" }\n`)).toContain("did you mean 'token'?");
    expect(messageFor(`${base}body: { type: json, contnt: {} }\n`)).toContain("did you mean 'content'?");
  });

  it("suggests for folder configs and environments too", () => {
    const folder = parse.folderConfig.safeParse('tspec: "0.1"\nbaseUrl: "http://x"\nheadrs: { a: b }\n');
    expect(folder.error).toContain("did you mean 'headers'?");
    const env = parse.environment.safeParse('tspec: "0.1"\nname: local\nvariable: { a: b }\n');
    expect(env.error).toContain("did you mean 'variables'?");
  });

  it("never offers a suggestion that would not itself parse", () => {
    // The invariant that makes the feature safe to follow blindly: take the advice, get a file.
    const typos: Array<[string, string]> = [
      [`${base}headrs: { Accept: application/json }\n`, "headers"],
      [`${base}auth: { type: bearer, tokn: "t" }\n`, "token"],
      [`${base}assertions: [ { type: jsonpath, path: "$.id", equal: 1 } ]\n`, "equals"],
      [`${base}auth: { type: apikey, name: K, value: v, id: header }\n`, "in"],
    ];
    for (const [yaml, expected] of typos) {
      const message = messageFor(yaml);
      expect(message, yaml).toContain(`did you mean '${expected}'?`);
      // Applying the suggestion is the fix, not just a nicer error.
      const fixed = yaml.replace(new RegExp(`\\b${message.match(/'([^']+)'/)![1]}:`), `${expected}:`);
      expect(() => parse.request.parse(fixed), fixed).not.toThrow();
    }
  });
});

describe("editDistance", () => {
  it("counts insert, delete and substitute alike", () => {
    expect(editDistance("headers", "headers")).toBe(0);
    expect(editDistance("headrs", "headers")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });

  it("counts a swap as one edit, because that is what a swap is", () => {
    // Plain Levenshtein says 2, which would push every transposed key past the threshold.
    expect(editDistance("alpah", "alpha")).toBe(1);
    expect(editDistance("qeury", "query")).toBe(1);
    expect(editDistance("ab", "ba")).toBe(1);
  });
});

describe("suggestKey against schema shapes the format doesn't use yet", () => {
  // The walker is generic; these cover the wrappers and containers a future schema change would
  // introduce, so adding one doesn't silently turn suggestions off.
  const inner = z.object({ alpha: z.string(), beta: z.string() }).strict();

  it("sees through optional, nullable, default, effects and lazy wrappers", () => {
    const schema = z
      .object({
        a: inner.optional(),
        b: inner.nullable(),
        c: inner.default({ alpha: "x", beta: "y" }),
        d: z.preprocess((v) => v, inner),
        e: z.lazy(() => inner),
      })
      .strict();
    for (const key of ["a", "b", "c", "d", "e"]) {
      expect(suggestKey(schema, [key], "alpah", { [key]: { alpah: 1 } }), key).toBe("alpha");
    }
  });

  it("walks into arrays and records", () => {
    const arr = z.object({ items: z.array(inner) }).strict();
    expect(suggestKey(arr, ["items", 0], "alpah", { items: [{ alpah: 1 }] })).toBe("alpha");
    const rec = z.object({ map: z.record(inner) }).strict();
    expect(suggestKey(rec, ["map", "k"], "alpah", { map: { k: { alpah: 1 } } })).toBe("alpha");
  });

  it("offers the keys of every branch of a plain (undiscriminated) union", () => {
    const schema = z
      .object({ u: z.union([inner, z.object({ gamma: z.string() }).strict()]) })
      .strict();
    expect(suggestKey(schema, ["u"], "gama", { u: { gama: 1 } })).toBe("gamma");
  });

  it("falls back to every branch when a discriminator names no known branch", () => {
    const schema = z
      .object({
        d: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("one"), alpha: z.string() }).strict(),
          z.object({ kind: z.literal("two"), beta: z.string() }).strict(),
        ]),
      })
      .strict();
    expect(suggestKey(schema, ["d"], "alpah", { d: { kind: "nonsense", alpah: 1 } })).toBe("alpha");
  });

  it("returns nothing rather than guessing when the path leads somewhere with no keys", () => {
    const schema = z.object({ s: z.string() }).strict();
    expect(suggestKey(schema, ["s"], "anything", { s: "x" })).toBeUndefined();
    expect(suggestKey(schema, ["missing", "deeper"], "anything", {})).toBeUndefined();
    // An index into something that is not an array.
    expect(suggestKey(schema, ["s", 0], "anything", { s: "x" })).toBeUndefined();
  });
});
