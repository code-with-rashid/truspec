import { useState } from "react";
import type { CaptureSource } from "../api";

interface CaptureRow {
  name: string;
  source: CaptureSource;
}

function rowsToCapture(rows: CaptureRow[]): Record<string, CaptureSource> | undefined {
  const obj: Record<string, CaptureSource> = {};
  for (const row of rows) {
    if (row.name.trim() === "") continue;
    obj[row.name] = row.source;
  }
  return Object.keys(obj).length > 0 ? obj : undefined;
}

function captureToRows(capture: Record<string, CaptureSource> | undefined): CaptureRow[] {
  return Object.entries(capture ?? {}).map(([name, source]) => ({ name, source }));
}

type SourceKind = "jsonpath" | "header" | "status";

function kindOf(source: CaptureSource): SourceKind {
  if (typeof source === "string") return "jsonpath";
  if ("jsonpath" in source) return "jsonpath";
  if ("header" in source) return "header";
  return "status";
}

function pathOf(source: CaptureSource): string {
  if (typeof source === "string") return source;
  if ("jsonpath" in source) return source.jsonpath;
  return "";
}

function headerOf(source: CaptureSource): string {
  return typeof source === "object" && "header" in source ? source.header : "";
}

/** Was entirely absent from the UI — `capture` (saving a response value into a variable for a
 * later request, e.g. a login step capturing a token) is one of CLAUDE.md's headline features
 * ("Capture & chaining"), but authoring one required hand-writing YAML; the app only ever
 * displayed captured *results* after a run, never the declaration that produces them.
 *
 * Rows are kept as local state (not derived from `capture` on every render) for the same reason
 * RequestWorkspace's queryRows/headerRows and BodyEditor's formRows are: `rowsToCapture()` drops
 * any row with a blank name, so a freshly-added row would otherwise vanish before you could type a
 * name into it. This component is only ever mounted while its tab is active (`{tab === "capture"
 * && ...}` in RequestWorkspace), so switching away and back — or to a different request entirely —
 * already remounts it fresh with no extra reset wiring needed. */
export function CaptureEditor({
  capture,
  onChange,
}: {
  capture?: Record<string, CaptureSource>;
  onChange: (capture: Record<string, CaptureSource> | undefined) => void;
}) {
  const [rows, setRows] = useState<CaptureRow[]>(() => captureToRows(capture));

  const commit = (next: CaptureRow[]): void => {
    setRows(next);
    onChange(rowsToCapture(next));
  };
  const setRow = (i: number, patch: Partial<CaptureRow>): void => commit(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number): void => commit(rows.filter((_, idx) => idx !== i));
  const addRow = (): void => commit([...rows, { name: "", source: "$." }]);

  const setKind = (i: number, kind: SourceKind): void => {
    const source: CaptureSource = kind === "jsonpath" ? "$." : kind === "header" ? { header: "" } : { status: true };
    setRow(i, { source });
  };

  return (
    <div className="asserts-edit">
      {rows.map((row, i) => {
        const kind = kindOf(row.source);
        return (
          <div className="assert-row" key={i}>
            <input
              className="kv-input assert-name"
              placeholder="var name"
              spellCheck={false}
              value={row.name}
              onChange={(e) => setRow(i, { name: e.target.value })}
            />
            <select aria-label="capture source" className="assert-type-select" value={kind} onChange={(e) => setKind(i, e.target.value as SourceKind)}>
              <option value="jsonpath">jsonpath</option>
              <option value="header">header</option>
              <option value="status">status</option>
            </select>
            <div className="assert-fields">
              {kind === "jsonpath" && (
                <input
                  className="kv-input assert-value"
                  placeholder="$.access_token"
                  spellCheck={false}
                  value={pathOf(row.source)}
                  onChange={(e) => setRow(i, { source: e.target.value })}
                />
              )}
              {kind === "header" && (
                <input
                  className="kv-input assert-value"
                  placeholder="X-Request-Id"
                  spellCheck={false}
                  value={headerOf(row.source)}
                  onChange={(e) => setRow(i, { source: { header: e.target.value } })}
                />
              )}
            </div>
            <button className="row-action-btn danger" title="remove capture" aria-label="remove capture" onClick={() => removeRow(i)}>
              ✕
            </button>
          </div>
        );
      })}
      <button className="btn ghost small editable-kv-add" onClick={addRow}>
        + add capture
      </button>
      <p className="captured-hint" style={{ marginTop: rows.length > 0 ? 9 : 0 }}>
        saves a response value into <code>{"{{var name}}"}</code>, available to later requests in
        the same run (ordered by <code>order</code>, then path).
      </p>
    </div>
  );
}
