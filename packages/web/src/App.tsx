import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  coverage as apiCoverage,
  drift as apiDrift,
  getRequest,
  getState,
  mockLog as apiMockLog,
  mockStart as apiMockStart,
  mockStatus as apiMockStatus,
  mockStop as apiMockStop,
  run as apiRun,
  saveRequest,
  type CoverageReport,
  type DriftReport,
  type MockLogEntry,
  type MockStatus,
  type RequestAuth,
  type RequestBody,
  type RequestDetail,
  type RequestSummary,
  type RunResult,
  type WorkspaceState,
} from "./api";
import { FlowView } from "./FlowView";

type Theme = "dark" | "light";
type View = "workspace" | "spec" | "mock" | "flow";
type EditMode = "edit" | "new";
type ReqTab = "params" | "headers" | "body" | "auth" | "assert";
type RespTab = "body" | "headers";
type RailTab = "spec" | "runs";

const NEW_TEMPLATE = `name: New request
method: GET
url: "{{baseUrl}}/path"
assertions:
  - { type: status, equals: 200 }
`;

/** Server paths are OS-native (`\` on Windows); normalize before splitting/comparing on the client. */
const normPath = (path: string): string => path.replace(/\\/g, "/");

const folderOf = (path: string): string => {
  const p = normPath(path);
  const i = p.lastIndexOf("/");
  return i === -1 ? "·" : p.slice(0, i);
};

const baseName = (dir: string): string => {
  const parts = normPath(dir).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? dir;
};

interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  requests: RequestSummary[];
}

/** Real nested tree (not a flat "a/b/c" label) so the sidebar can show a collapsible hierarchy like Bruno's. */
function buildFolderTree(requests: RequestSummary[]): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: [], requests: [] };
  const index = new Map<string, FolderNode>([["", root]]);
  for (const r of requests) {
    const p = normPath(r.path);
    const slash = p.lastIndexOf("/");
    const dir = slash === -1 ? "" : p.slice(0, slash);
    const segments = dir ? dir.split("/") : [];
    let parent = root;
    let acc = "";
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      let node = index.get(acc);
      if (!node) {
        node = { name: seg, path: acc, folders: [], requests: [] };
        index.set(acc, node);
        parent.folders.push(node);
      }
      parent = node;
    }
    parent.requests.push(r);
  }
  const sortRec = (n: FolderNode): void => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.folders.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

function countRequests(node: FolderNode): number {
  return node.requests.length + node.folders.reduce((sum, f) => sum + countRequests(f), 0);
}

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

interface Token {
  t: string;
  cls: string;
}

/** Lightweight JSON syntax highlighter — keys/strings/numbers/booleans/punctuation get a color. */
function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],])|(\s+)|([^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let cls = "tok-plain";
    if (m[1]) cls = "tok-key";
    else if (m[2]) cls = "tok-str";
    else if (m[3]) cls = "tok-num";
    else if (m[4]) cls = "tok-bool";
    else if (m[5]) cls = "tok-punct";
    out.push({ t: m[0], cls });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

function JsonBlock({ text }: { text: string }) {
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <pre className="body">
      {tokens.map((tok, i) => (
        <span key={i} className={tok.cls}>
          {tok.t}
        </span>
      ))}
    </pre>
  );
}

function describeAssertion(a: Record<string, unknown>): string {
  const { type: _type, ...rest } = a;
  const parts = Object.entries(rest).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return parts.join(", ") || "—";
}

/** A request's tie to its spec operation is the same string `driftReport` uses for `removed`. */
function specRefOf(detail: Pick<RequestDetail, "spec" | "name"> | null): string | undefined {
  if (!detail?.spec) return undefined;
  return detail.spec.operation ?? detail.spec.operationId ?? detail.name;
}

interface ContractInfo {
  state: "ok" | "fail" | "none";
  note: string;
}

/** Mirrors `truspec run --spec`: derive the contract badge from the auto-injected `schema` assertion. */
function contractInfo(detail: RequestDetail | null, result?: RunResult): ContractInfo {
  if (!detail?.spec) return { state: "none", note: "no spec operation linked" };
  const schemaResult = result?.assertions.find((a) => a.type === "schema");
  if (!schemaResult) return { state: "none", note: "not yet validated — select a spec, then run" };
  if (schemaResult.ok && schemaResult.message.includes("(skipped)")) {
    return { state: "none", note: schemaResult.message };
  }
  return { state: schemaResult.ok ? "ok" : "fail", note: schemaResult.message };
}

interface SpecOpRow {
  key: string;
  method: string;
  path: string;
  badge: "tested" | "changed" | "untested";
}

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 480;
const MIN_RAIL = 260;
const MAX_RAIL = 560;

/** Drag-to-resize for a grid column's pixel width, persisted across sessions. */
function usePanelWidth(storageKey: string, initial: number, min: number, max: number, invert: boolean) {
  const [size, setSize] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved >= min && saved <= max ? saved : initial;
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, String(size));
  }, [storageKey, size]);

  const onDragStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startSize = size;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: PointerEvent): void => {
        const delta = ev.clientX - startX;
        setSize(Math.min(max, Math.max(min, startSize + (invert ? -delta : delta))));
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
    [size, min, max, invert],
  );

  return [size, onDragStart] as const;
}

