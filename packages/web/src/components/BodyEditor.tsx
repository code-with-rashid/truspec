import { useEffect, useRef, useState } from "react";
import type { RequestBody } from "../api";
import { EditableKV, objectToRows, rowsToObject } from "./EditableKV";

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

export function BodyEditor({ body, onChange }: { body?: RequestBody; onChange: (body: RequestBody) => void }) {
  const type = body?.type ?? "none";

  const setType = (next: RequestBody["type"]): void => {
    if (next === "none") onChange({ type: "none" });
    else if (next === "json") onChange({ type: "json", content: body?.type === "json" ? body.content : {} });
    else if (next === "text") onChange({ type: "text", content: body?.type === "text" ? body.content : "" });
    else if (next === "form") onChange({ type: "form", content: body?.type === "form" ? body.content : {} });
    else onChange({ type: "graphql", query: body?.type === "graphql" ? body.query : "", variables: body?.type === "graphql" ? body.variables : undefined });
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
          rows={objectToRows(body.content)}
          onChange={(rows) => onChange({ type: "form", content: rowsToObject(rows) })}
          keyPlaceholder="field"
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
