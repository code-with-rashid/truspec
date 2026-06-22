import { asRecord, resolveRef } from "./openapi";

/** A single point where a value departs from its schema. */
export interface SchemaViolation {
  /** JSON-pointer-ish location of the offending value, e.g. "/author/id"; "" = root. */
  path: string;
  message: string;
}

/** Cyclic `$ref` guard. Concrete response values are finite, so this only backstops loops. */
const MAX_DEPTH = 100;

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

/** True when `value` conforms to `schema` with no violations (used for oneOf/anyOf branches). */
function conforms(value: unknown, schema: Record<string, unknown>, doc: Record<string, unknown>, depth: number): boolean {
  const local: SchemaViolation[] = [];
  validate(value, schema, doc, "", local, depth);
  return local.length === 0;
}

function validate(
  value: unknown,
  schema: Record<string, unknown>,
  doc: Record<string, unknown>,
  path: string,
  out: SchemaViolation[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;

  // $ref — resolve and recurse.
  if (typeof schema.$ref === "string") {
    const resolved = resolveRef(schema.$ref, doc);
    if (!resolved) out.push({ path, message: `unresolved $ref ${schema.$ref}` });
    else validate(value, resolved, doc, path, out, depth + 1);
    return;
  }

  // null — allowed only when the schema opts in (OpenAPI 3.0 `nullable`, `type: null`,
  // or no constraint at all). Short-circuits before type checks.
  if (value === null) {
    if (schema.nullable === true || schema.type === "null" || !constrainsNull(schema)) return;
    out.push({ path, message: "value is null but schema is not nullable" });
    return;
  }

  // enum — value must be one of the listed values.
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((e) => sameValue(e, value))) {
      out.push({ path, message: `value ${JSON.stringify(value)} is not one of the allowed enum values` });
    }
    return;
  }

  // Composition keywords.
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      const p = asRecord(part);
      if (p) validate(value, p, doc, path, out, depth + 1);
    }
    return;
  }
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map(asRecord).filter((b): b is Record<string, unknown> => b !== undefined);
    if (branches.length > 0 && !branches.some((b) => conforms(value, b, doc, depth + 1))) {
      out.push({ path, message: "value does not match any anyOf subschema" });
    }
    return;
  }
  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf.map(asRecord).filter((b): b is Record<string, unknown> => b !== undefined);
    if (branches.length > 0) {
      const matched = branches.filter((b) => conforms(value, b, doc, depth + 1)).length;
      if (matched !== 1) {
        out.push({ path, message: `value matches ${matched} oneOf subschemas (expected exactly 1)` });
      }
    }
    return;
  }

  const type = typeof schema.type === "string" ? schema.type : undefined;
  const actual = jsonType(value);

  // Object (explicit `type: object`, or implied by `properties`).
  if (type === "object" || (type === undefined && schema.properties !== undefined)) {
    if (actual !== "object") {
      out.push({ path, message: `expected object, got ${actual}` });
      return;
    }
    const obj = value as Record<string, unknown>;
    const props = asRecord(schema.properties) ?? {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !(key in obj)) {
          out.push({ path: `${path}/${key}`, message: `missing required property '${key}'` });
        }
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) {
        const subSchema = asRecord(sub);
        if (subSchema) validate(obj[key], subSchema, doc, `${path}/${key}`, out, depth + 1);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) {
          out.push({ path: `${path}/${key}`, message: `unexpected property '${key}' (additionalProperties is false)` });
        }
      }
    }
    return;
  }

  // Array.
  if (type === "array") {
    if (actual !== "array") {
      out.push({ path, message: `expected array, got ${actual}` });
      return;
    }
    const items = asRecord(schema.items);
    if (items) {
      (value as unknown[]).forEach((el, i) => validate(el, items, doc, `${path}/${i}`, out, depth + 1));
    }
    return;
  }

  // Primitives.
  if (type === "string" && actual !== "string") {
    out.push({ path, message: `expected string, got ${actual}` });
  } else if (type === "integer" && (actual !== "number" || !Number.isInteger(value))) {
    out.push({ path, message: `expected integer, got ${actual === "number" ? "non-integer number" : actual}` });
  } else if (type === "number" && actual !== "number") {
    out.push({ path, message: `expected number, got ${actual}` });
  } else if (type === "boolean" && actual !== "boolean") {
    out.push({ path, message: `expected boolean, got ${actual}` });
  } else if (type === "null") {
    out.push({ path, message: `expected null, got ${actual}` });
  }
  // type === undefined with no other constraint → accept any non-null value.
}

/**
 * Validate a value against an OpenAPI 3 schema subset (`type`, `properties`, `required`,
 * `items`, `enum`, `nullable`, `allOf`/`oneOf`/`anyOf`, `$ref`, `additionalProperties:false`).
 * Returns every violation; an empty array means the value conforms. `format` is treated as an
 * annotation (not validated), matching JSON Schema's default.
 */
export function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  doc: Record<string, unknown>,
): SchemaViolation[] {
  const out: SchemaViolation[] = [];
  validate(value, schema, doc, "", out, 0);
  return out;
}
