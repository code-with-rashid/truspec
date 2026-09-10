import { asRecord, resolveRef } from "./openapi";

/** A single point where a value departs from its schema. */
export interface SchemaViolation {
  /** JSON-pointer-ish location of the offending value, e.g. "/author/id"; "" = root. */
  path: string;
  message: string;
}

/** Cyclic `$ref` guard. Concrete response values are finite, so this only backstops loops. */
const MAX_DEPTH = 100;

/**
 * Memoizes validation results across one top-level call, keyed by the *identity* of the value-node
 * and the schema-node. Without it, EVERY composition keyword re-validates the same value subtree —
 * `oneOf`/`anyOf` once per branch, `allOf` once per part, even plain `$ref` chains — so a recursive
 * (`$ref`-back) schema over a deep response becomes 2^depth work and hangs the validator. Cached
 * violations use paths *relative* to the subtree they describe, so a hit is rebased onto whatever
 * path the current caller sits at. Value-node identity is stable within a call and `$ref` always
 * resolves to the same `doc` object, so each (value, schema) pair is validated at most once.
 * (Parsed-JSON responses are trees, so a given value-node is also reached at a single depth.)
 */
type ViolationCache = WeakMap<object, Map<Record<string, unknown>, SchemaViolation[]>>;

/** JSON value kind, distinguishing null and array from the bare `typeof`. */
function jsonType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v; // object | string | number | boolean | undefined
}

/** Structural equality for `enum` membership (enum entries are usually primitives). */
function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** A schema keyword read as a finite number, or undefined when absent or not numeric. */
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * The bound/length/count keywords, which this validator used to skip entirely.
 *
 * `type`, `required` and `enum` catch a response of the wrong *shape*. These catch one of the right
 * shape carrying wrong *values* — `id: 0` against `minimum: 1`, an empty `name` against
 * `minLength: 3`, a one-element list against `minItems: 2`. Those are the everyday constraints in a
 * real OpenAPI document, and a contract check that silently passed them was over-claiming: a mock
 * generated from a spec produced a response that violated that same spec, and `truspec contract`
 * called it conforming.
 *
 * Applied to whatever the value actually is, independent of `type`: JSON Schema keywords for a
 * different type are simply inapplicable, never failures.
 */
