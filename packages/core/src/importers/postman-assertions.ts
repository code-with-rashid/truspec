import type { TruSpecAssertion } from "../format/types";

/**
 * Recover declarative assertions from a Postman `test` script.
 *
 * Importing a real Postman collection used to produce requests with no assertions at all: every
 * `pm.test` became a commented-out `script.post`, so the imported collection ran without checking
 * anything and reported 0% coverage. Most Postman tests in the wild are a handful of idioms, and
 * those convert exactly.
 *
 * This recognises a deliberate subset. Anything it does not understand is left in the ported
 * comment for a human, because a guessed assertion is worse than an honest gap.
 */

/** Parse a JS literal argument (string, number, boolean, array) into a value. */
function literal(raw: string): unknown {
  const text = raw.trim();
  try {
    // Single-quoted strings are valid JS and invalid JSON; normalise the simple case.
    const jsonish = /^'([^'\\]*)'$/.test(text) ? `"${text.slice(1, -1)}"` : text;
    return JSON.parse(jsonish);
  } catch {
    return undefined;
  }
}

function str(raw: string): string | undefined {
  const v = literal(raw);
  return typeof v === "string" ? v : undefined;
}

function num(raw: string): number | undefined {
  const v = literal(raw);
  return typeof v === "number" ? v : undefined;
}

function numList(raw: string): number[] | undefined {
  const v = literal(`[${raw}]`);
  return Array.isArray(v) && v.every((n) => typeof n === "number") ? (v as number[]) : undefined;
}

