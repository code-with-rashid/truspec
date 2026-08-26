import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { RequestDetail, RunResult, SaveResult } from "../api";
import { AssertionsEditor } from "./AssertionsEditor";
import { AuthEditor } from "./AuthEditor";
import { BodyEditor } from "./BodyEditor";
import { buildCurl } from "../curl";
import { CaptureEditor } from "./CaptureEditor";
import { EditableKV, objectToRows, rowsToObject, type KVRow } from "./EditableKV";
import { JsonBlock, prettyBody, statusClass } from "../format-utils";
import { ScriptEditor } from "./ScriptEditor";
import { VarAwareInput } from "./VarAwareInput";

export type ReqTab = "params" | "headers" | "body" | "auth" | "script" | "capture" | "assert";
export type RespTab = "body" | "headers";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export interface ContractInfo {
  state: "ok" | "fail" | "none";
  note: string;
}

/** A request's tie to its spec operation is the same string `driftReport` uses for `removed`. */
export function specRefOf(detail: Pick<RequestDetail, "spec" | "name"> | null): string | undefined {
  if (!detail?.spec) return undefined;
  return detail.spec.operation ?? detail.spec.operationId ?? detail.name;
}

/** Mirrors `truspec run --spec`: derive the contract badge from the auto-injected `schema` assertion. */
export function contractInfo(detail: RequestDetail | null, result?: RunResult): ContractInfo {
  if (!detail?.spec) return { state: "none", note: "no spec operation linked" };
  const schemaResult = result?.assertions.find((a) => a.type === "schema");
  if (!schemaResult) return { state: "none", note: "not yet validated — select a spec, then run" };
  if (schemaResult.ok && schemaResult.message.includes("(skipped)")) {
    return { state: "none", note: schemaResult.message };
  }
  return { state: schemaResult.ok ? "ok" : "fail", note: schemaResult.message };
}

const RESPONSE_STORAGE_KEY = "truspec.responseHeight";
const MIN_TOP_PANE = 160;
const MIN_RESPONSE = 120;
const DEFAULT_RESPONSE = 320;

/** Drag-to-resize for the response dock's pixel height, persisted across sessions — mirrors
 * `usePanelWidth` in App.tsx but drags vertically and keeps the request-builder pane from being
 * squeezed below MIN_TOP_PANE against whatever height the split's container actually has. */
function useResponseHeight() {
  const [height, setHeight] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem(RESPONSE_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_RESPONSE ? saved : DEFAULT_RESPONSE;
  });

  useEffect(() => {
    window.localStorage.setItem(RESPONSE_STORAGE_KEY, String(height));
  }, [height]);

  const onDragStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = height;
      const container = e.currentTarget.parentElement;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: PointerEvent): void => {
        const delta = ev.clientY - startY;
        const containerHeight = container?.getBoundingClientRect().height ?? startHeight + MIN_TOP_PANE;
        const max = Math.max(MIN_RESPONSE, containerHeight - MIN_TOP_PANE);
        setHeight(Math.min(max, Math.max(MIN_RESPONSE, startHeight - delta)));
      };
      const onUp = (): void => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [height],
  );

  return [height, onDragStart] as const;
}