function checkConstraints(value: unknown, schema: Record<string, unknown>, out: SchemaViolation[]): void {
  const at = (message: string): void => {
    out.push({ path: "", message });
  };

  if (typeof value === "number") {
    const min = num(schema.minimum);
    const max = num(schema.maximum);
    // OpenAPI 3.0 spells exclusivity as a boolean modifier on `minimum`/`maximum`; JSON Schema
    // 2020-12 (and OpenAPI 3.1) makes it a number of its own. Both shapes appear in the wild.
    const exclusiveMin = num(schema.exclusiveMinimum);
    const exclusiveMax = num(schema.exclusiveMaximum);
    const minIsExclusive = schema.exclusiveMinimum === true;
    const maxIsExclusive = schema.exclusiveMaximum === true;

    if (min !== undefined && (minIsExclusive ? value <= min : value < min)) {
      at(`${value} is ${minIsExclusive ? "not greater than" : "less than"} minimum ${min}`);
    }
    if (max !== undefined && (maxIsExclusive ? value >= max : value > max)) {
      at(`${value} is ${maxIsExclusive ? "not less than" : "greater than"} maximum ${max}`);
    }
    if (exclusiveMin !== undefined && value <= exclusiveMin) {
      at(`${value} is not greater than exclusiveMinimum ${exclusiveMin}`);
    }
    if (exclusiveMax !== undefined && value >= exclusiveMax) {
      at(`${value} is not less than exclusiveMaximum ${exclusiveMax}`);
    }
    const multiple = num(schema.multipleOf);
    // Guard against a zero divisor, and use a relative epsilon: 0.3 / 0.1 is 2.9999999999999996.
    if (multiple !== undefined && multiple > 0) {
      const ratio = value / multiple;
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) at(`${value} is not a multiple of ${multiple}`);
    }
  }

  if (typeof value === "string") {
    // Count code points, not UTF-16 units: JSON Schema counts characters, so an emoji is one.
    const length = [...value].length;
    const min = num(schema.minLength);
    const max = num(schema.maxLength);
    if (min !== undefined && length < min) at(`string length ${length} is less than minLength ${min}`);
    if (max !== undefined && length > max) at(`string length ${length} is greater than maxLength ${max}`);
    if (typeof schema.pattern === "string") {
      let re: RegExp | undefined;
      try {
        re = new RegExp(schema.pattern);
      } catch {
        // A pattern this engine cannot compile is the *schema's* problem, and failing every
        // response against it would blame the API for it. Reported once, as itself.
        at(`schema pattern ${JSON.stringify(schema.pattern)} is not a valid regular expression`);
      }
      if (re && !re.test(value)) at(`${JSON.stringify(value)} does not match pattern ${JSON.stringify(schema.pattern)}`);
    }
  }

  if (Array.isArray(value)) {
    const min = num(schema.minItems);
    const max = num(schema.maxItems);
    if (min !== undefined && value.length < min) at(`array has ${value.length} item(s), fewer than minItems ${min}`);
    if (max !== undefined && value.length > max) at(`array has ${value.length} item(s), more than maxItems ${max}`);
    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      for (const el of value) {
        const key = JSON.stringify(el) ?? "undefined";
        if (seen.has(key)) {
          at(`array has duplicate item ${key} but uniqueItems is true`);
          break;
        }
        seen.add(key);
      }
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const count = Object.keys(value as Record<string, unknown>).length;
    const min = num(schema.minProperties);
    const max = num(schema.maxProperties);
    if (min !== undefined && count < min) at(`object has ${count} propert(ies), fewer than minProperties ${min}`);
    if (max !== undefined && count > max) at(`object has ${count} propert(ies), more than maxProperties ${max}`);
  }
}

/** Does this schema impose any constraint a `null` value could violate? */
function constrainsNull(schema: Record<string, unknown>): boolean {
  return (
    schema.type !== undefined ||
    schema.properties !== undefined ||
    schema.enum !== undefined ||
    schema.allOf !== undefined ||
    schema.oneOf !== undefined ||
    schema.anyOf !== undefined
  );
}

/**
 * `(value, schema)` pairs currently on the validation stack. A recursive (`$ref`-cycle) schema
 * re-validated against the SAME value with no value progress — e.g. a primitive against
 * `oneOf[…, {$ref:Self}]`, or a self-referential object — would otherwise recurse 2^depth times
 * (the object-result cache can't help: it is only populated *after* a node finishes, and a
 * primitive can't even key the WeakMap). Re-entering a pair already in `visiting` means a pure
 * schema cycle; we treat that subtree as satisfied (no violations) to break it. Keyed schema→values
 * so it works for primitives (value equality) and objects (identity) alike. Real recursive schemas
 * over finite, tree-shaped JSON descend into *different* value nodes, so they never self-collide.
 */
type Visiting = Map<Record<string, unknown>, Set<unknown>>;

/**
 * Validate `value` against `schema`, returning violations whose paths are *relative* to this
 * subtree's root (`""` = the value itself). Memoized by (value-node, schema-node) identity so each
 * pair is computed once — this is what keeps recursive `$ref` schemas linear instead of 2^depth.
 */
