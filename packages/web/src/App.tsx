import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  coverage as apiCoverage,
  drift as apiDrift,
  getRequest,
  getState,
  run as apiRun,
  saveRequest,
  type CoverageReport,
  type DriftReport,
  type RequestDetail,
  type RequestSummary,
  type RunResult,
  type WorkspaceRunResult,
  type WorkspaceState,
} from "./api";

type Theme = "dark" | "light";
type View = "request" | "spec";
type EditMode = "edit" | "new";

const NEW_TEMPLATE = `name: New request
method: GET
url: "{{baseUrl}}/path"
assertions:
  - { type: status, equals: 200 }
`;

const folderOf = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i === -1 ? "·" : path.slice(0, i);
};

const statusClass = (code: number): string => {
  if (code >= 500) return "s5";
  if (code >= 400) return "s4";
  if (code >= 300) return "s3";
  if (code >= 200) return "s2";
  return "s0";
};

const prettyBody = (text: string): string => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

export function App() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [env, setEnv] = useState("");
  const [spec, setSpec] = useState("");
  const [result, setResult] = useState<WorkspaceRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [driftRep, setDriftRep] = useState<DriftReport | null>(null);
  const [covRep, setCovRep] = useState<CoverageReport | null>(null);
  const [view, setView] = useState<View>("request");
  const [theme, setTheme] = useState<Theme>("dark");
  const [booted, setBooted] = useState(false);
  const [editing, setEditing] = useState<EditMode | null>(null);
  const [editorKey, setEditorKey] = useState(0); // bump to remount Editor with a fresh draft
  const [editorPath, setEditorPath] = useState("");
  const [editorText, setEditorText] = useState("");
  const [editorErr, setEditorErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    getState()
      .then((s) => {
        setState(s);
        if (s.environments[0]) setEnv(s.environments[0]);
        if (s.specs[0]) setSpec(s.specs[0]);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let ignore = false;
    getRequest(selected)
      .then((d) => {
        if (!ignore) setDetail(d);
      })
      .catch(() => {
        if (!ignore) setDetail(null);
      });
    return () => {
      ignore = true;
    };
  }, [selected]);

  const grouped = useMemo(() => {
    const map = new Map<string, RequestSummary[]>();
    for (const r of state?.requests ?? []) {
      const f = folderOf(r.path);
      const list = map.get(f) ?? [];
      list.push(r);
      map.set(f, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [state]);

  const resultFor = useMemo(() => {
    const m = new Map<string, RunResult>();
    for (const r of result?.results ?? []) if (r.filePath) m.set(r.filePath, r);
    return m;
  }, [result]);

  const doRun = useCallback(
    async (target?: string) => {
      setRunning(true);
      setView("request");
      setError(null);
      try {
        setResult(await apiRun(target, env || undefined));
      } catch (e) {
        setError(String(e));
      } finally {
        setRunning(false);
      }
    },
    [env],
  );

  const doSpec = useCallback(async () => {
    if (!spec) return;
    setView("spec");
    setError(null);
    try {
      const [d, c] = await Promise.all([apiDrift(spec), apiCoverage(spec)]);
      setDriftRep(d);
      setCovRep(c);
    } catch (e) {
      setError(String(e));
    }
  }, [spec]);

  const openEdit = useCallback(() => {
    if (!detail || !selected) return;
    setEditorPath(selected);
    setEditorText(detail.raw ?? "");
    setEditorErr(null);
    setEditorKey((k) => k + 1);
    setEditing("edit");
  }, [detail, selected]);

  const openNew = useCallback(() => {
    setEditorPath("new-request.tspec.yaml");
    setEditorText(NEW_TEMPLATE);
    setEditorErr(null);
    setEditorKey((k) => k + 1);
    setEditing("new");
  }, []);

  const doSave = useCallback(async (path: string, text: string) => {
    setSaving(true);
    setEditorErr(null);
    try {
      const res = await saveRequest(path, text);
      if (!res.ok) {
        setEditorErr(res.error ?? "save failed");
        return;
      }
      const saved = res.path ?? path;
      setState(await getState()); // refresh sidebar (picks up a new file)
      setDetail(await getRequest(saved)); // refresh the open request
      setSelected(saved);
      setView("request");
      setEditing(null);
    } catch (e) {
      setEditorErr(String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  // Deep-link boot actions (?run=all, ?view=spec, ?theme=light, ?new=1) — handy for demos/CI.
  useEffect(() => {
    if (!state || booted) return;
    setBooted(true);
    const p = new URLSearchParams(window.location.search);
    if (p.get("theme") === "light") setTheme("light");
    if (p.get("run") === "all") void doRun(undefined);
    if (p.get("view") === "spec" && state.specs[0]) void doSpec();
    if (p.get("new") === "1") openNew();
  }, [state, booted, doRun, doSpec, openNew]);

  const selectedResult = selected ? resultFor.get(state ? `${state.dir}/${selected}` : selected) : undefined;

  return (
    <div className="app">
      <header className="topbar">
        {/* The visible brand is decorative styling; this is the document's real top-level heading. */}
        <h1 className="sr-only">TruSpec — local-first API client</h1>
        <div className="brand">
          <span className="logo">◢◤</span>
          <span className="word">
            Tru<span className="accent">Spec</span>
          </span>
          <span className="tag">local-first api client</span>
        </div>
        <div className="controls">
          <label className="field">
            <span>env</span>
            <select value={env} onChange={(e) => setEnv(e.target.value)}>
              <option value="">(none)</option>
              {state?.environments.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <button className="btn run" disabled={running} onClick={() => doRun(undefined)}>
            {running ? "running…" : "▶ run all"}
          </button>
          <button className="btn ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="toggle theme">
            {theme === "dark" ? "☾" : "☀"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="rail-head">
            collections <span className="count">{state?.requests.length ?? 0}</span>
            <button className="newreq" onClick={openNew} title="new request">
              + new
            </button>
          </div>
          <div className="tree">
            {grouped.map(([folder, reqs]) => (
              <div className="group" key={folder}>
                <div className="group-name">{folder}</div>
                {reqs.map((r, i) => {
                  const res = state ? resultFor.get(`${state.dir}/${r.path}`) : undefined;
                  return (
                    <button
                      key={r.path}
                      className={`req ${selected === r.path ? "sel" : ""}`}
                      style={{ animationDelay: `${i * 18}ms` }}
                      onClick={() => {
                        setSelected(r.path);
                        setView("request");
                      }}
                    >
                      <span className={`m m-${r.method}`}>{r.method}</span>
                      <span className="rname">{r.name}</span>
                      {res && <span className={`dot ${res.ok ? "ok" : "bad"}`} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="rail-head spec-head">
            spec <span className="count">{state?.specs.length ?? 0}</span>
          </div>
          <div className="spec-pick">
            <select aria-label="OpenAPI spec" value={spec} onChange={(e) => setSpec(e.target.value)}>
              <option value="">(choose spec)</option>
              {state?.specs.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button className="btn small" disabled={!spec} onClick={doSpec}>
              analyze
            </button>
          </div>
        </aside>

        <main className="main">
          {editing ? (
            <Editor
              key={editorKey}
              mode={editing}
              initialPath={editorPath}
              initialText={editorText}
              err={editorErr}
              saving={saving}
              onSave={doSave}
              onCancel={() => {
                setEditing(null);
                setEditorErr(null);
              }}
            />
          ) : view === "spec" ? (
            <SpecView drift={driftRep} coverage={covRep} spec={spec} />
          ) : detail ? (
            <RequestView
              detail={detail}
              result={selectedResult}
              onRun={() => selected && doRun(selected)}
              onEdit={openEdit}
              running={running}
            />
          ) : (
            <div className="empty">
              <div className="empty-mark">◢◤</div>
              <p>select a request, or run the whole collection.</p>
              <p className="muted">requests execute server-side via @truspec/core — no CORS, fully local.</p>
              <button className="btn small" onClick={openNew}>
                + new request
              </button>
            </div>
          )}
        </main>

        <section className="results" aria-label="run results">
          <div className="rail-head">
            results
            {result && (
              <span className="rsum">
                <span className="ok">{result.passed}✓</span>
                {result.failed > 0 && <span className="bad">{result.failed}✗</span>}
              </span>
            )}
          </div>
          <div className="result-list">
            {error && <div className="err">{error}</div>}
            {!result && !error && <div className="muted pad">no run yet.</div>}
            {result?.results.map((r, i) => (
              <ResultRow key={`${r.filePath}-${i}`} r={r} />
            ))}
          </div>
        </section>
      </div>

      <footer className="statusline">
        <span className="seg dir" title={state?.dir}>
          {state ? shortDir(state.dir) : "…"}
        </span>
        <span className="seg">env: {env || "—"}</span>
        {result && (
          <span className="seg">
            {result.passed} passed · {result.failed} failed
          </span>
        )}
        {result?.missingSecrets.length ? (
          <span className="seg warn">missing secrets: {result.missingSecrets.join(", ")}</span>
        ) : null}
        <span className="seg grow" />
        <span className="seg brandlet">TruSpec</span>
      </footer>
    </div>
  );
}

function RequestView({
  detail,
  result,
  onRun,
  onEdit,
  running,
}: {
  detail: RequestDetail;
  result?: RunResult;
  onRun: () => void;
  onEdit: () => void;
  running: boolean;
}) {
  return (
    <div className="reqview">
      <div className="req-top">
        <span className={`m big m-${detail.method}`}>{detail.method}</span>
        <code className="url">{detail.url}</code>
        <button className="btn ghost small" onClick={onEdit} title="edit YAML">
          ✎ edit
        </button>
        <button className="btn run" disabled={running} onClick={onRun}>
          {running ? "…" : "▶ run"}
        </button>
      </div>
      {detail.docs && <p className="docs">{detail.docs}</p>}
      {detail.spec?.operation && (
        <div className="speclink">spec ▸ {detail.spec.operationId ?? detail.spec.operation}</div>
      )}

      {detail.headers && Object.keys(detail.headers).length > 0 && (
        <Section title="headers">
          <KV obj={detail.headers} />
        </Section>
      )}
      {detail.query && Object.keys(detail.query).length > 0 && (
        <Section title="query">
          <KV obj={detail.query} />
        </Section>
      )}
      {detail.assertions && detail.assertions.length > 0 && (
        <Section title={`assertions · ${detail.assertions.length}`}>
          <div className="asserts">
            {detail.assertions.map((a, i) => (
              <code key={i} className="assert-def">
                {JSON.stringify(a)}
              </code>
            ))}
          </div>
        </Section>
      )}

      {result?.response && (
        <Section title="response">
          <Response r={result} />
        </Section>
      )}
    </div>
  );
}

function Editor({
  mode,
  initialPath,
  initialText,
  err,
  saving,
  onSave,
  onCancel,
}: {
  mode: EditMode;
  initialPath: string;
  initialText: string;
  err: string | null;
  saving: boolean;
  onSave: (path: string, text: string) => void;
  onCancel: () => void;
}) {
  // Draft lives here (seeded once per mount via key) so keystrokes don't re-render App.
  const [path, setPath] = useState(initialPath);
  const [text, setText] = useState(initialText);
  const save = () => {
    const p = path.trim();
    if (p) onSave(p, text);
  };
  // "Esc to cancel" / "⌘/Ctrl+Enter to save" (per the hint) must work the moment the editor is open —
  // not only when the textarea happens to be focused. A keydown handler scoped to the textarea misses
  // the path input, the buttons, and the just-opened state (focus still on the "+ new" button). A
  // document-level listener covers all of those; refs keep it calling the latest save/cancel without
  // re-binding on every keystroke.
  const saveRef = useRef(save);
  saveRef.current = save;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelRef.current();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        saveRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="editor">
      <div className="editor-bar">
        <span className="editor-title">{mode === "new" ? "new request" : "edit request"}</span>
        {mode === "new" ? (
          <input
            className="path-input"
            aria-label="file path"
            value={path}
            spellCheck={false}
            placeholder="folder/name.tspec.yaml"
            onChange={(e) => setPath(e.target.value)}
          />
        ) : (
          <code className="path-fixed">{path}</code>
        )}
        <span className="grow" />
        <button className="btn ghost small" onClick={onCancel} disabled={saving}>
          cancel
        </button>
        <button className="btn run small" onClick={save} disabled={saving || !path.trim()}>
          {saving ? "saving…" : "save"}
        </button>
      </div>
      <textarea
        className="editor-text"
        aria-label="request YAML"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      {err ? <div className="editor-err">{err}</div> : <div className="editor-hint muted">validated against the schema on save · ⌘/Ctrl+Enter to save · Esc to cancel</div>}
    </div>
  );
}

function Response({ r }: { r: RunResult }) {
  const res = r.response;
  if (!res) return r.error ? <div className="err">{r.error}</div> : null;
  return (
    <div className="resp">
      <div className="resp-meta">
        <span className={`pill ${statusClass(res.status)}`}>
          {res.status} {res.statusText}
        </span>
        <span className="time">{res.durationMs}ms</span>
        <span className="bytes">{res.bodyText.length}b</span>
      </div>
      <pre className="body">{prettyBody(res.bodyText)}</pre>
      {r.assertions.length > 0 && (
        <div className="asserts">
          {r.assertions.map((a, i) => (
            <div key={i} className={`assert ${a.ok ? "ok" : "bad"}`}>
              <span className="tick">{a.ok ? "✓" : "✗"}</span>
              <span className="atype">{a.type}</span>
              <span className="amsg">{a.message}</span>
            </div>
          ))}
        </div>
      )}
      {r.captured && (
        <div className="captured">
          captured: {Object.entries(r.captured).map(([k, v]) => `${k}=${String(v)}`).join("  ")}
        </div>
      )}
    </div>
  );
}

function ResultRow({ r }: { r: RunResult }) {
  return (
    <div className={`rrow ${r.ok ? "ok" : "bad"}`}>
      <span className="tick">{r.ok ? "✓" : "✗"}</span>
      <span className="rrow-name">{r.name}</span>
      {r.response && <span className={`pill mini ${statusClass(r.response.status)}`}>{r.response.status}</span>}
      {r.response && <span className="time">{r.response.durationMs}ms</span>}
      {r.error && <span className="rerr">{r.error}</span>}
      {!r.ok &&
        r.assertions.filter((a) => !a.ok).map((a, i) => (
          <span key={i} className="rfail">
            ✗ {a.message}
          </span>
        ))}
    </div>
  );
}

function SpecView({ drift, coverage, spec }: { drift: DriftReport | null; coverage: CoverageReport | null; spec: string }) {
  if (!drift || !coverage) return <div className="empty">analyzing {spec}…</div>;
  return (
    <div className="specview">
      <div className="spec-title">
        <span className="m big m-GET" style={{ visibility: "hidden" }}>
          x
        </span>
        <code className="url">{spec}</code>
        <span className={`pill ${drift.ok ? "s2" : "s4"}`}>{drift.ok ? "no drift" : "drift"}</span>
      </div>

      <Section title={`coverage · ${coverage.percent}%`}>
        <div className="cov-bar">
          <div className="cov-fill" style={{ width: `${coverage.percent}%` }} />
        </div>
        <div className="cov-meta">
          {coverage.covered.length}/{coverage.total} operations tested
        </div>
        {coverage.uncovered.length > 0 && (
          <div className="oplist">
            {coverage.uncovered.map((o) => (
              <code key={o} className="op bad">
                ✗ {o}
              </code>
            ))}
          </div>
        )}
      </Section>

      <Section title="drift">
        <DriftList label="untracked in collection" items={drift.added} sym="+" cls="amber" />
        <DriftList label="stale (not in spec)" items={drift.removed} sym="−" cls="red" />
        <DriftList label="changed" items={drift.changed} sym="~" cls="amber" />
        {drift.liveMissing && <DriftList label="missing from live API" items={drift.liveMissing} sym="✗" cls="red" />}
        {drift.ok && <div className="muted pad">collection matches the spec.</div>}
      </Section>
    </div>
  );
}

function DriftList({ label, items, sym, cls }: { label: string; items: string[]; sym: string; cls: string }) {
  if (items.length === 0) return null;
  return (
    <div className="drift-group">
      <div className="drift-label">
        {label} <span className="count">{items.length}</span>
      </div>
      <div className="oplist">
        {items.map((o) => (
          <code key={o} className={`op ${cls}`}>
            {sym} {o}
          </code>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sec">
      <div className="sec-head">{title}</div>
      <div className="sec-body">{children}</div>
    </section>
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

const shortDir = (dir: string): string => {
  const parts = dir.split("/").filter(Boolean);
  return parts.length <= 2 ? dir : `…/${parts.slice(-2).join("/")}`;
};
