import { useEffect, useState } from "react";
import { HTTP_METHODS } from "./RequestWorkspace";

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "request";
}

function defaultPath(prefix: string, name: string): string {
  const base = `${slugify(name)}.tspec.yaml`;
  return prefix ? `${prefix.replace(/\/+$/, "")}/${base}` : base;
}

export interface NewRequestPayload {
  name: string;
  method: string;
  url: string;
  assertions: Array<Record<string, unknown>>;
}

/** Guided "new request" — a name/method/path form instead of a blank raw-YAML file, matching
 * Postman/Bruno's "click + and start typing" flow. The raw YAML editor (the sidebar's own "+ new"
 * button) remains available for anyone who wants to author the file directly. */
export function NewRequestModal({
  prefix,
  onCreate,
  onCancel,
}: {
  prefix: string;
  onCreate: (path: string, request: NewRequestPayload) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("New request");
  const [method, setMethod] = useState<string>("GET");
  const [path, setPath] = useState(() => defaultPath(prefix, "New request"));
  const [pathTouched, setPathTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!pathTouched) setPath(defaultPath(prefix, name));
  }, [name, prefix, pathTouched]);

  const create = async (): Promise<void> => {
    const p = path.trim();
    if (!p) return;
    setBusy(true);
    setErr(null);
    const res = await onCreate(p, {
      name: name.trim() || "New request",
      method,
      url: "{{baseUrl}}/path",
      assertions: [{ type: "status", equals: 200 }],
    });
    setBusy(false);
    if (!res.ok) setErr(res.error ?? "create failed");
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>new request</span>
          <button className="btn ghost small" disabled={busy} onClick={onCancel}>
            close
          </button>
        </div>
        <div className="modal-body">
          <div className="kv">
            <div className="kv-row">
              <span className="kv-k">name</span>
              <input
                className="kv-input"
                autoFocus
                spellCheck={false}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void create()}
              />
            </div>
            <div className="kv-row">
              <span className="kv-k">method</span>
              <select aria-label="method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {HTTP_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="kv-row">
              <span className="kv-k">path</span>
              <input
                className="kv-input"
                aria-label="file path"
                spellCheck={false}
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  setPathTouched(true);
                }}
                onKeyDown={(e) => e.key === "Enter" && void create()}
              />
            </div>
          </div>
          <p className="captured-hint" style={{ marginTop: 9 }}>
            creates a <code>.tspec.yaml</code> file with a starter template — everything (URL, params,
            headers, body, auth, assertions) is editable right after.
          </p>
          {err && <div className="editor-err">{err}</div>}
          <div className="modal-actions">
            <button className="btn ghost" disabled={busy} onClick={onCancel}>
              cancel
            </button>
            <button className="btn run" disabled={busy || !path.trim()} onClick={() => void create()}>
              {busy ? "creating…" : "create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