function collect(
  value: unknown,
  schema: Record<string, unknown>,
  doc: Record<string, unknown>,
  depth: number,
  cache: ViolationCache,
  visiting: Visiting,
): SchemaViolation[] {
  // Only object-valued nodes can key a WeakMap; caching them collapses non-cyclic DAG re-validation.
  const memoKey = value !== null && typeof value === "object" ? (value as object) : undefined;
  if (memoKey) {
    const hit = cache.get(memoKey)?.get(schema);
    if (hit !== undefined) return hit;
  }
  // Cycle break: this exact (value, schema) is already being validated higher on the stack.
  let onStack = visiting.get(schema);
  if (onStack?.has(value)) return [];
  if (!onStack) visiting.set(schema, (onStack = new Set()));
  onStack.add(value);

  const out: SchemaViolation[] = [];
  validateInto(value, schema, doc, out, depth, cache, visiting);

  onStack.delete(value);
  if (memoKey) {
    let bySchema = cache.get(memoKey);
    if (!bySchema) cache.set(memoKey, (bySchema = new Map()));
    bySchema.set(schema, out);
  }
  return out;
}

/** Append child violations under `prefix` (e.g. `/id`, `/0`) onto `out`. */
function rebase(prefix: string, child: SchemaViolation[], out: SchemaViolation[]): void {
  for (const v of child) out.push({ path: prefix + v.path, message: v.message });
}

/** True when `value` conforms to `schema` with no violations (used for oneOf/anyOf branches). */
function conforms(
  value: unknown,
  schema: Record<string, unknown>,
  doc: Record<string, unknown>,
  depth: number,
  cache: ViolationCache,
  visiting: Visiting,
): boolean {
  return collect(value, schema, doc, depth, cache, visiting).length === 0;
}

