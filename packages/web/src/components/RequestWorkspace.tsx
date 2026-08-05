import { useEffect, useState } from "react";
import type { RequestDetail, RunResult, SaveResult } from "../api";
import { AuthEditor } from "./AuthEditor";
import { BodyEditor } from "./BodyEditor";
import { EditableKV, objectToRows, rowsToObject, type KVRow } from "./EditableKV";
import { JsonBlock, prettyBody, statusClass } from "../format-utils";

export type ReqTab = "params" | "headers" | "body" | "auth" | "script" | "assert";
export type RespTab = "body" | "headers";

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

function describeAssertion(a: Record<string, unknown>): string {
  const { type: _type, ...rest } = a;
  const parts = Object.entries(rest).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return parts.join(", ") || "—";
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
  onRun: () => void;
  onEdit: () => void;
  onTab: (t: ReqTab) => void;
  onRespTab: (t: RespTab) => void;
  onGotoSpec: () => void;
}) {
  const effective = draft;
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

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
    <div className="reqview">
      <div className="req-top">
        <div className="url-bar">
          <span className={`m m-${effective.method}`}>{effective.method}</span>
          <code className="url">{effective.url}</code>
        </div>
        <button className="btn ghost" onClick={onEdit} title="edit YAML source">
          ✎ edit
        </button>
        <button className="btn run" disabled={running} onClick={onRun}>
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
      </div>
      {effective.docs && <p className="docs">{effective.docs}</p>}

      {dirty && (
        <div className="dirty-bar">
          <span>unsaved changes</span>
          <span className="spacer" />
          {saveErr && <span className="err" style={{ margin: 0 }}>{saveErr}</span>}
          <button className="btn ghost small" disabled={saving} onClick={discard}>
            discard
          </button>
          <button className="btn run small" disabled={saving} onClick={() => void doSave()}>
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
          />
        </div>
      )}
      {tab === "body" && (
        <div className="tabpanel">
          <BodyEditor body={effective.body} onChange={(body) => onFieldChange("body", body)} />
        </div>
      )}
      {tab === "auth" && (
        <div className="tabpanel">
          <AuthEditor auth={effective.auth} onChange={(auth) => onFieldChange("auth", auth)} />
        </div>
      )}
      {tab === "script" && (
        <div className="tabpanel">
          <ScriptView script={effective.script} />
        </div>
      )}
      {tab === "assert" && (
        <div className="tabpanel">
          {assertions.length > 0 ? (
            <div className="asserts">
              {assertions.map((a, i) => (
                <div key={i} className="assert-def">
                  <span className="atype">{String(a.type)}</span>
                  <code>{describeAssertion(a)}</code>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted pad">no assertions on this request.</div>
          )}
        </div>
      )}

      <div className="response">
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

        {result?.response && (
          <>
            <div className="tabs">
              <button className={`tab ${respTab === "body" ? "active" : ""}`} onClick={() => onRespTab("body")}>
                body
              </button>
              <button className={`tab ${respTab === "headers" ? "active" : ""}`} onClick={() => onRespTab("headers")}>
                headers <span className="tab-count">{Object.keys(result.response.headers).length}</span>
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
        )}
      </div>
    </div>
  );
}

function ScriptView({ script }: { script?: RequestDetail["script"] }) {
  if (!script?.pre && !script?.post) {
    return <div className="muted pad">no pre-request or post-response script on this request.</div>;
  }
  return (
    <>
      {script.pre && (
        <div className="script-block">
          <div className="type-row">
            <span className="type-label">pre-request</span>
          </div>
          <pre className="body">{script.pre}</pre>
        </div>
      )}
      {script.post && (
        <div className="script-block">
          <div className="type-row">
            <span className="type-label">post-response</span>
          </div>
          <pre className="body">{script.post}</pre>
        </div>
      )}
    </>
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