export function App() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [env, setEnv] = useState("");
  const [spec, setSpec] = useState("");
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<{ missingSecrets: string[] } | null>(null);
  const [ranResults, setRanResults] = useState<Map<string, RunResult>>(new Map());
  const [driftRep, setDriftRep] = useState<DriftReport | null>(null);
  const [covRep, setCovRep] = useState<CoverageReport | null>(null);
  const [view, setView] = useState<View>("workspace");
  const [theme, setTheme] = useState<Theme>("dark");
  const [booted, setBooted] = useState(false);
  const [editing, setEditing] = useState<EditMode | null>(null);
  const [editorKey, setEditorKey] = useState(0); // bump to remount Editor with a fresh draft
  const [editorPath, setEditorPath] = useState("");
  const [editorText, setEditorText] = useState("");
  const [editorErr, setEditorErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<ReqTab>("params");
  const [respTab, setRespTab] = useState<RespTab>("body");
  const [railTab, setRailTab] = useState<RailTab>("spec");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQ, setPaletteQ] = useState("");
  const [mock, setMock] = useState<MockStatus>({ running: false });
  const [mockEntries, setMockEntries] = useState<MockLogEntry[]>([]);
  const [mockBusy, setMockBusy] = useState(false);
  const [mockErr, setMockErr] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [sidebarW, sidebarDrag] = usePanelWidth("truspec.sidebarWidth", 270, MIN_SIDEBAR, MAX_SIDEBAR, false);
  const [railW, railDrag] = usePanelWidth("truspec.railWidth", 340, MIN_RAIL, MAX_RAIL, true);

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
    apiMockStatus()
      .then(setMock)
      .catch(() => {});
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

  // A chosen spec drives the header badge, the right rail, and the spec dashboard — analyze it
  // as soon as it's picked rather than waiting for the user to open the spec tab.
  useEffect(() => {
    if (!spec) {
      setDriftRep(null);
      setCovRep(null);
      return;
    }
    let ignore = false;
    Promise.all([apiDrift(spec), apiCoverage(spec)])
      .then(([d, c]) => {
        if (!ignore) {
          setDriftRep(d);
          setCovRep(c);
        }
      })
      .catch((e: unknown) => {
        if (!ignore) setError(String(e));
      });
    return () => {
      ignore = true;
    };
  }, [spec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        setPaletteQ("");
      } else if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  // Poll the request log while the mock view is open and the server is live.
  useEffect(() => {
    if (view !== "mock" || !mock.running) return;
    let cancelled = false;
    const tick = (): void => {
      apiMockLog()
        .then((r) => {
          if (!cancelled) setMockEntries(r.log);
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [view, mock.running]);

  const resultKey = useCallback((path: string) => normPath(state ? `${state.dir}/${path}` : path), [state]);

  const tree = useMemo(() => buildFolderTree(state?.requests ?? []), [state]);
  const collectionName = state ? baseName(state.dir) : "";

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const doRun = useCallback(
    async (target?: string) => {
      setRunning(true);
      setError(null);
      try {
        const r = await apiRun(target, env || undefined, spec || undefined);
        setLastRun({ missingSecrets: r.missingSecrets });
        setRanResults((prev) => {
          const next = new Map(prev);
          for (const res of r.results) if (res.filePath) next.set(normPath(res.filePath), res);
          return next;
        });
        // A run triggered from the Flow view should stay there — only workspace-triggered
        // runs (or the top-bar "run all") jump to the runs rail.
        setView((v) => (v === "flow" ? v : "workspace"));
        setRailTab("runs");
      } catch (e) {
        setError(String(e));
      } finally {
        setRunning(false);
      }
    },
    [env, spec],
  );

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
      setView("workspace");
      setEditing(null);
    } catch (e) {
      setEditorErr(String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const doMockStart = useCallback(async () => {
    if (!spec) return;
    setMockBusy(true);
    setMockErr(null);
    try {
      const r = await apiMockStart(spec);
      if (!r.ok) {
        setMockErr(r.error ?? "failed to start the mock server");
        return;
      }
      setMock(r);
    } catch (e) {
      setMockErr(String(e));
    } finally {
      setMockBusy(false);
    }
  }, [spec]);

  const doMockStop = useCallback(async () => {
    setMockBusy(true);
    setMockErr(null);
    try {
      await apiMockStop();
      setMock({ running: false });
      setMockEntries([]);
    } catch (e) {
      setMockErr(String(e));
    } finally {
      setMockBusy(false);
    }
  }, []);

  const toggleMock = useCallback(() => {
    if (mock.running) void doMockStop();
    else void doMockStart();
  }, [mock.running, doMockStart, doMockStop]);

  // Deep-link boot actions (?run=all, ?view=spec|mock, ?theme=light, ?new=1) — handy for demos/CI.
  useEffect(() => {
    if (!state || booted) return;
    setBooted(true);
    const p = new URLSearchParams(window.location.search);
    if (p.get("theme") === "light") setTheme("light");
    if (p.get("run") === "all") void doRun(undefined);
    const v = p.get("view");
    if (v === "spec" || v === "mock" || v === "flow") setView(v);
    if (p.get("new") === "1") openNew();
  }, [state, booted, doRun, openNew]);

  const selectedResult = selected ? ranResults.get(resultKey(selected)) : undefined;

  const runRows = useMemo(() => {
    if (!state) return [];
    return state.requests
      .map((r) => ({ r, res: ranResults.get(resultKey(r.path)) }))
      .filter((x): x is { r: RequestSummary; res: RunResult } => !!x.res)
      .map(({ r, res }) => ({
        path: r.path,
        name: r.name,
        method: r.method,
        ok: res.ok,
        status: res.response?.status,
        ms: res.response?.durationMs,
        onSelect: () => {
          setSelected(r.path);
          setView("workspace");
        },
      }));
  }, [state, ranResults, resultKey]);

  const runStats = useMemo(() => {
    let passed = 0;
    let failed = 0;
    for (const r of ranResults.values()) (r.ok ? passed++ : failed++);
    return { passed, failed, total: passed + failed };
  }, [ranResults]);

  const driftCount = driftRep ? driftRep.added.length + driftRep.removed.length + driftRep.changed.length : 0;

  const specOps: SpecOpRow[] = useMemo(() => {
    if (!covRep) return [];
    const changedKeys = new Set((driftRep?.changed ?? []).map((c) => c.split(":")[0]));
    const all = [
      ...covRep.covered.map((k) => ({ key: k, covered: true })),
      ...covRep.uncovered.map((k) => ({ key: k, covered: false })),
    ];
    return all
      .map(({ key, covered }) => {
        const spaceAt = key.indexOf(" ");
        const method = spaceAt === -1 ? key : key.slice(0, spaceAt);
        const path = spaceAt === -1 ? "" : key.slice(spaceAt + 1);
        const changed = changedKeys.has(key);
        const badge: SpecOpRow["badge"] = covered ? (changed ? "changed" : "tested") : "untested";
        return { key, method, path, badge };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [covRep, driftRep]);

  const activeSpecRef = specRefOf(detail);
  const isStale = !!activeSpecRef && !!driftRep?.removed.includes(activeSpecRef);
  const contract = contractInfo(detail, selectedResult);

  const paletteItems = useMemo(() => {
    const q = paletteQ.trim().toLowerCase();
    return (state?.requests ?? []).filter((r) => !q || `${r.name} ${r.method} ${r.url}`.toLowerCase().includes(q));
  }, [state, paletteQ]);

  const jumpTo = useCallback((path: string) => {
    setSelected(path);
    setView("workspace");
    setTab("params");
    setRespTab("body");
    setPaletteOpen(false);
  }, []);

  const showRail = view === "workspace" && !editing;

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
          <span className="tag">spec-synced api client</span>
        </div>

        <nav className="nav">
          <button className={`nav-btn ${view === "workspace" ? "active" : ""}`} onClick={() => setView("workspace")}>
            workspace
          </button>
          <button className={`nav-btn ${view === "flow" ? "active" : ""}`} onClick={() => setView("flow")}>
            flow
          </button>
          <button className={`nav-btn ${view === "spec" ? "active" : ""}`} onClick={() => setView("spec")}>
            spec
          </button>
          <button className={`nav-btn ${view === "mock" ? "active" : ""}`} onClick={() => setView("mock")}>
            mock
          </button>
        </nav>

        <span className="spacer" />

        <button
          className="search-btn"
          onClick={() => {
            setPaletteOpen(true);
            setPaletteQ("");
          }}
        >
          <span className="muted">search</span>
          <kbd>⌘K</kbd>
        </button>

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

        {covRep && (
          <button className="spec-chip" title="OpenAPI coverage" onClick={() => setView("spec")}>
            <span className="spec-chip-label">spec</span>
            <span className="spec-chip-bar">
              <span className="spec-chip-fill" style={{ width: `${covRep.percent}%` }} />
            </span>
            <span className="spec-chip-pct">{covRep.percent}%</span>
          </button>
        )}

        <button className="btn run" disabled={running} onClick={() => doRun(undefined)}>
          {running ? "running…" : "▶ run all"}
        </button>
        <button className="btn ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="toggle theme">
          {theme === "dark" ? "☾" : "☀"}
        </button>
      </header>

      <div
        className={`workspace ${showRail ? "" : "no-rail"}`}
        style={{
          gridTemplateColumns: showRail
            ? `${sidebarW}px 5px minmax(0, 1fr) 5px ${railW}px`
            : `${sidebarW}px 5px minmax(0, 1fr)`,
        }}
      >
        <aside className="sidebar">
          <div className="rail-head collection-head" title={state?.dir}>
            <span className="collection-glyph">▣</span>
            <span className="collection-text">
              <span className="collection-name">{collectionName || "collection"}</span>
              <span className="collection-sub">{state?.requests.length ?? 0} requests</span>
            </span>
            <button className="newreq" onClick={openNew} title="new request">
              + new
            </button>
          </div>
          <div className="tree">
            <FolderTree
              node={tree}
              depth={0}
              collapsed={collapsedFolders}
              onToggle={toggleFolder}
              selected={selected}
              driftRep={driftRep}
              ranResults={ranResults}
              resultKey={resultKey}
              onSelect={(path) => {
                setSelected(path);
                setView("workspace");
                setTab("params");
                setRespTab("body");
              }}
            />
          </div>

          <div className="sidebar-foot">
            <div className="spec-pick">
              <span className="field">spec</span>
              <select aria-label="OpenAPI spec" value={spec} onChange={(e) => setSpec(e.target.value)}>
                <option value="">(choose spec)</option>
                {state?.specs.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            {covRep && (
              <div className="sidebar-bar">
                <span className="sidebar-bar-track">
                  <span className="sidebar-bar-fill" style={{ width: `${covRep.percent}%` }} />
                </span>
                <span className="muted">
                  {covRep.covered.length}/{covRep.total}
                </span>
                <button className="btn small" onClick={() => setView("spec")}>
                  analyze →
                </button>
              </div>
            )}
          </div>
        </aside>

        <div
          className="resize-handle"
          onPointerDown={sidebarDrag}
          role="separator"
          aria-orientation="vertical"
          aria-label="resize sidebar"
        />

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
          ) : view === "flow" ? (
            <FlowView
              env={env}
              running={running}
              onRun={() => doRun(undefined)}
              getResult={(path) => ranResults.get(resultKey(path))}
              onImported={() => {
                getState()
                  .then(setState)
                  .catch((e: unknown) => setError(String(e)));
              }}
            />
          ) : view === "spec" ? (
            <SpecDashboard spec={spec} driftRep={driftRep} covRep={covRep} specOps={specOps} driftCount={driftCount} />
          ) : view === "mock" ? (
            <MockView
              spec={spec}
              mock={mock}
              entries={mockEntries}
              busy={mockBusy}
              err={mockErr}
              onToggle={toggleMock}
              ops={specOps}
            />
          ) : detail ? (
            <RequestWorkspace
              detail={detail}
              result={selectedResult}
              running={running}
              tab={tab}
              respTab={respTab}
              activeSpecRef={activeSpecRef}
              isStale={isStale}
              contract={contract}
              onRun={() => selected && doRun(selected)}
              onEdit={openEdit}
              onTab={setTab}
              onRespTab={setRespTab}
              onGotoSpec={() => setView("spec")}
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

        {showRail && (
          <div
            className="resize-handle"
            onPointerDown={railDrag}
            role="separator"
            aria-orientation="vertical"
            aria-label="resize spec intelligence panel"
          />
        )}
        {showRail && (
          <section className="rail" aria-label="spec intelligence">
            <div className="rail-head">
              <span className="muted" style={{ color: "var(--lime)" }}>
                ⇄
              </span>
              spec intelligence
            </div>
            <div className="rail-body">
              {spec ? (
                <>
                  <div className="intel-card">
                    <div className="intel-card-head">
                      <span className="label">coverage</span>
                      <span className="intel-num">{covRep ? `${covRep.percent}%` : "…"}</span>
                    </div>
                    <div className="cov-bar">
                      <div className="cov-fill" style={{ width: `${covRep?.percent ?? 0}%` }} />
                    </div>
                    <div className="intel-sub">
                      {covRep ? `${covRep.covered.length}/${covRep.total}` : "…"} spec operations tested
                    </div>
                  </div>
                  <div className="drift-card">
                    <div className="drift-card-head">
                      drift
                      {driftRep &&
                        (driftRep.ok ? (
                          <span className="c-green">clean</span>
                        ) : (
                          <span className="c-amber">{driftCount} to resolve</span>
                        ))}
                    </div>
                    <div className="drift-mini-grid">
                      <button className="drift-mini" onClick={() => setView("spec")}>
                        <span className="n c-amber">{driftRep?.added.length ?? 0}</span>
                        <span className="l">untracked</span>
                      </button>
                      <button className="drift-mini" onClick={() => setView("spec")}>
                        <span className="n c-red">{driftRep?.removed.length ?? 0}</span>
                        <span className="l">stale</span>
                      </button>
                      <button className="drift-mini" onClick={() => setView("spec")}>
                        <span className="n c-violet">{driftRep?.changed.length ?? 0}</span>
                        <span className="l">changed</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="muted pad">choose an OpenAPI spec below to see coverage and drift.</div>
              )}
            </div>

            <div className="rail-tabs">
              <button className={`rail-tab ${railTab === "spec" ? "active" : ""}`} onClick={() => setRailTab("spec")}>
                this request
              </button>
              <button className={`rail-tab ${railTab === "runs" ? "active" : ""}`} onClick={() => setRailTab("runs")}>
                runs
              </button>
            </div>

            {railTab === "spec" ? (
              <div className="rail-panel">
                {!detail ? (
                  <div className="muted pad">select a request to see its spec status.</div>
                ) : !activeSpecRef ? (
                  <div className="muted pad">
                    not linked to a spec operation. Add a <code>spec:</code> block to enable drift + coverage tracking.
                  </div>
                ) : isStale ? (
                  <div className="stale-card">
                    <div className="stale-card-title">⚠ stale — not in current spec</div>
                    <p>
                      This request maps to no operation in <code>{spec}</code>. Either add the operation to the spec
                      or delete the request. CI&apos;s <code>drift</code> gate fails while it exists.
                    </p>
                  </div>
                ) : (
                  <div className="spec-op-card">
                    <div className="spec-op-head">
                      <span className={`m m-${detail.method}`}>{detail.method}</span>
                      <code>{detail.spec?.operationId ?? detail.spec?.operation}</code>
                    </div>
                    <div className="spec-op-body">
                      {contract.state === "ok" && <span className="c-green" style={{ fontSize: 11.5, fontWeight: 600 }}>✓ contract passes</span>}
                      {contract.state === "fail" && <span className="c-red" style={{ fontSize: 11.5, fontWeight: 600 }}>✗ contract failed</span>}
                      <p>{contract.note}</p>
                      <button className="btn small" onClick={() => setView("spec")}>
                        view in spec →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rail-panel">
                {runStats.total > 0 ? (
                  <>
                    <div className="rsum">
                      <span className="ok">{runStats.passed} passed</span>
                      {runStats.failed > 0 && <span className="bad">{runStats.failed} failed</span>}
                    </div>
                    <div className="result-list">
                      {runRows.map((row) => (
                        <RunRow key={row.path} row={row} />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty-runs">
                    <div style={{ marginBottom: 12 }}>nothing run yet.</div>
                    <button className="btn run" onClick={() => doRun(undefined)}>
                      ▶ run collection
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      <footer className="statusline">
        <span className="seg dir" title={state?.dir}>
          {state ? shortDir(state.dir) : "…"}
        </span>
        <span className="seg">env: {env || "—"}</span>
        {covRep && <span className="seg">coverage {covRep.percent}%</span>}
        {driftRep && (
          <span className="seg" style={{ color: driftRep.ok ? "var(--green)" : "var(--amber)" }}>
            {driftRep.ok ? "no drift" : `drift · ${driftCount}`}
          </span>
        )}
        {runStats.total > 0 && (
          <span className="seg">
            {runStats.passed} passed · {runStats.failed} failed
          </span>
        )}
        {lastRun?.missingSecrets.length ? (
          <span className="seg warn">missing secrets: {lastRun.missingSecrets.join(", ")}</span>
        ) : null}
        {error && <span className="seg warn">{error}</span>}
        <span className="seg grow" />
        <span className="seg">
          <span className={`dot ${mock.running ? "live" : "off"}`} />
          mock {mock.running ? `:${mock.port}` : "stopped"}
        </span>
        <span className="seg brandlet">TRUSPEC</span>
      </footer>

      {paletteOpen && (
        <CommandPalette
          query={paletteQ}
          onQuery={setPaletteQ}
          items={paletteItems}
          total={state?.requests.length ?? 0}
          onSelect={jumpTo}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

function CommandPalette({
  query,
  onQuery,
  items,
  total,
  onSelect,
  onClose,
}: {
  query: string;
  onQuery: (q: string) => void;
  items: RequestSummary[];
  total: number;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-head">
          <span className="glyph">⌕</span>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="jump to a request, run, or view…"
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list">
          {items.map((r) => (
            <button key={r.path} className="palette-item" onClick={() => onSelect(r.path)}>
              <span className={`m m-${r.method}`}>{r.method}</span>
              <span className="palette-item-main">
                <span className="palette-item-name">{r.name}</span>
                <code className="palette-item-url">{r.url}</code>
              </span>
              <span className="palette-item-folder">{folderOf(r.path)}</span>
            </button>
          ))}
          {items.length === 0 && <div className="palette-empty">no matches.</div>}
        </div>
        <div className="palette-foot">
          <span>
            <span className="n">{total}</span> requests
          </span>
          <span className="spacer" />
          <span>↵ open</span>
          <span>local-first · no telemetry</span>
        </div>
      </div>
    </div>
  );
}

function FolderTree({
  node,
  depth,
  collapsed,
  onToggle,
  selected,
  driftRep,
  ranResults,
  resultKey,
  onSelect,
}: {
  node: FolderNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  selected: string | null;
  driftRep: DriftReport | null;
  ranResults: Map<string, RunResult>;
  resultKey: (path: string) => string;
  onSelect: (path: string) => void;
}) {
  const indent = 8 + depth * 14;
  return (
    <>
      {node.folders.map((f) => {
        const isCollapsed = collapsed.has(f.path);
        return (
          <div key={f.path}>
            <button
              className="folder-row"
              style={{ paddingLeft: indent }}
              onClick={() => onToggle(f.path)}
              title={f.path}
            >
              <span className={`folder-chev ${isCollapsed ? "" : "open"}`}>▸</span>
              <span className="folder-icon">▤</span>
              <span className="folder-name">{f.name}</span>
              <span className="folder-count">{countRequests(f)}</span>
            </button>
            {!isCollapsed && (
              <FolderTree
                node={f}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                selected={selected}
                driftRep={driftRep}
                ranResults={ranResults}
                resultKey={resultKey}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
      {node.requests.map((r, i) => {
        const res = ranResults.get(resultKey(r.path));
        return (
          <button
            key={r.path}
            className={`req ${selected === r.path ? "sel" : ""}`}
            style={{ paddingLeft: indent + 8, animationDelay: `${i * 18}ms` }}
            onClick={() => onSelect(r.path)}
          >
            <span className={`m m-${r.method}`}>{r.method}</span>
            <span className="rname">{r.name}</span>
            {!!driftRep?.removed.includes(r.specRef ?? "") && <span className="stale-tag">stale</span>}
            {res && <span className={`dot ${res.ok ? "ok" : "bad"}`} />}
          </button>
        );
      })}
    </>
  );
}

function RequestWorkspace({
  detail,
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
  detail: RequestDetail;
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
  const headers = detail.headers ?? {};
  const query = detail.query ?? {};
  const assertions = detail.assertions ?? [];
  const captured = result?.captured ? Object.entries(result.captured) : [];

  return (
    <div className="reqview">
      <div className="req-top">
        <div className="url-bar">
          <span className={`m m-${detail.method}`}>{detail.method}</span>
          <code className="url">{detail.url}</code>
        </div>
        <button className="btn ghost" onClick={onEdit} title="edit YAML source">
          ✎ edit
        </button>
        <button className="btn run" disabled={running} onClick={onRun}>
          {running ? "…" : "▶ send"}
        </button>
      </div>

      <div className="req-meta">
        <span className="req-name">{detail.name}</span>
        {activeSpecRef && !isStale && (
          <button className="badge-link" onClick={onGotoSpec} title="linked OpenAPI operation">
            ⇄ {detail.spec?.operationId ?? detail.spec?.operation}
          </button>
        )}
        {isStale && <span className="badge-stale">⚠ not in current spec</span>}
      </div>
      {detail.docs && <p className="docs">{detail.docs}</p>}

      <div className="tabs">
        <button className={`tab ${tab === "params" ? "active" : ""}`} onClick={() => onTab("params")}>
          params <span className="tab-count">{Object.keys(query).length}</span>
        </button>
        <button className={`tab ${tab === "headers" ? "active" : ""}`} onClick={() => onTab("headers")}>
          headers <span className="tab-count">{Object.keys(headers).length}</span>
        </button>
        <button className={`tab ${tab === "body" ? "active" : ""}`} onClick={() => onTab("body")}>
          body
        </button>
        <button className={`tab ${tab === "auth" ? "active" : ""}`} onClick={() => onTab("auth")}>
          auth
        </button>
        <button className={`tab ${tab === "assert" ? "active" : ""}`} onClick={() => onTab("assert")}>
          assertions <span className="tab-count">{assertions.length}</span>
        </button>
      </div>

      {tab === "params" && (
        <div className="tabpanel">{Object.keys(query).length > 0 ? <KV obj={query} /> : <div className="muted pad">no query params.</div>}</div>
      )}
      {tab === "headers" && (
        <div className="tabpanel">
          {Object.keys(headers).length > 0 ? <KV obj={headers} /> : <div className="muted pad">no headers set on this request.</div>}
        </div>
      )}
      {tab === "body" && (
        <div className="tabpanel">
          <BodyView body={detail.body} />
        </div>
      )}
      {tab === "auth" && (
        <div className="tabpanel">
          <AuthView auth={detail.auth} />
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

function BodyView({ body }: { body?: RequestBody }) {
  if (!body || body.type === "none") return <div className="muted pad">no request body.</div>;
  if (body.type === "form") {
    return (
      <>
        <div className="type-row">
          <span className="type-label">type</span>
          <span className="type-chip">form</span>
        </div>
        <KV obj={body.content} />
      </>
    );
  }
  const text =
    body.type === "graphql"
      ? body.query + (body.variables ? "\n\n" + JSON.stringify(body.variables, null, 2) : "")
      : body.type === "text"
        ? body.content
        : JSON.stringify(body.content, null, 2);
  return (
    <>
      <div className="type-row">
        <span className="type-label">type</span>
        <span className="type-chip">{body.type}</span>
      </div>
      <JsonBlock text={text} />
    </>
  );
}

function AuthView({ auth }: { auth?: RequestAuth }) {
  if (!auth || auth.type === "none") return <div className="muted pad">none — inherits from folder config if present.</div>;
  return (
    <>
      <div className="type-row">
        <span className="type-label">scheme</span>
        <span className="scheme-chip">{auth.type}</span>
      </div>
      {auth.type === "bearer" && (
        <>
          <div className="kv">
            <div className="kv-row">
              <span className="kv-k">token</span>
              <span className="kv-v" style={{ color: "var(--lime)" }}>
                {auth.token}
              </span>
            </div>
          </div>
          <p className="captured-hint" style={{ marginTop: 9 }}>
            resolved from a captured variable at run time · secrets are masked in output.
          </p>
        </>
      )}
      {auth.type === "basic" && (
        <div className="kv">
          <div className="kv-row">
            <span className="kv-k">username</span>
            <span className="kv-v">{auth.username}</span>
          </div>
          <div className="kv-row">
            <span className="kv-k">password</span>
            <span className="kv-v">{auth.password}</span>
          </div>
        </div>
      )}
      {auth.type === "apikey" && (
        <div className="kv">
          <div className="kv-row">
            <span className="kv-k">name</span>
            <span className="kv-v">{auth.name}</span>
          </div>
          <div className="kv-row">
            <span className="kv-k">value</span>
            <span className="kv-v">{auth.value}</span>
          </div>
          <div className="kv-row">
            <span className="kv-k">in</span>
            <span className="kv-v">{auth.in}</span>
          </div>
        </div>
      )}
    </>
  );
}

function RunRow({
  row,
}: {
  row: { path: string; name: string; method: string; ok: boolean; status?: number; ms?: number; onSelect: () => void };
}) {
  return (
    <button className={`rrow ${row.ok ? "ok" : "bad"}`} onClick={row.onSelect}>
      <div className="rrow-top">
        <span className="tick">{row.ok ? "✓" : "✗"}</span>
        <span className={`m m-${row.method}`}>{row.method}</span>
        <span className="rrow-name">{row.name}</span>
        {row.status !== undefined && <span className={`rrow-status ${statusClass(row.status)}`}>{row.status}</span>}
        {row.ms !== undefined && <span className="muted">{row.ms}ms</span>}
      </div>
    </button>
  );
}

function SpecDashboard({
  spec,
  driftRep,
  covRep,
  specOps,
  driftCount,
}: {
  spec: string;
  driftRep: DriftReport | null;
  covRep: CoverageReport | null;
  specOps: SpecOpRow[];
  driftCount: number;
}) {
  if (!spec) {
    return (
      <div className="empty">
        <div className="empty-mark">◢◤</div>
        <p>choose an OpenAPI spec to analyze drift and coverage.</p>
      </div>
    );
  }
  if (!driftRep || !covRep) return <div className="empty muted">analyzing {spec}…</div>;

  return (
    <div className="specview">
      <div className="spec-title">
        <span className="glyph">⇄</span>
        <code>{spec}</code>
        {driftRep.ok ? <span className="pill s2">no drift</span> : <span className="pill s4">drift · {driftCount}</span>}
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card-head">coverage</div>
          <div className="stat-big-row">
            <span className="stat-big">{covRep.percent}%</span>
            <span className="stat-big-sub">
              {covRep.covered.length}/{covRep.total} operations
              <br />
              have a test
            </span>
          </div>
          <div className="cov-bar">
            <div className="cov-fill" style={{ width: `${covRep.percent}%` }} />
          </div>
          {covRep.uncovered.length > 0 && (
            <>
              <div className="cov-meta">untested:</div>
              <div className="oplist">
                {covRep.uncovered.map((o) => (
                  <code key={o} className="op amber">
                    ✗ {o}
                  </code>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="stat-card">
          <div className="stat-card-head">drift vs spec</div>
          <div className="drift-stat-grid">
            <div className="drift-stat">
              <span className="n c-amber">{driftRep.added.length}</span>
              <span className="l">untracked</span>
            </div>
            <div className="drift-stat">
              <span className="n c-red">{driftRep.removed.length}</span>
              <span className="l">stale</span>
            </div>
            <div className="drift-stat">
              <span className="n c-violet">{driftRep.changed.length}</span>
              <span className="l">changed</span>
            </div>
          </div>
          <p>
            CI runs <code>truspec drift</code> and exits non-zero on any of these — the build fails the moment code
            and spec disagree.
          </p>
        </div>
      </div>

      <div className="ops-block">
        <div className="section-head">
          operations <span className="muted">{covRep.total}</span>
        </div>
        <div className="ops-table">
          {specOps.map((o) => (
            <div className="op-row" key={o.key}>
              <span className={`m m-${o.method}`}>{o.method}</span>
              <code>{o.path}</code>
              <span className={`op-badge ${o.badge}`}>{o.badge}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="section-head">what to resolve</div>
        <div className="resolve-groups">
          {driftRep.added.length > 0 && (
            <div>
              <div className="resolve-group-head">
                <span className="resolve-dot amber" />
                <span className="resolve-title">Untracked in collection</span>
                <span className="resolve-sub">in the spec, no test yet</span>
              </div>
              <div className="resolve-items">
                {driftRep.added.map((o) => (
                  <code key={o} className="op amber">
                    + {o}
                  </code>
                ))}
              </div>
            </div>
          )}
          {driftRep.removed.length > 0 && (
            <div>
              <div className="resolve-group-head">
                <span className="resolve-dot red" />
                <span className="resolve-title">Stale — not in spec</span>
                <span className="resolve-sub">a request exists for an operation the spec dropped</span>
              </div>
              <div className="resolve-items">
                {driftRep.removed.map((o) => (
                  <code key={o} className="op red">
                    − {o}
                  </code>
                ))}
              </div>
            </div>
          )}
          {driftRep.changed.length > 0 && (
            <div>
              <div className="resolve-group-head">
                <span className="resolve-dot violet" />
                <span className="resolve-title">Signature changed</span>
                <span className="resolve-sub">params or schema differ from the request</span>
              </div>
              <div className="resolve-items">
                {driftRep.changed.map((o) => (
                  <code key={o} className="op violet">
                    ~ {o}
                  </code>
                ))}
              </div>
            </div>
          )}
          {driftRep.ok && <div className="muted pad">collection matches the spec.</div>}
        </div>
      </div>

      {driftRep.liveMissing && driftRep.liveMissing.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div className="section-head">missing from live API</div>
          <div className="oplist">
            {driftRep.liveMissing.map((o) => (
              <code key={o} className="op red">
                ✗ {o}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MockView({
  spec,
  mock,
  entries,
  busy,
  err,
  onToggle,
  ops,
}: {
  spec: string;
  mock: MockStatus;
  entries: MockLogEntry[];
  busy: boolean;
  err: string | null;
  onToggle: () => void;
  ops: SpecOpRow[];
}) {
  return (
    <div className="mockview">
      <div className="mock-card">
        <div className="mock-card-top">
          <div className="mock-dot-wrap">
            <span className={`dot ${mock.running ? "live" : "off"}`} />
          </div>
          <div className="mock-title-block">
            <span className="mock-title">Mock server</span>
            <span className="mock-sub">offline HTTP server generated from your spec</span>
          </div>
          <span className="spacer" />
          <span className="mock-state" style={{ color: mock.running ? "var(--green)" : "var(--dimmer)" }}>
            {mock.running ? "running" : "stopped"}
          </span>
          {mock.running && (
            <span className="mock-port">
              localhost:<span className="n">{mock.port}</span>
            </span>
          )}
          <button className="btn run" disabled={!spec || busy} onClick={onToggle}>
            {mock.running ? "■ stop" : "▶ start"}
          </button>
        </div>
        <div className="mock-cmd">
          <span className="prompt">$</span>
          <code>
            truspec mock --spec {spec || "<spec>"} --port {mock.port ?? 4000}
          </code>
        </div>
        <div className="mock-features">
          <span>✓ request validation</span>
          <span>✓ example responses from schema</span>
          <span>✓ configurable latency</span>
          <span>✓ no cloud, no account</span>
        </div>
        {!spec && <div className="mock-err" style={{ color: "var(--dim)" }}>choose an OpenAPI spec (below) to start the mock server.</div>}
        {err && <div className="mock-err">{err}</div>}
      </div>

      <div className="mock-grid">
        <div>
          <div className="section-head">
            routes <span className="muted">{ops.length}</span>
          </div>
          <div className="ops-table">
            {ops.map((o) => (
              <div className="op-row" key={o.key}>
                <span className={`m m-${o.method}`}>{o.method}</span>
                <code>{o.path}</code>
                <span className={`op-badge ${o.badge}`}>{o.badge}</span>
              </div>
            ))}
            {ops.length === 0 && <div className="muted pad">select a spec to see its routes.</div>}
          </div>
        </div>

        <div>
          <div className="section-head">request log</div>
          {mock.running ? (
            <>
              <div className="mock-log-wrap">
                {entries.map((h, i) => (
                  <div className="mock-log-row" key={i}>
                    <span className={`method m-${h.method}`}>{h.method}</span>
                    <code>{h.path}</code>
                    <span className={`status ${statusClass(h.status)}`}>{h.status}</span>
                    <span className="ms">{h.durationMs}ms</span>
                  </div>
                ))}
                {entries.length === 0 && <div className="muted pad">no requests yet — hit the mock server to see them here.</div>}
              </div>
              <p className="mock-log-hint">
                A <code>404</code> means request validation rejected a call that doesn&apos;t match the spec.
              </p>
            </>
          ) : (
            <div className="mock-empty">server stopped — start it to serve routes and log requests.</div>
          )}
        </div>
      </div>
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
  const parts = normPath(dir).split("/").filter(Boolean);
  return parts.length <= 2 ? dir : `…/${parts.slice(-2).join("/")}`;
};
