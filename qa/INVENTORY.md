# qa/INVENTORY.md — exhaustive testable inventory (Phase 0)

Code-derived. Each item has a stable ID, its inputs/branches, and the attack categories that must hit it.
Status: `done` = every applicable category exercised AND inside coverage/mutation thresholds; `partial`
= some categories or below threshold; `gap` = untested.

Legend for categories: F=functional, FZ=fuzz/input, C=concurrency, L=load, S=security, A=api/contract,
ST=state/lifecycle, U=ui/a11y, O=observability.

## ENTRY POINTS

### CLI (`packages/cli/src`) — `truspec <cmd>`
| ID | Entry | Inputs | Branches/edges | Categories | Status |
|----|-------|--------|----------------|------------|--------|
| CLI-run | `run <path>` | path, --env, --spec, --json, --reporter(junit/json/human), --output, --timeout | bad args→2, no path→2, env-missing→1, 0 reqs→1, ok→0/1, reporter switch | F,FZ,A,S,O | partial (91% L / 90% B) |
| CLI-drift | `drift <dir> --spec [--live] [--json]` | dir, spec, --live, --json, --min | no spec→2, drift→1, --live probe, --json | F,A,O | partial (77% L / 61% B) |
| CLI-coverage | `coverage <dir> --spec [--min] [--json]` | dir, spec, --min, --json | no spec→2, below-min→1, --json | F,A,O | partial (73% L / 44% B) |
| CLI-contract | `contract <dir> --spec [--env] [--json]` | dir, spec, env, timeout, --json | no spec→2, violations→1, error→1 | F,A | partial (85% L / 75% B) |
| CLI-gen | `gen --spec --out [--base-url-var]` | spec, out, baseUrlVar | missing args→2, write files | F,FZ,A | partial (75% L / 55% B) |
| CLI-import | `import <postman\|bruno> <path> [--out] [--dry-run]` | source, path, out, dry-run | bad source→2, not-found→1, dry-run, write | F,FZ | partial (75% L / 73% B) |
| CLI-mock | `mock --spec [--port] [--delay] [--validate]` | spec, port, delay, validate | start server, errors | F,A,S | partial (72% L / 54% B) |
| CLI-serve | `serve [--dir] [--port] [--host]` | dir, port, host | start web server | F,S,U | **gap (0%)** |
| CLI-output | junit/json/human formatters | RunResult | XML escape, status class | F,S(xss/inj),O | partial (85% L / 65% B) |
| CLI-deps | arg helpers (`num`, `emit`, `resolveDeps`) | argv, deps | NaN timeout, output file | F | partial (92% L / 64% B) |

