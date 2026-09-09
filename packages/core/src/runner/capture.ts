import type { TruSpecCaptureSource } from "../format/types";
import type { ResponseView } from "./assertions";
import type { VarValue } from "./interpolate";
import { explainJsonPathMiss, jsonpath } from "./jsonpath";

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

/** A capture that produced nothing, with the reason, for reporting. */
export interface MissedCapture {
  name: string;
  /** Where it looked, as written in the file. */
  source: string;
  /** Why nothing came back, when that can be said precisely. */
  reason?: string;
}

/** How a capture source reads back, for a message that matches what is in the file. */
function describeSource(source: TruSpecCaptureSource): string {
  if (typeof source === "string") return source;
  if ("jsonpath" in source) return source.jsonpath;
  if ("header" in source) return `header ${source.header}`;
  return "status";
}

/** Why a capture came back empty — reusing the same explanation a failed assertion gives. */
function missReason(source: TruSpecCaptureSource, res: ResponseView): string | undefined {
  if (typeof source === "string") return explainJsonPathMiss(res.json, source);
  if ("jsonpath" in source) return explainJsonPathMiss(res.json, source.jsonpath);
  if ("header" in source) return `the response has no ${source.header} header`;
  return undefined;
}

export interface CaptureOutcome {
  values: Record<string, VarValue>;
  /**
   * Captures that matched nothing.
   *
   * A silent one is the most confusing failure in a chained collection: the login passes, and the
   * request three files later fails with "Unresolved variables: {{token}}" — naming the consumer,
   * not the producer, and saying nothing about which of them is wrong.
   */
  missed: MissedCapture[];
}

/** Evaluate a request's `capture` map against the response into variables. */
export function evaluateCaptures(
  capture: Record<string, TruSpecCaptureSource> | undefined,
  res: ResponseView,
): Record<string, VarValue> {
  return captureValues(capture, res).values;
}

/** As {@link evaluateCaptures}, but also reporting the captures that came back with nothing. */
export function captureValues(
  capture: Record<string, TruSpecCaptureSource> | undefined,
  res: ResponseView,
): CaptureOutcome {
  const values: Record<string, VarValue> = {};
  const missed: MissedCapture[] = [];
  if (!capture) return { values, missed };
  for (const [name, source] of Object.entries(capture)) {
    const value = captureOne(source, res);
    if (value !== undefined) values[name] = value;
    else {
      const reason = missReason(source, res);
      missed.push({ name, source: describeSource(source), ...(reason ? { reason } : {}) });
    }
  }
  return { values, missed };
}