/** A JS accessor chain (`a.b[0]`) or an `_.get` path, as a TruSpec `$.`-rooted jsonpath. */
function toJsonPath(chain: string): string {
  const cleaned = chain.trim().replace(/^\./, "");
  return cleaned === "" ? "$" : `$.${cleaned}`.replace(/\.\[/g, "[");
}

const QUOTED = `(?:"([^"\\\\]*)"|'([^'\\\\]*)')`;
const q = (m: RegExpMatchArray, i: number): string => m[i] ?? m[i + 1] ?? "";

/** The response-value expressions these tests are written against. */
const JSON_ROOT = "(?:json|jsonData|data|body|responseJson)";

interface Rule {
  re: RegExp;
  build: (m: RegExpMatchArray) => TruSpecAssertion | undefined;
}

const RULES: Rule[] = [
  // ---- status ----
  { re: /pm\.response\.to\.have\.status\(\s*(\d+)\s*\)/, build: (m) => ({ type: "status", equals: Number(m[1]) }) },
  {
    re: /pm\.expect\(\s*pm\.response\.code\s*\)\.to\.(?:be\.)?(?:eql|equal)\(\s*(\d+)\s*\)/,
    build: (m) => ({ type: "status", equals: Number(m[1]) }),
  },
  {
    re: /pm\.expect\(\s*pm\.response\.code\s*\)\.to\.be\.oneOf\(\s*\[([^\]]*)\]\s*\)/,
    build: (m) => {
      const list = numList(m[1] ?? "");
      return list ? { type: "status", in: list } : undefined;
    },
  },
  {
    // The form this project's own exporter emits.
    re: /pm\.expect\(\s*\[([^\]]*)\]\s*\)\.to\.include\(\s*pm\.response\.code\s*\)/,
    build: (m) => {
      const list = numList(m[1] ?? "");
      return list ? { type: "status", in: list } : undefined;
    },
  },
  {
    re: /pm\.expect\(\s*pm\.response\.code\s*\)\.to\.be\.below\(\s*(\d+)\s*\)/,
    build: (m) => ({ type: "status", lt: Number(m[1]) }),
  },
  {
    re: /pm\.expect\(\s*pm\.response\.code\s*\)\.to\.be\.at\.least\(\s*(\d+)\s*\)/,
    build: (m) => ({ type: "status", gte: Number(m[1]) }),
  },

  // ---- duration ----
  {
    re: /pm\.expect\(\s*pm\.response\.responseTime\s*\)\.to\.be\.below\(\s*(\d+)\s*\)/,
    build: (m) => ({ type: "duration", ltMs: Number(m[1]) }),
  },

  // ---- headers ----
  {
    re: new RegExp(`pm\\.response\\.to\\.have\\.header\\(\\s*${QUOTED}\\s*\\)`),
    build: (m) => ({ type: "header", name: q(m, 1), exists: true }),
  },
  {
    re: new RegExp(
      `pm\\.expect\\(\\s*pm\\.response\\.headers\\.get\\(\\s*${QUOTED}\\s*\\)\\s*\\)\\.to\\.(not\\.)?(eql|equal|include)\\(\\s*(${QUOTED})\\s*\\)`,
    ),
    build: (m) => {
      const name = q(m, 1);
      const negated = Boolean(m[3]);
      const op = m[4];
      const value = str(m[5] ?? "");
      if (value === undefined) return undefined;
      if (op === "include") return negated ? undefined : { type: "header", name, contains: value };
      return negated ? { type: "header", name, notEquals: value } : { type: "header", name, equals: value };
    },
  },

  // ---- body ----
  {
    re: new RegExp(
      `pm\\.expect\\(\\s*pm\\.response\\.text\\(\\)\\s*\\)\\.to\\.(not\\.)?(eql|equal|include)\\(\\s*(${QUOTED})\\s*\\)`,
    ),
    build: (m) => {
      const negated = Boolean(m[1]);
      const op = m[2];
      const value = str(m[3] ?? "");
      if (value === undefined) return undefined;
      if (op === "include") return { type: "body", ...(negated ? { notContains: value } : { contains: value }) };
      return negated ? undefined : { type: "body", equals: value };
    },
  },

  // ---- jsonpath, via `_.get(json, "a.b")` or a plain `json.a.b` chain ----
  {
    re: new RegExp(
      `pm\\.expect\\(\\s*(?:_\\.get\\(\\s*${JSON_ROOT}\\s*,\\s*${QUOTED}\\s*\\)|${JSON_ROOT}((?:\\.[A-Za-z_$][\\w$]*|\\[\\d+\\])+))\\s*\\)\\.to\\.(not\\.)?(?:be\\.)?(eql|equal|include|exist)\\b(?:\\(\\s*([^)]*?)\\s*\\))?`,
    ),
    build: (m) => {
      const path = toJsonPath(m[1] ?? m[2] ?? m[3] ?? "");
      const negated = Boolean(m[4]);
      const op = m[5];
      if (op === "exist") return { type: "jsonpath", path, exists: !negated };
      const value = literal(m[6] ?? "");
      if (value === undefined) return undefined;
      if (op === "include") return negated ? undefined : { type: "jsonpath", path, contains: value };
      return negated ? { type: "jsonpath", path, notEquals: value } : { type: "jsonpath", path, equals: value };
    },
  },
  {
    // `pm.expect(_.get(json, "id")).to.not.be.oneOf([null, undefined])` — the exporter's "exists".
    re: new RegExp(
      `pm\\.expect\\(\\s*(?:_\\.get\\(\\s*${JSON_ROOT}\\s*,\\s*${QUOTED}\\s*\\)|${JSON_ROOT}((?:\\.[A-Za-z_$][\\w$]*|\\[\\d+\\])*))\\s*\\)\\.to\\.(not\\.)?be\\.oneOf\\(\\s*\\[\\s*null\\s*,\\s*undefined\\s*\\]\\s*\\)`,
    ),
    build: (m) => ({ type: "jsonpath", path: toJsonPath(m[1] ?? m[2] ?? m[3] ?? ""), exists: Boolean(m[4]) }),
  },
];

/** A capture source, in the shape `capture:` accepts. */
type CaptureSource = string | { header: string } | { status: true };

/**
 * The `pm.*.set(name, value)` calls a Postman test script uses to chain requests.
 *
 * This is how every Postman collection passes a token from a login to the calls that follow, and
 * it was imported as a commented-out script — so the login ran, nothing was saved, and every
 * request after it interpolated a variable that did not exist. TruSpec has `capture:` for exactly
 * this, and the common forms convert mechanically.
 */
const SET_RE = new RegExp(
  `pm\\.(?:environment|collectionVariables|globals|variables)\\.set\\(\\s*${QUOTED}\\s*,\\s*([^;]+?)\\s*\\)\\s*;?\\s*$`,
);