### Core library (`packages/core/src`) — exported functions
| ID | Function | Inputs | Invariants | Categories | Status |
|----|----------|--------|------------|------------|--------|
| CORE-parse | `parse.request/folderConfig/environment .parse/serialize/validate/safeParse` | YAML text / object | strict (unknown keys reject at every level), round-trip stable | F,FZ,A | done (98% L / 87% B) |
| CORE-validate | `validateAgainstSchema(value,schema,doc)` | untrusted JSON × OpenAPI subset | terminates linear (memo+cycle guard), no false neg on supported keywords | F,FZ,A,L(dos) | partial (93% L / 87% B) |
| CORE-resolve | `resolveRequest(req,opts)` | url/headers/query/body/auth + vars | query params reach server (before #frag), apikey-in-query preserved | F,FZ,S | done (99% L / 95% B) |
| CORE-run | `runRequest(req,ctx)` | req + fetch + timeout + maxBytes | never throws; redirect:manual; body cap streams; timeout aborts | F,FZ,C,L,S | done (99% L / 92% B) |
| CORE-assert | `evaluateAssertions(list,res,contract)` | status/header/jsonpath/body/duration/schema | invalid regex→clean fail (try/catch) | F,FZ,A | done (96% L / 90% B) |
| CORE-capture | `evaluateCaptures(map,res)` | jsonpath/header/status sources | missing→undefined (not captured) | F,FZ | partial (82% L / 77% B) |
| CORE-interpolate | `interpolate / interpolateDeep` | `{{var}}` templates, depth/cycles | single-pass (no re-injection), depth cap 256, own-prop guard | F,FZ,S | done (100%) |
| CORE-jsonpath | `jsonpath(root,path)` | `$.k['k'][n][*].*` | always terminates, own-prop guard | F,FZ | partial (90% L / 79% B) |
| CORE-script | pre/post `tr` vm | source + vars/response | 1s timeout both; not a security sandbox (trusted) | F,FZ,ST | done (98% L / 88% B) |
| CORE-openapi | `parseOpenApi / responseSchemaFor / resolveRef` | OpenAPI YAML/JSON | hostile doc→clean throw/skip | F,FZ,A | partial (100% L / 78% B) |
| CORE-drift | `computeDrift / refMatchesOp / normalizeKey` | spec ops × collection ops | unlinked excluded; operationId/key match | F,A | partial (95% L / 84% B) |
| CORE-coverage | `computeCoverage` | ops × colOps, minPercent | 0 ops→100%; round | F,A | partial (100% L / 85% B) |
| CORE-collection | `collectionOperations / requestQueryParams` | parsed requests | `!req.spec` excluded | F | partial (100% L / 71% B) |
| CORE-live | `probeLiveOperations` | ops, baseUrl, fetch | GET/HEAD only (no mutation), 404/405/0→missing | F,S(ssrf) | partial (93% L / 76% B) |
| CORE-scaffold | `scaffoldFromSpec / writeScaffold` | spec text → request stubs | unique filenames (dedup), name=key||id non-empty | F,FZ,A | partial (93% L / 84% B) |
| CORE-report | `driftReport / coverageReport / contractReport` | dir + spec | aggregate; empty handling | F,A,O | partial (79% L / 63% B) |
| CORE-mock-engine | `createMockResponder / generateExample / pathToRegex / pickResponse` | OpenAPI text → routes | status clamp 200–599, route specificity, depth-6 example cap, no ReDoS | F,FZ,A,L(dos) | partial (87% L / 72% B) |
| CORE-mock-server | `startMockServer` | OpenAPI text, port, delay, validate | handler try/catch (no crash), drains in-flight | F,FZ,C,L,S | partial (74% L / 65% B) |
| CORE-importers | `importPostman / bruToRequest / importBrunoDir / writeImport` | Postman json / .bru text | never throw past guard; emits parse-able files; slug-confined paths | F,FZ,S | partial (89% L / 70% B) |
| CORE-workspace | `runPath / discoverRequests / loadFolderChain / buildVars / loadDotenv` | dir + env + secrets | re-entrant (no cross-call state); secret precedence (OS>env); redact ≥6ch | F,FZ,C,S,ST | partial (93% L / 87% B) |
| CORE-confine | `confinePath / walkDirSafe` | cwd + target | realpath-confined; symlink-cycle safe; escaped-root not traversed | F,S | partial (100% L / 83% B) |

### MCP server (`packages/mcp-server/src`)
| ID | Tool | Inputs | Trust boundary | Categories | Status |
|----|------|--------|----------------|------------|--------|
| MCP-tools | 11 tools (list/run/create/update/drift/coverage/contract/scaffold/mock start·stop) | tool args (untrusted from LLM) | writes confinePath; reads/runs un-confined (cross-project by design) | F,FZ,S,A | partial (96% L / 88% B) |
| MCP-server | `createServer` tool dispatch | MCP protocol | stdio (not browser → no CSRF) | F,A | partial (100% L / 60% B) |

### Web server (`packages/web/server`) — `truspec serve`
| ID | Route | Inputs | Trust boundary | Categories | Status |
|----|-------|--------|----------------|------------|--------|
| WEB-state | GET /api/state | — | loopback Host + Origin==Host guard; resilient to bad files | F,S,O | done (api 100% L) |
| WEB-getreq | GET /api/request?path | path | confinePath | F,S | done |
| WEB-savereq | POST /api/request | path,content | confinePath + schema validate; no folder.tspec; CSRF-guarded | F,FZ,C,S | done (concurrency tested) |
| WEB-run | POST /api/run | target,env | confinePath target; env unconfined (loopback only) | F,S | done |
| WEB-drift/cov | POST /api/drift,/api/coverage | spec | confinePath | F,A | done |
| WEB-static | GET /* | path | decode→normalize→confine; SPA fallback; MIME | F,S | partial (server.ts 74% L) |
| WEB-guards | host/origin/frame | Host, Origin headers | DNS-rebinding + CSRF + X-Frame-Options/CSP | S | done (live-browser verified) |
| WEB-client | React UI (App.tsx) | user interaction | XSS-escaped (react); a11y labeled; keyboard | U,S | partial (Playwright+axe; no DOM unit env) |
| WEB-client-api | `web/src/api.ts` fetch wrappers | — | same-origin | F | **gap (0%)** |

### VS Code extension (`packages/vscode/src`)
| ID | Item | Inputs | Categories | Status |
|----|------|--------|------------|--------|
| VSC-ext | `activate` + 4 commands + CodeLens | active file, config, picks | F,S | **gap (0%)** |
| VSC-render | `renderResults/Drift/Coverage` | run/drift/cov reports | S(xss),F | done (esc() + enableScripts:false) |

## STATES & TRANSITIONS
- ST-run: pre-script → resolve → fetch (redirect:manual) → read(capped) → assert → capture → post-script → result. Each stage error-isolated (never throws).
- ST-chain: capture(req N) → vars → req N+1 (ordered by `order` then path). Re-entrant per runPath.
- ST-mockserver: listen → respond(per request, guarded) → close(drains in-flight).
- ST-webserver: listen → (host/origin guard → route) → close.
- ST-editor (UI): closed → new/edit → draft → save(ok→refresh / err→stay) / cancel(Esc). Keyboard: Ctrl+Enter, Esc (document-level).

## EXTERNAL DEPENDENCIES & FAILURE MODES
- DEP-fetch (undici): timeout, reset, slow-loris body, decompression bomb, huge header, bad scheme → all caught→clean error (campaign 5).
- DEP-fs: missing/partial/symlink/traversal → confinePath/walkDirSafe; ENOENT→{}; bad parse→reported.
- DEP-yaml: hostile/anchors/`__proto__` → no pollution (Zod fresh objects).
- DEP-clock: injectable `now`; mock date-time examples are fixed strings (no tz drift).
- DEP-vscode: only in extension host (test gap).

## DATA INVARIANTS
- INV-1: a written .tspec.yaml always parses (serialize validates).
- INV-2: declared secrets (≥6ch) masked in all reported output fields.
- INV-3: query params authored by the user reach the server (not lost to #fragment).
- INV-4: mock always replies a valid final HTTP status (200–599).
- INV-5: validator terminates in time bounded by distinct (value,schema) pairs.
- INV-6: confinePath never resolves outside cwd (realpath).
- INV-7: cross-origin browser requests to the web API are refused (Origin==Host).

## CONFIG / ENV / FLAGS
- env files, project `.env`, OS env (precedence OS>.env>vars); `truspec.environment` (vscode); --host loopback vs exposed (guards step aside when non-loopback — documented).

## TRUST BOUNDARIES
- TB-1: collection files + specs + imported files + HTTP responses = untrusted bytes (parsers hardened).
- TB-2: scripts (pre/post) = trusted (your own collection; vm is not a sandbox — documented).
- TB-3: web UI = loopback-only; cross-origin/cross-port refused; not framable.
- TB-4: MCP tool args = semi-trusted (LLM, possibly prompt-injected); writes confined.
