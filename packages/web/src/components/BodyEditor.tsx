import { useEffect, useRef, useState } from "react";
import type { MultipartField, RequestBody } from "../api";
import { EditableKV, objectToRows, rowsToObject, type KVRow } from "./EditableKV";

/** Live-parses JSON on every keystroke; only propagates to the parent once it parses, otherwise
 * holds the last-valid value and shows an inline "not applied" note. Reseeds its local text only
 * when `value` changes for a reason other than our own last emit (switching requests, discard) —
 * tracked via a ref, so mid-typing edits from the parent's re-render don't stomp the textarea. */
function JsonTextEditor({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(JSON.stringify(value, null, 2));
      setErr(null);
      lastEmitted.current = value;
    }
  }, [value]);

  const handleChange = (t: string): void => {
    setText(t);
    try {
      const parsed: unknown = JSON.parse(t);
      setErr(null);
      lastEmitted.current = parsed;
      onChange(parsed);
    } catch {
      setErr("invalid JSON — not applied");
    }
  };

  return (
    <>
      <textarea
        className="editor-text"
        spellCheck={false}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
      />
      {err && <div className="editor-err">{err}</div>}
    </>
  );
}

export function BodyEditor({
  body,
  onChange,
  envVarNames,
}: {
  body?: RequestBody;
  onChange: (body: RequestBody) => void;
  envVarNames?: string[];
}) {
  const type = body?.type ?? "none";

  // Mirrors RequestWorkspace's queryRows/headerRows: kept as its own state (not derived from
  // body.content on every render) so a blank or in-progress-duplicate key survives —
  // rowsToObject() would otherwise drop it immediately, and re-deriving from that object on the
  // next render would make a freshly-added row vanish before you could type a key into it at all.
  // Reset only when switching *into* form (a fresh mount effectively, and setType's own reset of
  // content to `{}` when arriving from a different type needs mirroring here) — not on every
  // keystroke.
  const [formRows, setFormRows] = useState<KVRow[]>(() => (body?.type === "form" ? objectToRows(body.content) : []));
  useEffect(() => {
    if (type === "form") setFormRows(objectToRows(body?.type === "form" ? body.content : {}));
  }, [type]);

  const setType = (next: RequestBody["type"]): void => {
    if (next === "none") onChange({ type: "none" });
    else if (next === "json") onChange({ type: "json", content: body?.type === "json" ? body.content : {} });
    else if (next === "text") onChange({ type: "text", content: body?.type === "text" ? body.content : "" });
    else if (next === "form") onChange({ type: "form", content: body?.type === "form" ? body.content : {} });
    else if (next === "multipart") {
      onChange({ type: "multipart", fields: body?.type === "multipart" ? body.fields : {} });
    } else onChange({ type: "graphql", query: body?.type === "graphql" ? body.query : "", variables: body?.type === "graphql" ? body.variables : undefined });
  };

  return (
    <>
      <div className="type-row">
        <span className="type-label">type</span>
        <select
          aria-label="body type"
          value={type}
          onChange={(e) => setType(e.target.value as RequestBody["type"])}
        >
          <option value="none">none</option>
          <option value="json">json</option>
          <option value="text">text</option>
          <option value="form">form</option>
          <option value="multipart">multipart</option>
          <option value="graphql">graphql</option>
        </select>
      </div>

      {type === "none" && <div className="muted pad">no request body.</div>}

      {body?.type === "json" && (
        <JsonTextEditor value={body.content} onChange={(content) => onChange({ type: "json", content })} />
      )}

      {body?.type === "text" && (
        <textarea
          className="editor-text"
          spellCheck={false}
          value={body.content}
          onChange={(e) => onChange({ type: "text", content: e.target.value })}
        />
      )}

      {body?.type === "form" && (
        <EditableKV
          rows={formRows}
          onChange={(rows) => {
            setFormRows(rows);
            onChange({ type: "form", content: rowsToObject(rows) });
          }}
          keyPlaceholder="field"
          varSuggestions={envVarNames}
        />
      )}

      {body?.type === "multipart" && (
        <MultipartEditor
          fields={body.fields}
          onChange={(fields) => onChange({ type: "multipart", fields })}
          envVarNames={envVarNames}
        />
      )}

      {body?.type === "graphql" && (
        <>
          <div className="type-row" style={{ marginTop: 4 }}>
            <span className="type-label">query</span>
          </div>
          <textarea
            className="editor-text"
            spellCheck={false}
            value={body.query}
            onChange={(e) => onChange({ ...body, query: e.target.value })}
          />
          <div className="type-row" style={{ marginTop: 12 }}>
            <span className="type-label">variables</span>
          </div>
          <JsonTextEditor
            value={body.variables ?? {}}
            onChange={(variables) => onChange({ ...body, variables: variables as Record<string, unknown> })}
          />
        </>
      )}
    </>
  );
}