export function RequestWorkspace({
  detail,
  draft,
  dirty,
  onFieldChange,
  onDiscard,
  onSave,
  result,
  running,
  tab,
  respTab,
  activeSpecRef,
  isStale,
  contract,
  envVarNames,
  onRun,
  onEdit,
  onTab,
  onRespTab,
  onGotoSpec,
}: {
  /** The request as last loaded from disk (fetch or post-save refresh) — the dirty-compare baseline. */
  detail: RequestDetail;
  /** The tab's own editable copy; lives in the parent (per open tab) so background tabs keep their
   * unsaved edits and dirty state even while unmounted. */
  draft: RequestDetail;
  dirty: boolean;
  onFieldChange: <K extends keyof RequestDetail>(key: K, value: RequestDetail[K]) => void;
  onDiscard: () => void;
  onSave: (request: Record<string, unknown>) => Promise<SaveResult>;
  result?: RunResult;
  running: boolean;
  tab: ReqTab;
  respTab: RespTab;
  activeSpecRef?: string;
  isStale: boolean;
  contract: ContractInfo;
  /** Declared vars/secrets on the active environment, for `{{...}}` autocomplete in the URL bar. */
  envVarNames: string[];
  onRun: () => void;
  onEdit: () => void;
  onTab: (t: ReqTab) => void;
  onRespTab: (t: RespTab) => void;
  onGotoSpec: () => void;
}) {
  const effective = draft;
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [responseHeight, onResponseDragStart] = useResponseHeight();
  const [copied, setCopied] = useState(false);
  const [curlCopied, setCurlCopied] = useState(false);

  const copyCurl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(buildCurl(effective));
      setCurlCopied(true);
      setTimeout(() => setCurlCopied(false), 1200);
    } catch {
      // clipboard permission denied/unavailable — nothing else useful to do here.
    }
  };

  // The only way to get a response out of the app was the clipboard — fine for a short JSON body,
  // awkward for anything large or binary-ish (a paste can silently mangle it). Postman/Bruno both
  // offer "save response to file" alongside copy.
  const downloadResponse = (): void => {
    if (!result?.response) return;
    const contentType = Object.entries(result.response.headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
    const ext = contentType.includes("json") ? "json" : contentType.includes("html") ? "html" : contentType.includes("xml") ? "xml" : "txt";
    const slug = effective.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "response";
    const blob = new Blob([result.response.bodyText], { type: contentType || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.${ext}`;
    // Some browsers only honor a synthetic click on an <a download> that's actually in the DOM.
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copyResponse = async (): Promise<void> => {
    if (!result?.response) return;
    const text = respTab === "body" ? result.response.bodyText : JSON.stringify(result.response.headers, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard permission denied/unavailable — nothing else useful to do here.
    }
  };

  // EditableKV's rows are kept as their own state (not derived from draft.query/headers on every
  // render) so a blank or in-progress-duplicate key survives — rowsToObject() would otherwise drop
  // it immediately, and re-deriving from that object on the next render would make the row vanish
  // as you type it. Reset only when a different request loads (a new `detail` reference) — a tab
  // switch remounts this component entirely (keyed by path), so this only fires on a same-tab
  // refresh (e.g. right after a save).
  const [queryRows, setQueryRows] = useState<KVRow[]>(() => objectToRows(detail.query));
  const [headerRows, setHeaderRows] = useState<KVRow[]>(() => objectToRows(detail.headers));
  useEffect(() => {
    setQueryRows(objectToRows(detail.query));
    setHeaderRows(objectToRows(detail.headers));
  }, [detail]);

  const discard = (): void => {
    onDiscard();
    setQueryRows(objectToRows(detail.query));
    setHeaderRows(objectToRows(detail.headers));
  };

  const assertions = effective.assertions ?? [];
  const captured = result?.captured ? Object.entries(result.captured) : [];

  const doSave = async (): Promise<void> => {
    setSaving(true);
    setSaveErr(null);
    try {
      const { raw: _raw, ...request } = draft;
      const res = await onSave(request);
      if (!res.ok) setSaveErr(res.error ?? "save failed");
    } catch (e) {
      setSaveErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="reqview"
      onKeyDown={(e) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          if (!running) onRun();
        } else if (e.key.toLowerCase() === "s") {
          e.preventDefault();
          if (dirty && !saving) void doSave();
        }
      }}
    >
      <div className="reqview-top">
      <div className="req-top">
        <div className="url-bar">
          <select
            className={`m m-${effective.method} method-select`}
            aria-label="method"
            value={effective.method}
            onChange={(e) => onFieldChange("method", e.target.value)}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <VarAwareInput
            className="url url-input"
            ariaLabel="request URL"
            spellCheck={false}
            value={effective.url}
            onChange={(v) => onFieldChange("url", v)}
            suggestions={envVarNames}
            onKeyDownExtra={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !running) onRun();
            }}
          />
        </div>
        <button className="btn ghost curl-btn" onClick={() => void copyCurl()} title="copy as curl">
          {curlCopied ? "copied ✓" : "curl"}
        </button>
        <button className="btn ghost" onClick={onEdit} title="edit YAML source">
          ✎ edit
        </button>
        <button className="btn run" disabled={running} onClick={onRun} title="send (Enter in URL, or Ctrl/Cmd+Enter anywhere)">
          {running ? "…" : "▶ send"}
        </button>
      </div>

      <div className="req-meta">
        <span className="req-name">{effective.name}</span>
        {activeSpecRef && !isStale && (
          <button className="badge-link" onClick={onGotoSpec} title="linked OpenAPI operation">
            ⇄ {effective.spec?.operationId ?? effective.spec?.operation}
          </button>
        )}
        {isStale && <span className="badge-stale">⚠ not in current spec</span>}
        {effective.order !== undefined ? (
          <span className="order-field" title="run order within the collection — lower first; requests without one fall back to path order">
            order
            <input
              type="number"
              value={effective.order}
              onChange={(e) => onFieldChange("order", Number(e.target.value) || 0)}
            />
            <button className="order-remove" title="unset order (fall back to path order)" aria-label="unset order" onClick={() => onFieldChange("order", undefined)}>
              ✕
            </button>
          </span>
        ) : (
          <button
            className="order-add"
            title="set an explicit run order — useful for chaining requests without renaming files"
            onClick={() => onFieldChange("order", 0)}
          >
            + order
          </button>
        )}
      </div>
      {effective.docs !== undefined ? (
        <div className="docs-edit">
          <div className="type-row">
            <span className="type-label">description</span>
            <span className="spacer" />
            <button className="btn ghost small" onClick={() => onFieldChange("docs", undefined)}>
              remove
            </button>
          </div>
          <textarea
            className="docs-input"
            spellCheck={false}
            placeholder="describe this request…"
            value={effective.docs}
            onChange={(e) => onFieldChange("docs", e.target.value)}
          />
        </div>
      ) : (
        <button className="btn ghost small" style={{ marginTop: 9 }} onClick={() => onFieldChange("docs", "")}>
          + add description
        </button>
      )}

      {dirty && (
        <div className="dirty-bar">
          <span>unsaved changes</span>
          <span className="spacer" />
          {saveErr && <span className="err" style={{ margin: 0 }}>{saveErr}</span>}
          <button className="btn ghost small" disabled={saving} onClick={discard}>
            discard
          </button>
          <button className="btn run small" disabled={saving} onClick={() => void doSave()} title="save (Ctrl/Cmd+S)">
            {saving ? "saving…" : "save"}
          </button>
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${tab === "params" ? "active" : ""}`} onClick={() => onTab("params")}>
          params <span className="tab-count">{Object.keys(rowsToObject(queryRows)).length}</span>
        </button>
        <button className={`tab ${tab === "headers" ? "active" : ""}`} onClick={() => onTab("headers")}>
          headers <span className="tab-count">{Object.keys(rowsToObject(headerRows)).length}</span>
        </button>
        <button className={`tab ${tab === "body" ? "active" : ""}`} onClick={() => onTab("body")}>
          body
        </button>
        <button className={`tab ${tab === "auth" ? "active" : ""}`} onClick={() => onTab("auth")}>
          auth
        </button>
        <button className={`tab ${tab === "script" ? "active" : ""}`} onClick={() => onTab("script")}>
          script
        </button>
        <button className={`tab ${tab === "capture" ? "active" : ""}`} onClick={() => onTab("capture")}>
          capture <span className="tab-count">{Object.keys(effective.capture ?? {}).length}</span>
        </button>
        <button className={`tab ${tab === "assert" ? "active" : ""}`} onClick={() => onTab("assert")}>
          assertions <span className="tab-count">{assertions.length}</span>
        </button>
      </div>

      {tab === "params" && (
        <div className="tabpanel">
          <EditableKV
            rows={queryRows}
            onChange={(rows) => {
              setQueryRows(rows);
              onFieldChange("query", rowsToObject(rows));
            }}
            keyPlaceholder="param"
            varSuggestions={envVarNames}
          />
        </div>
      )}
      {tab === "headers" && (
        <div className="tabpanel">
          <EditableKV
            rows={headerRows}
            onChange={(rows) => {
              setHeaderRows(rows);
              onFieldChange("headers", rowsToObject(rows));
            }}
            keyPlaceholder="header"
            varSuggestions={envVarNames}
          />
        </div>
      )}
      {tab === "body" && (
        <div className="tabpanel">
          <BodyEditor body={effective.body} onChange={(body) => onFieldChange("body", body)} envVarNames={envVarNames} />
        </div>
      )}
      {tab === "auth" && (
        <div className="tabpanel">
          <AuthEditor auth={effective.auth} onChange={(auth) => onFieldChange("auth", auth)} envVarNames={envVarNames} />
        </div>
      )}
      {tab === "script" && (
        <div className="tabpanel">
          <ScriptEditor script={effective.script} onChange={(script) => onFieldChange("script", script)} />
        </div>
      )}
      {tab === "capture" && (
        <div className="tabpanel">
          <CaptureEditor capture={effective.capture} onChange={(capture) => onFieldChange("capture", capture)} />
        </div>
      )}
      {tab === "assert" && (
        <div className="tabpanel">
          <AssertionsEditor assertions={assertions} onChange={(next) => onFieldChange("assertions", next)} />
        </div>
      )}
      </div>

      <div
        className="resize-handle horiz"
        onPointerDown={onResponseDragStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="resize response panel"
      />

      <div className="response" style={{ height: responseHeight }}>
        <div className="response-head">
          <span className="response-label">response</span>
          {result?.response ? (
            <>
              <span className={`pill ${statusClass(result.response.status)}`}>
                {result.response.status} {result.response.statusText}
              </span>
              <span className="time">{result.response.durationMs}ms</span>
              <span className="bytes">{result.response.bodyText.length}b</span>
            </>
          ) : result?.error ? (
            <span className="err" style={{ margin: 0 }}>
              {result.error}
            </span>
          ) : (
            <span className="muted">not sent yet.</span>
          )}
          <span className="spacer" />
          {contract.state === "ok" && <span className="contract-badge ok">✓ contract</span>}
          {contract.state === "fail" && <span className="contract-badge fail">✗ contract</span>}
          {contract.state === "none" && <span className="contract-badge none">no schema linked</span>}
        </div>

        <div className="response-scroll">
          {result?.response ? (
            <>
              <div className="tabs">
                <button className={`tab ${respTab === "body" ? "active" : ""}`} onClick={() => onRespTab("body")}>
                  body
                </button>
                <button className={`tab ${respTab === "headers" ? "active" : ""}`} onClick={() => onRespTab("headers")}>
                  headers <span className="tab-count">{Object.keys(result.response.headers).length}</span>
                </button>
                <span className="spacer" />
                <button className="btn ghost small" onClick={downloadResponse} title="save response body to a file">
                  ⇩ save
                </button>
                <button className="btn ghost small copy-btn" onClick={() => void copyResponse()} title="copy to clipboard">
                  {copied ? "copied ✓" : "copy"}
                </button>
              </div>
              <div className="response-body-wrap">
                {respTab === "body" ? (
                  <JsonBlock text={prettyBody(result.response.bodyText)} />
                ) : (
                  <KV obj={result.response.headers} />
                )}

                {result.assertions.length > 0 && (
                  <div className="results-block">
                    <div className="results-title">assertions</div>
                    <div className="asserts">
                      {result.assertions.map((a, i) => (
                        <div key={i} className={`assert ${a.ok ? "ok" : "bad"}`}>
                          <span className="tick">{a.ok ? "✓" : "✗"}</span>
                          <span className="atype">{a.type}</span>
                          <span className="amsg">{a.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {captured.length > 0 && (
                  <div className="captured">
                    <span className="captured-title">captured</span>
                    {captured.map(([k, v]) => (
                      <span key={k} className="captured-chip">
                        <span className="k">{k}</span>
                        <span className="muted">=</span>
                        <span className="v">{String(v)}</span>
                      </span>
                    ))}
                    <span className="captured-hint">→ available to later requests</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="response-placeholder muted">
              {result?.error ? "no response body — see the error above." : "send the request to see its response here."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KV({ obj }: { obj: Record<string, string | number | boolean> }) {
  return (
    <div className="kv">
      {Object.entries(obj).map(([k, v]) => (
        <div className="kv-row" key={k}>
          <span className="kv-k">{k}</span>
          <span className="kv-v">{String(v)}</span>
        </div>
      ))}
    </div>
  );
}
