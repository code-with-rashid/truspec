import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  type AssertionResult,
  type FlowState,
  type FlowStep,
  getFlow,
  getRequest,
  importBruno,
  importPostman,
  type RequestDetail,
  type RunResult,
} from "./api";

const ROW_H = 60;
const LANE_W = 14;
const RAIL_PAD = 10;

interface Edge {
  from: number;
  to: number;
  name: string;
  lane: number;
}

/** A step's *effective* value for a captured name is the LAST prior step to capture it —
 * matching `workspace/run.ts`'s `vars = {...vars, ...result.captured}` forward-chaining — so
 * the edge is drawn from the nearest preceding producer, not every producer. */
function buildEdges(steps: FlowStep[]): Edge[] {
  const lastProducer = new Map<string, number>();
  const edges: Omit<Edge, "lane">[] = [];
  for (const [i, step] of steps.entries()) {
    for (const name of step.consumes) {
      const from = lastProducer.get(name);
      if (from !== undefined) edges.push({ from, to: i, name });
    }
    for (const name of step.captures) lastProducer.set(name, i);
  }
  return assignLanes(edges);
}

/** Greedy interval-graph lane packing (git-log-graph style): reuse the lowest lane whose
 * last edge has already ended above this edge's start, else open a new lane. */
function assignLanes(edges: Omit<Edge, "lane">[]): Edge[] {
  const sorted = [...edges].sort((a, b) => a.from - b.from || a.to - b.to);
  const laneEnds: number[] = [];
  return sorted.map((e) => {
    let lane = laneEnds.findIndex((end) => end < e.from);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e.to);
    } else {
      laneEnds[lane] = e.to;
    }
    return { ...e, lane };
  });
}

type EdgeStatus = "unrun" | "ok" | "broken";

function edgeStatus(e: Edge, steps: FlowStep[], getResult: (path: string) => RunResult | undefined): EdgeStatus {
  const producerStep = steps[e.from];
  const producer = producerStep && getResult(producerStep.path);
  if (!producer) return "unrun";
  if (!producer.ok || producer.captured?.[e.name] === undefined) return "broken";
  return "ok";
}

function describeAssertion(a: Record<string, unknown>): string {
  const { type: _type, ...rest } = a;
  const parts = Object.entries(rest).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return parts.join(", ") || "—";
}

function captureSourceText(source: unknown): string {
  if (typeof source === "string") return source;
  if (source && typeof source === "object") {
    if ("jsonpath" in source) return String((source as { jsonpath: unknown }).jsonpath);
    if ("header" in source) return `header: ${String((source as { header: unknown }).header)}`;
    if ("status" in source) return "status";
  }
  return "—";
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "imported";
}

interface FlowViewProps {
  env: string;
  running: boolean;
  onRun: () => void;
  getResult: (path: string) => RunResult | undefined;
  onImported: () => void;
}

interface PendingImport {
  kind: "postman" | "bruno";
  files: Array<{ path: string; content: string }>;
  /** Best-effort count from walking the parsed collection client-side — no server round-trip
   * needed just to preview, since the importer has no separate "dry run" mode. */
  requestCount: number;
  sourceName: string;
  targetDir: string;
}

/** Walks a Postman v2.1 collection's `item` tree (folders nest via their own `item` array; a leaf
 * has a `request`) to count requests without asking the server — purely for the review step. */
function countPostmanRequests(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const items = (node as { item?: unknown[] }).item;
  if (!Array.isArray(items)) return 0;
  let count = 0;
  for (const it of items) {
    if (it && typeof it === "object" && "request" in it) count += 1;
    else count += countPostmanRequests(it);
  }
  return count;
}