/**
 * Editor for `multipart/form-data` parts. Each row is either a plain text value or a file path
 * read at send time — the distinction matters enough (one is data, the other touches the disk)
 * that it is an explicit per-row choice rather than magic on the value.
 */
function MultipartEditor({
  fields,
  onChange,
  envVarNames,
}: {
  fields: Record<string, MultipartField>;
  onChange: (fields: Record<string, MultipartField>) => void;
  envVarNames?: string[];
}) {
  // Rows are local state for the same reason the form editor's are: a blank or duplicate key must
  // survive typing, which re-deriving from the object every render would not allow.
  const [rows, setRows] = useState<Array<{ name: string; field: MultipartField }>>(() =>
    Object.entries(fields).map(([name, field]) => ({ name, field })),
  );

  const emit = (next: Array<{ name: string; field: MultipartField }>): void => {
    setRows(next);
    const out: Record<string, MultipartField> = {};
    for (const r of next) if (r.name) out[r.name] = r.field;
    onChange(out);
  };
  const patch = (i: number, field: MultipartField): void =>
    emit(rows.map((r, idx) => (idx === i ? { ...r, field } : r)));

  const isFile = (f: MultipartField): f is { file: string; filename?: string; contentType?: string } =>
    typeof f === "object" && f !== null && "file" in f;

  return (
    <div className="asserts-edit">
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional; a key by name would
        // remount the row on every keystroke in the name field.
        <div className="assert-row" key={i}>
          <input
            className="kv-input assert-name"
            aria-label="part name"
            placeholder="field"
            spellCheck={false}
            value={row.name}
            onChange={(e) => emit(rows.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)))}
          />
          <select
            aria-label="part kind"
            value={isFile(row.field) ? "file" : "text"}
            onChange={(e) => patch(i, e.target.value === "file" ? { file: "" } : "")}
          >
            <option value="text">text</option>
            <option value="file">file</option>
          </select>
          {isFile(row.field) ? (
            <input
              className="kv-input assert-value"
              aria-label="file path"
              placeholder="./upload.png  (relative to this request)"
              spellCheck={false}
              value={row.field.file}
              onChange={(e) => patch(i, { ...(row.field as { file: string }), file: e.target.value })}
            />
          ) : (
            <input
              className="kv-input assert-value"
              aria-label="part value"
              spellCheck={false}
              value={typeof row.field === "object" ? (row.field as { text: string }).text : String(row.field)}
              onChange={(e) => patch(i, e.target.value)}
            />
          )}
          <button
            className="row-action-btn danger"
            title="remove part"
            aria-label="remove part"
            onClick={() => emit(rows.filter((_, idx) => idx !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="btn ghost small editable-kv-add" onClick={() => emit([...rows, { name: "", field: "" }])}>
        + add part
      </button>
      <p className="captured-hint" style={{ marginTop: 9 }}>
        File paths resolve relative to the request file and are confined to the collection.
        {envVarNames && envVarNames.length > 0 ? " Values may use {{vars}}." : ""}
      </p>
    </div>
  );
}
