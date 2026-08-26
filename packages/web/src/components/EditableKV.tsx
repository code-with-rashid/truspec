import { VarAwareInput } from "./VarAwareInput";

export interface KVRow {
  key: string;
  value: string;
}

export function objectToRows(obj: Record<string, string | number | boolean> | undefined): KVRow[] {
  return Object.entries(obj ?? {}).map(([key, value]) => ({ key, value: String(value) }));
}

/** Blank keys are dropped; a later duplicate key wins (matches how a plain object literal would behave). */
export function rowsToObject(rows: KVRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of rows) {
    const k = key.trim();
    if (k) out[k] = value;
  }
  return out;
}

/** Editable key/value row list, array-backed (not a Record) so an in-progress duplicate or
 * blank key while typing doesn't silently collide with another row. */
export function EditableKV({
  rows,
  onChange,
  keyPlaceholder = "key",
  valuePlaceholder = "value",
  varSuggestions,
}: {
  rows: KVRow[];
  onChange: (rows: KVRow[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Environment variable names, for `{{...}}` autocomplete in the value column. Omit to fall back
   * to a plain input (e.g. contexts with no environment concept). */
  varSuggestions?: string[];
}) {
  const setRow = (i: number, patch: Partial<KVRow>): void => {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const removeRow = (i: number): void => {
    onChange(rows.filter((_, idx) => idx !== i));
  };
  const addRow = (): void => {
    onChange([...rows, { key: "", value: "" }]);
  };
  return (
    <div className="editable-kv">
      {rows.map((row, i) => (
        <div className="editable-kv-row" key={i}>
          <input
            className="editable-kv-key"
            placeholder={keyPlaceholder}
            spellCheck={false}
            value={row.key}
            onChange={(e) => setRow(i, { key: e.target.value })}
          />
          {varSuggestions && varSuggestions.length > 0 ? (
            <VarAwareInput
              className="editable-kv-value"
              placeholder={valuePlaceholder}
              spellCheck={false}
              value={row.value}
              onChange={(v) => setRow(i, { value: v })}
              suggestions={varSuggestions}
            />
          ) : (
            <input
              className="editable-kv-value"
              placeholder={valuePlaceholder}
              spellCheck={false}
              value={row.value}
              onChange={(e) => setRow(i, { value: e.target.value })}
            />
          )}
          <button className="row-action-btn danger" title="remove" aria-label="remove row" onClick={() => removeRow(i)}>
            ✕
          </button>
        </div>
      ))}
      <button className="btn ghost small editable-kv-add" onClick={addRow}>
        + add
      </button>
    </div>
  );
}