/** Validate into `out` using paths relative to this node; recurse only via `collect` (memoized). */
function validateInto(
  value: unknown,
  schema: Record<string, unknown>,
  doc: Record<string, unknown>,
  out: SchemaViolation[],
  depth: number,
  cache: ViolationCache,
  visiting: Visiting,
): void {
  if (depth > MAX_DEPTH) return;

  // $ref — resolve and recurse (same value, same position).
  if (typeof schema.$ref === "string") {
    const resolved = resolveRef(schema.$ref, doc);
    if (!resolved) out.push({ path: "", message: `unresolved $ref ${schema.$ref}` });
    else rebase("", collect(value, resolved, doc, depth + 1, cache, visiting), out);
    return;
  }

  // null — allowed only when the schema opts in (OpenAPI 3.0 `nullable`, `type: null` or a `type`
  // array containing `"null"` per OpenAPI 3.1 / JSON Schema, or no constraint at all). Short-circuits
  // before type checks.
  if (value === null) {
    const declared = Array.isArray(schema.type)
      ? schema.type
      : typeof schema.type === "string"
        ? [schema.type]
        : [];
    if (schema.nullable === true || declared.includes("null") || !constrainsNull(schema)) return;
    out.push({ path: "", message: "value is null but schema is not nullable" });
    return;
  }

  // Before any of the type dispatches below, all of which `return`: in JSON Schema every keyword
  // present is an independent constraint, so `minimum` must be checked whether or not the schema
  // also says `type: integer`, and `minItems` whether or not it says `type: array`.
  checkConstraints(value, schema, out);

  // enum — value must be one of the listed values.
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((e) => sameValue(e, value))) {
      out.push({ path: "", message: `value ${JSON.stringify(value)} is not one of the allowed enum values` });
    }
    return;
  }

  // Composition keywords are CONJUNCTIVE with each other and with sibling constraints
  // (`type`/`properties`/`required`/`items`): in JSON Schema every keyword present in a schema
  // object is an independent constraint the value must satisfy. So these do NOT short-circuit —
  // they accumulate violations and fall through to the sibling type-dispatch below. (Returning
  // early here silently dropped sibling checks: `allOf: [{$ref: Base}]` next to an own
  // `required`/`properties` — the most common OpenAPI composition shape — passed any response.)
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      const p = asRecord(part);
      if (p) rebase("", collect(value, p, doc, depth + 1, cache, visiting), out);
    }
  }
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map(asRecord).filter((b): b is Record<string, unknown> => b !== undefined);
    if (branches.length > 0 && !branches.some((b) => conforms(value, b, doc, depth + 1, cache, visiting))) {
      out.push({ path: "", message: "value does not match any anyOf subschema" });
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf.map(asRecord).filter((b): b is Record<string, unknown> => b !== undefined);
    if (branches.length > 0) {
      const matched = branches.filter((b) => conforms(value, b, doc, depth + 1, cache, visiting)).length;
      if (matched !== 1) {
        out.push({ path: "", message: `value matches ${matched} oneOf subschemas (expected exactly 1)` });
      }
    }
  }

  // Array `type` (OpenAPI 3.1 / JSON Schema, e.g. `type: ["string", "null"]`): the non-null value
  // must satisfy at least one listed type. Treated as an implicit union over the sibling keywords so
  // `properties`/`items`/etc. still apply to whichever type matches. Without this the validator
  // silently accepted ANY value for an array `type` — a false negative that defeats contract checks.
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((t): t is string => typeof t === "string" && t !== "null");
    if (types.length > 0 && !types.some((t) => conforms(value, { ...schema, type: t }, doc, depth + 1, cache, visiting))) {
      out.push({ path: "", message: `expected one of type [${schema.type.join(", ")}], got ${jsonType(value)}` });
    }
    return;
  }

  const type = typeof schema.type === "string" ? schema.type : undefined;
  const actual = jsonType(value);

  // Object (explicit `type: object`, or implied by `properties`).
  if (type === "object" || (type === undefined && schema.properties !== undefined)) {
    if (actual !== "object") {
      out.push({ path: "", message: `expected object, got ${actual}` });
      return;
    }
    const obj = value as Record<string, unknown>;
    const props = asRecord(schema.properties) ?? {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !(key in obj)) {
          out.push({ path: `/${key}`, message: `missing required property '${key}'` });
        }
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) {
        const subSchema = asRecord(sub);
        if (subSchema) rebase(`/${key}`, collect(obj[key], subSchema, doc, depth + 1, cache, visiting), out);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) {
          out.push({ path: `/${key}`, message: `unexpected property '${key}' (additionalProperties is false)` });
        }
      }
    }
    return;
  }

  // Array.
  if (type === "array") {
    if (actual !== "array") {
      out.push({ path: "", message: `expected array, got ${actual}` });
      return;
    }
    const items = asRecord(schema.items);
    if (items) {
      (value as unknown[]).forEach((el, i) => rebase(`/${i}`, collect(el, items, doc, depth + 1, cache, visiting), out));
    }
    return;
  }

  // Primitives.
  if (type === "string" && actual !== "string") {
    out.push({ path: "", message: `expected string, got ${actual}` });
  } else if (type === "integer" && (actual !== "number" || !Number.isInteger(value))) {
    out.push({ path: "", message: `expected integer, got ${actual === "number" ? "non-integer number" : actual}` });
  } else if (type === "number" && actual !== "number") {
    out.push({ path: "", message: `expected number, got ${actual}` });
  } else if (type === "boolean" && actual !== "boolean") {
    out.push({ path: "", message: `expected boolean, got ${actual}` });
  } else if (type === "null") {
    out.push({ path: "", message: `expected null, got ${actual}` });
  }
  // type === undefined with no other constraint → accept any non-null value.
}

/**
 * Validate a value against an OpenAPI 3 schema subset (`type`, `properties`, `required`,
 * `items`, `enum`, `nullable`, `allOf`/`oneOf`/`anyOf`, `$ref`, `additionalProperties:false`, and
 * the bound/length/count keywords: `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`/
 * `multipleOf`, `minLength`/`maxLength`/`pattern`, `minItems`/`maxItems`/`uniqueItems`,
 * `minProperties`/`maxProperties`).
 * Returns every violation; an empty array means the value conforms. `format` is treated as an
 * annotation (not validated), matching JSON Schema's default.
 */
export function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  doc: Record<string, unknown>,
): SchemaViolation[] {
  // Top-level relative paths ARE absolute (root prefix is ""). Fresh cache + visiting per call keep
  // the (value, schema) memo and cycle guard bounded to this validation (no cross-call leakage).
  return collect(value, schema, doc, 0, new WeakMap(), new Map());
}
