import { useEffect, useState } from "react";
import { getFolderConfig, saveFolderConfig, type RequestAuth } from "../api";
import { AuthEditor } from "./AuthEditor";
import { EditableKV, objectToRows, rowsToObject, type KVRow } from "./EditableKV";
import { VarAwareInput } from "./VarAwareInput";

export function FolderSettingsModal({
  path,
  onClose,
  onSaved,
  envVarNames,
}: {
  path: string;
  onClose: () => void;
  onSaved: () => void;
  /** Environment variable names, for `{{...}}` autocomplete in headers/auth values — a folder's
   * base URL, headers, and auth are just as likely to reference a variable as a request's own. */
  envVarNames: string[];
}) {
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headerRows, setHeaderRows] = useState<KVRow[]>([]);
  const [auth, setAuth] = useState<RequestAuth>({ type: "none" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    getFolderConfig(path)
      .then((cfg) => {
        if (ignore) return;
        setName(cfg.name ?? "");
        setBaseUrl(cfg.baseUrl ?? "");
        setHeaderRows(objectToRows(cfg.headers));
        setAuth(cfg.auth ?? { type: "none" });
        setLoading(false);
      })
      .catch((e) => {
        if (!ignore) {
          setErr(String(e));
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [path]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const config: Record<string, unknown> = { tspec: "0.1" };
      if (name.trim()) config.name = name.trim();
      if (baseUrl.trim()) config.baseUrl = baseUrl.trim();
      const headers = rowsToObject(headerRows);
      if (Object.keys(headers).length > 0) config.headers = headers;
      if (auth.type !== "none") config.auth = auth;
      const res = await saveFolderConfig(path, config);
      if (!res.ok) {
        setErr(res.error ?? "save failed");
        return;
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>folder settings — {path}</span>
          <button className="btn ghost small" onClick={onClose}>
            close
          </button>
        </div>
        <div className="modal-body">
          {loading ? (
            <p className="muted">loading…</p>
          ) : (
            <>
              <input
                className="path-input"
                aria-label="folder name"
                placeholder="folder name"
                spellCheck={false}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {envVarNames.length > 0 ? (
                <VarAwareInput
                  className="path-input"
                  ariaLabel="base url"
                  placeholder="base url, e.g. {{baseUrl}}"
                  spellCheck={false}
                  value={baseUrl}
                  onChange={setBaseUrl}
                  suggestions={envVarNames}
                />
              ) : (
                <input
                  className="path-input"
                  aria-label="base url"
                  placeholder="base url, e.g. {{baseUrl}}"
                  spellCheck={false}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              )}
              <div>
                <div className="env-section-label">headers (inherited by requests in this folder)</div>
                <EditableKV rows={headerRows} onChange={setHeaderRows} keyPlaceholder="header" varSuggestions={envVarNames} />
              </div>
              <div>
                <div className="env-section-label">auth (inherited unless a request sets its own)</div>
                <AuthEditor auth={auth} onChange={setAuth} envVarNames={envVarNames} />
              </div>
              {err && <div className="editor-err">{err}</div>}
              <div className="modal-actions">
                <button className="btn ghost" disabled={busy} onClick={onClose}>
                  cancel
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
  );
}