export function FlowView({ env, running, onRun, getResult, onImported }: FlowViewProps) {
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const postmanRef = useRef<HTMLInputElement>(null);
  const brunoRef = useRef<HTMLInputElement | null>(null);

  const refresh = (): void => {
    getFlow()
      .then((f) => {
        setFlow(f);
        setLoadErr(null);
      })
      .catch((e: unknown) => setLoadErr(String(e)));
  };

  useEffect(refresh, []);

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

  const steps = flow?.steps ?? [];
  const edges = useMemo(() => buildEdges(steps), [steps]);
  const laneCount = edges.reduce((m, e) => Math.max(m, e.lane + 1), 0);
  const railWidth = RAIL_PAD * 2 + Math.max(laneCount, 1) * LANE_W;
  const selectedIdx = selected ? steps.findIndex((s) => s.path === selected) : -1;
  const selectedStep = selectedIdx >= 0 ? steps[selectedIdx] : undefined;

  const yOf = (i: number): number => i * ROW_H + ROW_H / 2;
  const orderedEdges = useMemo(() => {
    // Draw edges touching the selected step last so they render on top of unrelated ones.
    const touches = (e: Edge): boolean => e.from === selectedIdx || e.to === selectedIdx;
    return [...edges].sort((a, b) => Number(touches(a)) - Number(touches(b)));
  }, [edges, selectedIdx]);

  const consumesWithProducer = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) if (e.to === selectedIdx) set.add(e.name);
    return set;
  }, [edges, selectedIdx]);

  async function confirmImport(): Promise<void> {
    if (!pendingImport) return;
    const { kind, files, targetDir } = pendingImport;
    const dir = targetDir.trim();
    if (!dir) return;
    setImportBusy(true);
    setImportMsg(null);
    try {
      const r = kind === "postman" ? await importPostman(JSON.parse(files[0]?.content ?? "null"), dir) : await importBruno(files, dir);
      if (!r.ok) {
        setImportMsg(`Import failed: ${r.error ?? "unknown error"}`);
        return;
      }
      const n = r.stats?.requests ?? 0;
      setImportMsg(`Imported ${n} request${n === 1 ? "" : "s"} into ${dir}/` + (r.warnings?.length ? ` (${r.warnings.length} warning${r.warnings.length === 1 ? "" : "s"})` : ""));
      setPendingImport(null);
      refresh();
      onImported();
    } catch (e) {
      setImportMsg(`Import failed: ${String(e)}`);
    } finally {
      setImportBusy(false);
    }
  }

  function cancelPendingImport(): void {
    setPendingImport(null);
    setImportMsg(null);
  }

  async function onPostmanFile(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportMsg(null);
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setImportMsg("Import failed: not valid JSON");
      return;
    }
    const sourceName = (parsed as { info?: { name?: string } })?.info?.name ?? file.name.replace(/\.json$/, "");
    setPendingImport({
      kind: "postman",
      files: [{ path: file.name, content: text }],
      requestCount: countPostmanRequests(parsed),
      sourceName,
      targetDir: slugify(sourceName),
    });
  }

  async function onBrunoDir(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const fileList = Array.from(e.target.files ?? []);
    e.target.value = "";
    const [firstFile] = fileList;
    if (!firstFile) return;
    setImportMsg(null);
    const firstPath = (firstFile as unknown as { webkitRelativePath?: string }).webkitRelativePath ?? firstFile.name;
    const root = firstPath.split("/")[0] || "imported";
    const files: Array<{ path: string; content: string }> = [];
    for (const f of fileList) {
      const rel = ((f as unknown as { webkitRelativePath?: string }).webkitRelativePath ?? f.name).split("/").slice(1).join("/");
      if (!rel.toLowerCase().endsWith(".bru")) continue;
      files.push({ path: rel, content: await f.text() });
    }
    if (files.length === 0) {
      setImportMsg("Import failed: no .bru files found in that folder");
      return;
    }
    setPendingImport({
      kind: "bruno",
      files,
      requestCount: files.length,
      sourceName: root,
      targetDir: slugify(root),
    });
  }

  return (
    <div className="flow">
      <div className="flow-toolbar">
        <button className="btn run" disabled={running || steps.length === 0} onClick={onRun}>
          {running ? "running…" : "▸ run flow"}
        </button>
        <span className="muted">{env ? `env: ${env}` : "no environment selected"}</span>
        <span className="grow" />
        <button className="btn ghost small" onClick={() => setImportOpen(true)}>
          + import collection
        </button>
      </div>

      {loadErr && <div className="editor-err">{loadErr}</div>}
      {flow && flow.errors.length > 0 && (
        <div className="flow-errors">
          {flow.errors.map((er) => (
            <div key={er.path}>
              <span className="pill s5 mini">broken</span> <code>{er.path}</code> — {er.error}
            </div>
          ))}
        </div>
      )}

      {flow && steps.length === 0 ? (
        <div className="empty">
          <div className="empty-mark">→</div>
          <div>no requests here yet.</div>
          <div className="muted">import a Postman or Bruno collection, or add requests, to see the flow.</div>
          <button className="btn run" onClick={() => setImportOpen(true)}>
            + import collection
          </button>
        </div>
      ) : (
        <div className="flow-body">
          <div className="flow-graph">
            <svg className="flow-rail" width={railWidth} height={steps.length * ROW_H} aria-hidden="true">
              {orderedEdges.map((e, i) => {
                const laneX = RAIL_PAD + e.lane * LANE_W + LANE_W / 2;
                const y1 = yOf(e.from);
                const y2 = yOf(e.to);
                const status = edgeStatus(e, steps, getResult);
                const hi = e.from === selectedIdx || e.to === selectedIdx;
                return (
                  <path
                    key={`${e.from}-${e.to}-${e.name}-${i}`}
                    d={`M ${railWidth} ${y1} C ${laneX} ${y1}, ${laneX} ${y2}, ${railWidth} ${y2}`}
                    className={`edge ${status} ${hi ? "hi" : ""}`}
                  >
                    <title>{`{{${e.name}}}`}</title>
                  </path>
                );
              })}
            </svg>
            <div className="flow-steps">
              {steps.map((s, i) => {
                const res = getResult(s.path);
                return (
                  <button
                    key={s.path}
                    className={`flow-node ${selected === s.path ? "active" : ""}`}
                    style={{ height: ROW_H }}
                    onClick={() => setSelected(s.path)}
                  >
                    <span className="flow-node-order">{i + 1}</span>
                    <span className={`m m-${s.method}`}>{s.method}</span>
                    <span className="flow-node-main">
                      <span className="flow-node-name">{s.name}</span>
                      <code className="flow-node-url">{s.url}</code>
                    </span>
                    {res ? (
                      <span className={`pill ${res.ok ? "s2" : "s5"} mini`}>
                        {res.ok ? "pass" : "fail"}
                        {res.response ? ` · ${res.response.status}` : ""}
                      </span>
                    ) : (
                      <span className="pill s0 mini">not run</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flow-detail">
            {!detail || !selectedStep ? (
              <div className="muted pad">select a step to inspect it.</div>
            ) : (
              <FlowDetail step={selectedStep} detail={detail} result={getResult(selectedStep.path)} linked={consumesWithProducer} />
            )}
          </div>
        </div>
      )}

      {importOpen && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (importBusy) return;
            setImportOpen(false);
            setPendingImport(null);
            setImportMsg(null);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>import a collection</span>
              <button
                className="btn ghost small"
                disabled={importBusy}
                onClick={() => {
                  setImportOpen(false);
                  setPendingImport(null);
                  setImportMsg(null);
                }}
              >
                close
              </button>
            </div>
            <div className="modal-body">
              {pendingImport ? (
                <>
                  <p className="muted">
                    found {pendingImport.requestCount}{" "}
                    {pendingImport.kind === "postman"
                      ? `request${pendingImport.requestCount === 1 ? "" : "s"}`
                      : `.bru file${pendingImport.requestCount === 1 ? "" : "s"}`}{" "}
                    in <code>{pendingImport.sourceName}</code>.
                  </p>
                  <div className="kv">
                    <div className="kv-row">
                      <span className="kv-k">import into</span>
                      <input
                        autoFocus
                        className="kv-input"
                        spellCheck={false}
                        value={pendingImport.targetDir}
                        onChange={(e) => setPendingImport({ ...pendingImport, targetDir: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && void confirmImport()}
                      />
                    </div>
                  </div>
                  <p className="captured-hint" style={{ marginTop: 9 }}>
                    writes new <code>.tspec.yaml</code> files under this folder in the current workspace —
                    nothing elsewhere is touched.
                  </p>
                  {importMsg && <div className="editor-err">{importMsg}</div>}
                  <div className="modal-actions">
                    <button className="btn ghost" disabled={importBusy} onClick={cancelPendingImport}>
                      back
                    </button>
                    <button
                      className="btn run"
                      disabled={importBusy || !pendingImport.targetDir.trim()}
                      onClick={() => void confirmImport()}
                    >
                      {importBusy ? "importing…" : `import ${pendingImport.requestCount} request${pendingImport.requestCount === 1 ? "" : "s"}`}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted">Converts an existing collection into `.tspec.yaml` files and adds it to this workspace.</p>
                  <div className="modal-actions">
                    <button className="btn" disabled={importBusy} onClick={() => postmanRef.current?.click()}>
                      postman collection (.json)
                    </button>
                    <button className="btn" disabled={importBusy} onClick={() => brunoRef.current?.click()}>
                      bruno collection (folder)
                    </button>
                  </div>
                  <input ref={postmanRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onPostmanFile(e)} />
                  <input
                    ref={(el) => {
                      brunoRef.current = el;
                      if (el) {
                        el.setAttribute("webkitdirectory", "");
                        el.setAttribute("directory", "");
                      }
                    }}
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={(e) => void onBrunoDir(e)}
                  />
                  {importMsg && <div className={importMsg.startsWith("Import failed") ? "editor-err" : "muted"}>{importMsg}</div>}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FlowDetail({
  step,
  detail,
  result,
  linked,
}: {
  step: FlowStep;
  detail: RequestDetail;
  result?: RunResult;
  linked: Set<string>;
}) {
  const assertionRows: Array<{ ok?: boolean; text: string }> = result
    ? result.assertions.map((a: AssertionResult) => ({ ok: a.ok, text: `${a.type} — ${a.message}` }))
    : (detail.assertions ?? []).map((a) => ({ text: `${String(a.type)} — ${describeAssertion(a)}` }));

  return (
    <div className="flow-detail-inner">
      <div className="flow-detail-head">
        <span className={`m m-${step.method}`}>{step.method}</span>
        <span className="flow-detail-name">{step.name}</span>
      </div>
      <code className="flow-detail-url">{result?.request.url ?? step.url}</code>
      {detail.docs && <p className="muted">{detail.docs}</p>}
      {result?.error && <div className="editor-err">{result.error}</div>}

      <div className="flow-detail-section">
        <div className="flow-detail-label">captures</div>
        {step.captures.length === 0 ? (
          <div className="muted">none</div>
        ) : (
          <div className="kv">
            {step.captures.map((name) => (
              <div className="kv-row" key={name}>
                <span className="kv-k">{name}</span>
                <span className="kv-v">
                  {captureSourceText(detail.capture?.[name])}
                  {result?.captured && name in result.captured ? ` → ${String(result.captured[name])}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flow-detail-section">
        <div className="flow-detail-label">consumes</div>
        {step.consumes.length === 0 ? (
          <div className="muted">none</div>
        ) : (
          <div className="chips">
            {step.consumes.map((name) => (
              <span key={name} className={`pill chip ${linked.has(name) ? "s2" : "s0"}`}>
                {linked.has(name) ? "← " : ""}
                {`{{${name}}}`}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flow-detail-section">
        <div className="flow-detail-label">assertions {result ? "(last run)" : `(${assertionRows.length})`}</div>
        {assertionRows.length === 0 ? (
          <div className="muted">none declared</div>
        ) : (
          <ul className="flow-assertions">
            {assertionRows.map((a, i) => (
              <li key={i} className={a.ok === false ? "s5" : a.ok === true ? "s2" : ""}>
                {a.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
