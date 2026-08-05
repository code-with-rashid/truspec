import { Fragment, useState } from "react";
import { getEnvironment, saveEnvironment } from "../api";
import { ConfirmModal } from "./ConfirmModal";
import { EditableKV, objectToRows, rowsToObject, type KVRow } from "./EditableKV";

type Mode = "list" | "edit" | "create";

export function EnvironmentModal({
  environments,
  onClose,
  onDelete,
  onChanged,
}: {
  environments: string[];
  onClose: () => void;
  /** Delegated to the caller so environment delete reuses the same rename/delete plumbing every
   * other tree row uses (`environments/<name>.env.yaml` is just another confined file). */
  onDelete: (name: string) => Promise<{ ok: boolean; error?: string }>;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>("list");
  const [activeName, setActiveName] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [rows, setRows] = useState<KVRow[]>([]);
  const [secrets, setSecrets] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const openCreate = (): void => {
    setMode("create");
    setActiveName(null);
    setNewName("");
    setRows([]);
    setSecrets([]);
    setErr(null);
  };

  const openEdit = async (name: string): Promise<void> => {
    setMode("edit");
    setActiveName(name);
    setErr(null);
    setBusy(true);
    try {
      const detail = await getEnvironment(name);
      setRows(objectToRows(detail.variables));
      setSecrets(detail.secrets);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    const name = (mode === "create" ? newName : activeName)?.trim();
    if (!name) {
      setErr("name required");
      return;
    }
    if (mode === "create" && environments.includes(name)) {
      setErr(`"${name}" already exists`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await saveEnvironment(name, rowsToObject(rows), secrets);
      if (!res.ok) {
        setErr(res.error ?? "save failed");
        return;
      }
      onChanged();
      setMode("list");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const addSecret = (): void => {
    const s = newSecret.trim();
    if (!s || secrets.includes(s)) return;
    setSecrets([...secrets, s]);
    setNewSecret("");
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      const res = await onDelete(deleteTarget);
      if (!res.ok) {
        setDeleteErr(res.error ?? "delete failed");
        return;
      }
      onChanged();
      setDeleteTarget(null);
      if (activeName === deleteTarget) setMode("list");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Fragment>
      <div className="modal-overlay" onClick={() => !busy && onClose()}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>environments</span>
          <button className="btn ghost small" onClick={onClose}>
            close
          </button>
        </div>
        <div className="modal-body">
          {mode === "list" && (
            <>
              {environments.length === 0 && <p className="muted">no environments yet.</p>}
              <div className="env-list">
                {environments.map((name) => (
                  <div className="env-list-row" key={name}>
                    <span className="env-list-name">{name}</span>
                    <button className="row-action-btn" title="edit" onClick={() => void openEdit(name)}>
                      ✎
                    </button>
                    <button
                      className="row-action-btn danger"
                      title="delete"
                      onClick={() => {
                        setDeleteErr(null);
                        setDeleteTarget(name);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button className="btn run small" onClick={openCreate}>
                + new environment
              </button>
            </>
          )}

          {(mode === "edit" || mode === "create") && (
            <>
              {mode === "create" ? (
                <input
                  className="path-input"
                  aria-label="environment name"
                  autoFocus
                  placeholder="environment name"
                  spellCheck={false}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              ) : (
                <div className="env-edit-title">{activeName}</div>
              )}

              <div>
                <div className="env-section-label">variables</div>
                <EditableKV rows={rows} onChange={setRows} keyPlaceholder="name" valuePlaceholder="value" />
              </div>

              <div>
                <div className="env-section-label">secrets</div>
                <p className="muted" style={{ fontSize: 11 }}>
                  names only — values come from the OS environment or a .env file, never stored here.
                </p>
                <div className="env-secrets">
                  {secrets.map((s) => (
                    <span className="captured-chip" key={s}>
                      <span className="k">{s}</span>
                      <button
                        className="row-action-btn danger"
                        title="remove"
                        onClick={() => setSecrets(secrets.filter((x) => x !== s))}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                <div className="editable-kv-row" style={{ marginTop: 6 }}>
                  <input
                    className="editable-kv-key"
                    placeholder="secret name"
                    spellCheck={false}
                    value={newSecret}
                    onChange={(e) => setNewSecret(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addSecret();
                    }}
                  />
                  <button className="btn ghost small" onClick={addSecret}>
                    + add
                  </button>
                </div>
              </div>

              {err && <div className="editor-err">{err}</div>}
              <div className="modal-actions">
                <button className="btn ghost" disabled={busy} onClick={() => setMode("list")}>
                  back
                </button>
                <button className="btn run" disabled={busy} onClick={() => void save()}>
                  {busy ? "saving…" : "save"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="delete environment"
          body={`Delete "${deleteTarget}"? This cannot be undone.`}
          confirmLabel="delete"
          danger
          busy={deleteBusy}
          error={deleteErr}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteErr(null);
          }}
        />
      )}
    </Fragment>
  );
}
