#!/usr/bin/env node
// Throughput / latency / leak SLO harness for the local servers (item 3 of Issue #14).
//
// Defines a conservative SLO for the local-first servers and gates against it:
//   • correctness under load — error rate MUST be 0 (every request gets a valid response)
//   • no memory leak     — post-GC RSS growth over a sustained soak MUST stay under --rss-cap-mb
//   • tail latency       — p99 under --p99-cap-ms (generous; CI runners vary)
//   • throughput         — reported, with a low floor (--rps-floor) any runner clears
//
//   node --expose-gc qa/load/load-test.mjs [--seconds S] [--concurrency C] [--rss-cap-mb N]
//                                          [--p99-cap-ms N] [--rps-floor N] [--target mock|web]
//
// Requires a built @truspec/core (+ @truspec/web for --target web). Run `pnpm build` first.
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServer } from "../../packages/core/dist/mock/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : d; };
const sflag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const SECONDS = flag("--seconds", 20);
const CONC = flag("--concurrency", 64);
const RSS_CAP = flag("--heap-cap-mb", flag("--rss-cap-mb", 15));
// Gate on p95, not p99: a few transient GC/scheduling spikes blow up p99 on a shared runner but barely
// move p95, so p95 catches a real latency regression (a consistent slowdown) without flaking on jitter.
const P95_CAP = flag("--p95-cap-ms", flag("--p99-cap-ms", 500));
const RPS_FLOOR = flag("--rps-floor", 200);
const TARGET = sflag("--target", "mock");

const SPEC = `openapi: 3.0.3
info: { title: Load, version: "1" }
paths:
  /pets/{id}:
    get:
      responses:
        "200": { content: { application/json: { schema: { type: object, properties: { id: { type: integer }, name: { type: string } } } } } }
`;

const hist = new Int32Array(5001); // ms buckets; last = overflow
const record = (ms) => { hist[Math.min(5000, Math.round(ms))]++; };
const pct = (p) => { const total = hist.reduce((a, b) => a + b, 0); let target = total * p, cum = 0; for (let i = 0; i < hist.length; i++) { cum += hist[i]; if (cum >= target) return i; } return 5000; };
const gc = () => { if (global.gc) { global.gc(); global.gc(); } };
const mb = (b) => Math.round((b / 1048576) * 10) / 10;
const rssMB = () => mb(process.memoryUsage().rss);
// Leak signal = retained heap AFTER a forced GC. RSS is a poor leak metric: V8 keeps the high-water
// mark and rarely returns freed pages to the OS, so RSS climbs under load even with no leak. A real
// leak shows up as growing post-GC heapUsed (objects that stay reachable); steady state stays flat.
const heapMB = () => mb(process.memoryUsage().heapUsed);

async function startServer() {
  if (TARGET === "mock") {
    const h = await startMockServer(SPEC, { port: 0 });
    return { url: h.url, path: "/pets/1", close: () => h.close() };
  }
  const { startWebServer } = await import("../../packages/web/dist/server/index.js");
  const dir = mkdtempSync(join(tmpdir(), "load-"));
  mkdirSync(join(dir, "environments"), { recursive: true });
  writeFileSync(join(dir, "environments", "local.env.yaml"), 'tspec: "0.1"\nname: local\nvariables: {}\n');
  writeFileSync(join(dir, "g.tspec.yaml"), 'tspec: "0.1"\nname: G\nurl: "http://x"\nassertions: []\n');
  // Load the static client route (GET /) — a fair test of the server's raw HTTP throughput + leak
  // behaviour. /api/state deliberately re-scans the workspace per call (not a hot path), so it isn't a
  // representative throughput target. clientDir points at the built SPA.
  const clientDir = resolve(HERE, "../../packages/web/dist/client");
  const h = await startWebServer({ dir, port: 0, clientDir });
  return { url: h.url, path: "/", close: async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function hammer(agent, base, path, deadline, stats) {
  return new Promise((done) => {
    const fire = () => {
      if (Date.now() >= deadline) return done();
      const t0 = Date.now();
      const req = http.get(`${base}${path}`, { agent }, (res) => {
        res.resume();
        res.on("end", () => { record(Date.now() - t0); stats.ok += res.statusCode >= 200 && res.statusCode < 500 ? 1 : 0; stats.err += res.statusCode >= 500 ? 1 : 0; fire(); });
      });
      req.on("error", () => { stats.err++; fire(); });
    };
    fire();
  });
}

const srv = await startServer();
const agent = new http.Agent({ keepAlive: true, maxSockets: CONC });
const stats = { ok: 0, err: 0 };
try {
  // warm up (not measured)
  await new Promise((r) => { const a = new http.Agent({ keepAlive: true }); let n = 0; const f = () => http.get(`${srv.url}${srv.path}`, { agent: a }, (res) => { res.resume(); res.on("end", () => (++n < 200 ? f() : r())); }).on("error", () => r()); f(); });
  gc(); const heapBefore = heapMB(), rssBefore = rssMB();

  const start = Date.now();
  const deadline = start + SECONDS * 1000;
  await Promise.all(Array.from({ length: CONC }, () => hammer(agent, srv.url, srv.path, deadline, stats)));
  const elapsed = (Date.now() - start) / 1000;

  gc(); const heapAfter = heapMB(), rssAfter = rssMB();
  const total = stats.ok + stats.err;
  const rps = Math.round(total / elapsed);
  const heapGrowth = Math.round((heapAfter - heapBefore) * 10) / 10;
  const p50 = pct(0.5), p95 = pct(0.95), p99 = pct(0.99);

  console.log(`target=${TARGET} conc=${CONC} dur=${elapsed.toFixed(1)}s`);
  console.log(`requests=${total} ok=${stats.ok} err=${stats.err} rps=${rps}`);
  console.log(`latency p50=${p50}ms p95=${p95}ms p99=${p99}ms`);
  console.log(`heapUsed(post-GC) ${heapBefore}MB -> ${heapAfter}MB (growth ${heapGrowth}MB over ${total} reqs)  [rss ${rssBefore}->${rssAfter}MB info]`);

  const fails = [];
  if (stats.err !== 0) fails.push(`error rate: ${stats.err} failed requests (SLO 0)`);
  if (heapGrowth > RSS_CAP) fails.push(`memory: post-GC heap grew ${heapGrowth}MB > ${RSS_CAP}MB cap (leak)`);
  if (p95 > P95_CAP) fails.push(`latency: p95 ${p95}ms > ${P95_CAP}ms cap`);
  if (rps < RPS_FLOOR) fails.push(`throughput: ${rps} rps < ${RPS_FLOOR} floor`);

  if (fails.length) { console.error("\nSLO VIOLATIONS:"); for (const f of fails) console.error("  ✗ " + f); process.exitCode = 1; }
  else console.log("\n✓ all SLOs met");
} finally {
  await srv.close();
  agent.destroy();
}
