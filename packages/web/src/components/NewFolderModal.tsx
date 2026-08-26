import { useState } from "react";

/** Guided "new folder" — a labeled name field in the shared modal chrome, replacing what used to
 * be a bare, unlabeled inline input in the sidebar (just a placeholder for guidance, no heading).
 * Slashes still work for a nested path in one go (`sub/folder`), same as before. */
export function NewFolderModal({
  prefix,
  busy,
  error,
  onCreate,
  onCancel,
}: {
  /** Parent folder this is nested under, if opened from a folder's own "new folder" action. */
  prefix?: string;
  busy: boolean;
  error: string | null;
  onCreate: (path: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const fullPath = prefix ? `${prefix.replace(/\/+$/, "")}/${name}` : name;

  const submit = (): void => {
    if (name.trim()) onCreate(fullPath);
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>new folder</span>
          <button className="btn ghost small" disabled={busy} onClick={onCancel}>
            close
          </button>
        </div>
        <div className="modal-body">
          <div className="kv">
            <div className="kv-row">
              <span className="kv-k">name</span>
              <input
                autoFocus
                className="kv-input"
                spellCheck={false}
                placeholder="e.g. users, or users/admin for a nested one"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
          </div>
          {prefix && (
            <p className="captured-hint" style={{ marginTop: 9 }}>
              inside <code>{prefix}</code> — creates <code>{fullPath || `${prefix}/…`}</code>
            </p>
          )}
          {!prefix && name.includes("/") && (
            <p className="captured-hint" style={{ marginTop: 9 }}>
              creates nested folders in one go: <code>{fullPath}</code>
            </p>
          )}
          {error && <div className="editor-err">{error}</div>}
          <div className="modal-actions">
            <button className="btn ghost" disabled={busy} onClick={onCancel}>
              cancel
            </button>
            <button className="btn run" disabled={busy || !name.trim()} onClick={submit}>
              {busy ? "creating…" : "create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