/** Turn the right-hand side of a `set(...)` into a capture source, or `undefined` if it is code. */
function captureSourceOf(expr: string, jsonVars: ReadonlySet<string>): CaptureSource | undefined {
  const text = expr.trim();
  const header = new RegExp(`^pm\\.response\\.headers\\.get\\(\\s*${QUOTED}\\s*\\)$`).exec(text);
  if (header) return { header: header[1] ?? header[2] ?? "" };
  if (text === "pm.response.code" || text === "pm.response.status") return { status: true };

  const lodash = new RegExp(`^_\\.get\\(\\s*(\\w+)\\s*,\\s*${QUOTED}\\s*\\)$`).exec(text);
  if (lodash && (jsonVars.has(lodash[1] ?? "") || lodash[1] === "pm")) {
    return toJsonPath(lodash[2] ?? lodash[3] ?? "");
  }

  // `jsonData.access_token`, `pm.response.json().user.id`, `json["a"].b`
  const chain = /^(?:(\w+)|pm\.response\.json\(\))((?:\.[A-Za-z_$][\w$]*|\[\d+\]|\["[^"]+"\])*)$/.exec(text);
  if (!chain) return undefined;
  const root = chain[1];
  if (root !== undefined && !jsonVars.has(root)) return undefined;
  return toJsonPath((chain[2] ?? "").replace(/\["([^"]+)"\]/g, ".$1"));
}

/** Names bound to `pm.response.json()` in this script, so `jsonData.x` can be read as a path. */
function jsonVariables(script: string): Set<string> {
  const names = new Set<string>();
  for (const m of script.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*pm\.response\.json\(\)/g)) {
    if (m[1]) names.add(m[1]);
  }
  // The conventional names, so a script that uses one without declaring it still reads.
  for (const n of ["json", "jsonData", "data", "body", "responseJson"]) names.add(n);
  return names;
}

/** Lines that carry no assertion and whose absence means nothing was lost. */
function isStructural(line: string): boolean {
  const t = line.trim();
  return (
    t === "" ||
    t.startsWith("//") ||
    /^\}?\s*\)?\s*;?$/.test(t) ||
    /^pm\.test\s*\(/.test(t) ||
    /^const\s+\w+\s*=\s*pm\.response\.json\(\)\s*;?$/.test(t) ||
    /^(?:var|let)\s+\w+\s*=\s*pm\.response\.json\(\)\s*;?$/.test(t)
  );
}

export interface RecoveredAssertions {
  assertions: TruSpecAssertion[];
  /** `capture:` entries recovered from `pm.environment.set(...)` and friends. */
  capture: Record<string, CaptureSource>;
  /** True when every non-structural line was understood, so keeping the script adds nothing. */
  complete: boolean;
}

/** Extract the assertions a Postman test script expresses, and say whether anything was left over. */
export function assertionsFromPostmanTest(script: string): RecoveredAssertions {
  const assertions: TruSpecAssertion[] = [];
  const capture: Record<string, CaptureSource> = {};
  const jsonVars = jsonVariables(script);
  let leftover = false;

  for (const rawLine of script.split("\n")) {
    // Unwrap before the structural check: a one-line `pm.test("name", function () { … });` is as
    // common as the block form, and `isStructural` skipped the whole line as a `pm.test(` opener,
    // taking the assertion inside it with it.
    const line = unwrapOneLineTest(rawLine);
    if (line === "" || isStructural(line)) continue;

    const set = line.match(SET_RE);
    if (set) {
      const source = captureSourceOf(set[3] ?? "", jsonVars);
      const name = set[1] ?? set[2] ?? "";
      if (source !== undefined && name) capture[name] = source;
      else leftover = true;
      continue;
    }

    let matched = false;
    for (const rule of RULES) {
      const m = line.match(rule.re);
      if (!m) continue;
      const built = rule.build(m);
      if (built) {
        assertions.push(built);
        matched = true;
      }
      break;
    }
    if (!matched) leftover = true;
  }
  const recovered = assertions.length > 0 || Object.keys(capture).length > 0;
  return { assertions, capture, complete: recovered && !leftover };
}

/**
 * The inside of a single-line `pm.test("…", function () { … });`, or the line unchanged.
 *
 * Returns `""` for a wrapper with nothing but structure inside it, which is not a loss.
 */
function unwrapOneLineTest(line: string): string {
  const m = /^\s*pm\.test\s*\(.*?(?:function\s*\([^)]*\)|\([^)]*\)\s*=>)\s*\{(.*)\}\s*\)\s*;?\s*$/.exec(line);
  if (!m) return line;
  return (m[1] ?? "").trim();
}
