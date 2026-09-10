import type { TruSpecAssertion, TruSpecRequest } from "../format/types";

/** A JSONPath simple enough to express with lodash `_.get`, which is what Postman ships. */
const SIMPLE_JSONPATH = /^\$(\.[A-Za-z_$][\w$]*|\[\d+\]|\["[^"\\]*"\])*$/;

/** `$.a.b[0]` -> `a.b[0]`, the path syntax `_.get` takes. `$` alone addresses the whole body. */
function lodashPath(path: string): string {
  return path.replace(/^\$\.?/, "").replace(/\["([^"\\]*)"\]/g, ".$1").replace(/^\./, "");
}

const js = (v: unknown): string => JSON.stringify(v ?? null);

/** `_.get(json, "a.b")`, or `json` itself for a bare `$`. */
function accessor(path: string): string {
  const p = lodashPath(path);
  return p === "" ? "json" : `_.get(json, ${js(p)})`;
}

function statusLines(a: Extract<TruSpecAssertion, { type: "status" }>): string[] {
  const out: string[] = [];
  if (a.equals !== undefined) out.push(`  pm.response.to.have.status(${a.equals});`);
  if (a.in !== undefined) out.push(`  pm.expect(${js(a.in)}).to.include(pm.response.code);`);
  if (a.lt !== undefined) out.push(`  pm.expect(pm.response.code).to.be.below(${a.lt});`);
  if (a.gte !== undefined) out.push(`  pm.expect(pm.response.code).to.be.at.least(${a.gte});`);
  return out;
}

function headerLines(a: Extract<TruSpecAssertion, { type: "header" }>): string[] {
  const out: string[] = [];
  const value = `pm.response.headers.get(${js(a.name)})`;
  if (a.exists === true) out.push(`  pm.response.to.have.header(${js(a.name)});`);
  if (a.exists === false) out.push(`  pm.expect(${value}).to.be.oneOf([null, undefined]);`);
  if (a.equals !== undefined) out.push(`  pm.expect(${value}).to.eql(${js(a.equals)});`);
  if (a.notEquals !== undefined) out.push(`  pm.expect(${value}).to.not.eql(${js(a.notEquals)});`);
  if (a.contains !== undefined) out.push(`  pm.expect(${value}).to.include(${js(a.contains)});`);
  if (a.matches !== undefined) out.push(`  pm.expect(${value}).to.match(new RegExp(${js(a.matches)}));`);
  return out;
}

function bodyLines(a: Extract<TruSpecAssertion, { type: "body" }>): string[] {
  const out: string[] = [];
  const text = "pm.response.text()";
  if (a.equals !== undefined) out.push(`  pm.expect(${text}).to.eql(${js(a.equals)});`);
  if (a.contains !== undefined) out.push(`  pm.expect(${text}).to.include(${js(a.contains)});`);
  if (a.notContains !== undefined) out.push(`  pm.expect(${text}).to.not.include(${js(a.notContains)});`);
  if (a.matches !== undefined) out.push(`  pm.expect(${text}).to.match(new RegExp(${js(a.matches)}));`);
  if (a.empty === true) out.push(`  pm.expect(${text}).to.eql("");`);
  if (a.empty === false) out.push(`  pm.expect(${text}).to.not.eql("");`);
  return out;
}

function jsonpathLines(a: Extract<TruSpecAssertion, { type: "jsonpath" }>): string[] {
  const v = accessor(a.path);
  const out: string[] = ["  const json = pm.response.json();"];
  if (a.exists === true) out.push(`  pm.expect(${v}).to.not.be.oneOf([null, undefined]);`);
  if (a.exists === false) out.push(`  pm.expect(${v}).to.be.oneOf([null, undefined]);`);
  if (a.equals !== undefined) out.push(`  pm.expect(${v}).to.eql(${js(a.equals)});`);
  if (a.notEquals !== undefined) out.push(`  pm.expect(${v}).to.not.eql(${js(a.notEquals)});`);
  if (a.oneOf !== undefined) out.push(`  pm.expect(${js(a.oneOf)}).to.deep.include(${v});`);
  if (a.contains !== undefined) out.push(`  pm.expect(${v}).to.include(${js(a.contains)});`);
  if (a.matches !== undefined) out.push(`  pm.expect(String(${v})).to.match(new RegExp(${js(a.matches)}));`);
  if (a.gt !== undefined) out.push(`  pm.expect(${v}).to.be.above(${a.gt});`);
  if (a.gte !== undefined) out.push(`  pm.expect(${v}).to.be.at.least(${a.gte});`);
  if (a.lt !== undefined) out.push(`  pm.expect(${v}).to.be.below(${a.lt});`);
  if (a.lte !== undefined) out.push(`  pm.expect(${v}).to.be.at.most(${a.lte});`);
  if (a.valueType !== undefined) {
    out.push(
      a.valueType === "null"
        ? `  pm.expect(${v}).to.be.null;`
        : a.valueType === "array"
          ? `  pm.expect(${v}).to.be.an("array");`
          : `  pm.expect(${v}).to.be.a(${js(a.valueType)});`,
    );
  }
  if (a.length !== undefined) out.push(`  pm.expect(${v}).to.have.lengthOf(${a.length});`);
  if (a.minLength !== undefined) out.push(`  pm.expect(${v}).to.have.lengthOf.at.least(${a.minLength});`);
  if (a.maxLength !== undefined) out.push(`  pm.expect(${v}).to.have.lengthOf.at.most(${a.maxLength});`);
  if (a.empty === true) out.push(`  pm.expect(${v}).to.be.empty;`);
  if (a.empty === false) out.push(`  pm.expect(${v}).to.not.be.empty;`);
  return out;
}

/** A short human label, so a failure in Postman's runner names the assertion the way TruSpec does. */
function label(a: TruSpecAssertion): string {
  switch (a.type) {
    case "status":
      return a.equals !== undefined ? `status is ${a.equals}` : "status";
    case "header":
      return `header ${a.name}`;
    case "jsonpath":
      return `jsonpath ${a.path}`;
    case "body":
      return "body";
    case "duration":
      return `responds under ${a.ltMs}ms`;
    default:
      return a.type;
  }
}

/**
 * Render a request's declarative assertions as a Postman test script.
 *
 * Without this, exporting to Postman hands someone a collection of requests that assert nothing —
 * the assertions are the entire reason a TruSpec collection can gate CI, and Postman has a perfectly
 * good place to put them. Anything that genuinely has no Postman equivalent is reported through
 * `warn` rather than dropped in silence.
 */
export function assertionsToPostmanTest(
  assertions: TruSpecAssertion[],
  requestName: string,
  warn: (message: string) => void,
): string[] {
  const lines: string[] = [];
  for (const a of assertions) {
    let body: string[];
    switch (a.type) {
      case "status":
        body = statusLines(a);
        break;
      case "header":
        body = headerLines(a);
        break;
      case "body":
        body = bodyLines(a);
        break;
      case "duration":
        body = [`  pm.expect(pm.response.responseTime).to.be.below(${a.ltMs});`];
        break;
      case "jsonpath":
        if (!SIMPLE_JSONPATH.test(a.path)) {
          // Filters and wildcards have no lodash equivalent; a silently wrong test is worse than
          // an absent one, so say which path was left out.
          warn(`"${requestName}": jsonpath \`${a.path}\` is too complex to express as a Postman test`);
          continue;
        }
        body = jsonpathLines(a);
        break;
      case "schema":
        // Validating against the linked OpenAPI response schema needs the spec, which a Postman
        // collection does not carry.
        warn(`"${requestName}": \`schema\` assertions need the OpenAPI spec and have no Postman equivalent`);
        continue;
      case "sse":
        // Postman buffers a stream as one body and has no notion of individual events, so any
        // translation would be a weaker assertion wearing the same name.
        warn(`"${requestName}": \`sse\` assertions have no Postman equivalent and were not exported`);
        continue;
      default:
        continue;
    }
    if (body.length === 0) continue;
    lines.push(`pm.test(${js(label(a))}, function () {`, ...body, "});");
  }
  return lines;
}

/**
 * `capture:` as the `pm.environment.set(...)` lines Postman chains requests with.
 *
 * Exporting the assertions but not the captures hands over a collection whose login checks the
 * response and then throws the token away, so every request after it fails on an unset variable.
 * The chain is the part of a collection that is hardest to rebuild by hand.
 */
export function capturesToPostmanTest(
  capture: TruSpecRequest["capture"],
  requestName: string,
  warn: (message: string) => void,
): string[] {
  const entries = Object.entries(capture ?? {});
  if (entries.length === 0) return [];
  const lines: string[] = [];
  const sets: string[] = [];
  for (const [name, source] of entries) {
    if (typeof source === "string" || (typeof source === "object" && "jsonpath" in source)) {
      const path = typeof source === "string" ? source : source.jsonpath;
      if (!SIMPLE_JSONPATH.test(path)) {
        warn(`"${requestName}": capture \`${name}\` uses a jsonpath too complex for a Postman test`);
        continue;
      }
      sets.push(`  pm.environment.set(${js(name)}, ${accessor(path)});`);
    } else if ("header" in source) {
      sets.push(`  pm.environment.set(${js(name)}, pm.response.headers.get(${js(source.header)}));`);
    } else if ("status" in source) {
      sets.push(`  pm.environment.set(${js(name)}, pm.response.code);`);
    }
  }
  if (sets.length === 0) return [];
  // `json` is what the assertion lines above already bind; declare it only if nothing else did.
  lines.push("pm.test(\"capture\", function () {", "  const json = pm.response.json();", ...sets, "});");
  return lines;
}
