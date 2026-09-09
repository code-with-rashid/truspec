import type { TruSpecAssertion, TruSpecCaptureSource } from "./types";

/**
 * An assertion, in the words a person would use for it.
 *
 * `truspec docs` printed `{"type":"jsonpath","path":"$.id","exists":true}` — the internal object,
 * in a document whose entire purpose is being read by someone who does not have the schema open.
 * Every other surface already speaks: the run report, the flow view, the Postman export. This is
 * the one description they can share.
 *
 * Pure and dependency-free, so the browser client can use it too.
 */
export function describeAssertion(a: TruSpecAssertion): string {
  switch (a.type) {
    case "status":
      return `status ${joinConditions(statusConditions(a))}`;
    case "duration":
      return `responds in under ${a.ltMs}ms`;
    case "header": {
      const conditions = valueConditions(a);
      return `header \`${a.name}\` ${conditions.length > 0 ? joinConditions(conditions) : "is present"}`;
    }
    case "body": {
      const conditions = valueConditions(a);
      return `body ${conditions.length > 0 ? joinConditions(conditions) : "is present"}`;
    }
    case "jsonpath": {
      const conditions = valueConditions(a);
      return `\`${a.path}\` ${conditions.length > 0 ? joinConditions(conditions) : "is present"}`;
    }
    case "schema": {
      const parts: string[] = [];
      if (a.status !== undefined) parts.push(`for status ${a.status}`);
      if (a.contentType !== undefined) parts.push(`as ${a.contentType}`);
      return `body matches the spec's response schema${parts.length > 0 ? ` ${parts.join(" ")}` : ""}`;
    }
    default:
      return (a as { type: string }).type;
  }
}

/** `a`, `a and b`, `a, b and c` — an assertion's conditions are AND-ed, and should read that way. */
function joinConditions(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const show = (v: unknown): string => (typeof v === "string" ? `"${v}"` : JSON.stringify(v));

function statusConditions(a: Extract<TruSpecAssertion, { type: "status" }>): string[] {
  const out: string[] = [];
  if (a.equals !== undefined) out.push(`is ${a.equals}`);
  if (a.in !== undefined) out.push(`is one of ${a.in.join(", ")}`);
  if (a.lt !== undefined) out.push(`is under ${a.lt}`);
  if (a.gte !== undefined) out.push(`is at least ${a.gte}`);
  return out.length > 0 ? out : ["is present"];
}

/** The comparisons shared by `header`, `body` and `jsonpath`, in the order they read best. */
function valueConditions(a: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (a.exists === true) out.push("exists");
  if (a.exists === false) out.push("is absent");
  if (a.equals !== undefined) out.push(`is ${show(a.equals)}`);
  if (a.notEquals !== undefined) out.push(`is not ${show(a.notEquals)}`);
  if (a.oneOf !== undefined) out.push(`is one of ${(a.oneOf as unknown[]).map(show).join(", ")}`);
  if (a.contains !== undefined) out.push(`contains ${show(a.contains)}`);
  if (a.notContains !== undefined) out.push(`does not contain ${show(a.notContains)}`);
  if (a.matches !== undefined) out.push(`matches /${String(a.matches)}/`);
  if (a.gt !== undefined) out.push(`> ${String(a.gt)}`);
  if (a.gte !== undefined) out.push(`≥ ${String(a.gte)}`);
  if (a.lt !== undefined) out.push(`< ${String(a.lt)}`);
  if (a.lte !== undefined) out.push(`≤ ${String(a.lte)}`);
  if (a.valueType !== undefined) out.push(`is a ${String(a.valueType)}`);
  if (a.length !== undefined) out.push(`has length ${String(a.length)}`);
  if (a.minLength !== undefined) out.push(`has length ≥ ${String(a.minLength)}`);
  if (a.maxLength !== undefined) out.push(`has length ≤ ${String(a.maxLength)}`);
  if (a.empty === true) out.push("is empty");
  if (a.empty === false) out.push("is not empty");
  return out;
}

/** Where a captured value comes from, in the same register. */
export function describeCaptureSource(source: TruSpecCaptureSource): string {
  if (typeof source === "string") return `\`${source}\``;
  if ("jsonpath" in source) return `\`${source.jsonpath}\``;
  if ("header" in source) return `header \`${source.header}\``;
  return "the response status";
}
