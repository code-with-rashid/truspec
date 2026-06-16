import type { TruSpecCaptureSource } from "../format/types";
import type { ResponseView } from "./assertions";
import type { VarValue } from "./interpolate";
import { jsonpath } from "./jsonpath";

function fromJsonpath(res: ResponseView, path: string): VarValue | undefined {
  if (res.json === undefined) return undefined;
  let matches: unknown[];
  try {
    matches = jsonpath(res.json, path);
  } catch {
    return undefined;
  }
  const first = matches[0];
  if (first === undefined) return undefined;
  if (typeof first === "string" || typeof first === "number" || typeof first === "boolean") return first;
  return JSON.stringify(first);
}

function captureOne(source: TruSpecCaptureSource, res: ResponseView): VarValue | undefined {
  if (typeof source === "string") return fromJsonpath(res, source);
  if ("jsonpath" in source) return fromJsonpath(res, source.jsonpath);
  if ("header" in source) return res.headers[source.header.toLowerCase()];
  if ("status" in source) return res.status;
  return undefined;
}

/** Evaluate a request's `capture` map against the response into variables. */
export function evaluateCaptures(
  capture: Record<string, TruSpecCaptureSource> | undefined,
  res: ResponseView,
): Record<string, VarValue> {
  const out: Record<string, VarValue> = {};
  if (!capture) return out;
  for (const [name, source] of Object.entries(capture)) {
    const value = captureOne(source, res);
    if (value !== undefined) out[name] = value;
  }
  return out;
}
