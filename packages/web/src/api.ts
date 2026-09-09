export interface RequestSummary {
  path: string;
  name: string;
  method: string;
  url: string;
  /** `spec.operation ?? spec.operationId ?? name` — matches a `DriftReport.removed` entry 1:1. */
  specRef?: string;
  assertions: number;
}

export interface WorkspaceState {
  dir: string;
  requests: RequestSummary[];
  /** Files under the collection that did not parse. They appear in no other list. */
  errors: Array<{ path: string; error: string }>;
  /** Relative paths of folders that have a `folder.tspec.yaml`, including empty ones (no requests yet). */
  folders: string[];
  environments: string[];
  specs: string[];
}

export interface AssertionResult {
  type: string;
  ok: boolean;
  message: string;
}

export interface RunResult {
  name: string;
  filePath?: string;
  request: { method: string; url: string };
  ok: boolean;
  error?: string;
  response?: {
    status: number;
    statusText: string;
    durationMs: number;
    bodyText: string;
    headers: Record<string, string>;
    /** Size as it arrived, in bytes — not the length of the decoded string. */
    bytes?: number;
    /** The body is not text; `bodyText` is a lossy decode of it and must not be shown as one. */
    binary?: boolean;
    /** The real bytes of a binary body, base64-encoded, when small enough to carry. */
    bodyBase64?: string;
  };
  assertions: AssertionResult[];
  captured?: Record<string, unknown>;
  /** Captures that matched nothing — the reason a later request fails on an unresolved variable. */
  missedCaptures?: Array<{ name: string; source: string; reason?: string }>;
}

export interface WorkspaceRunResult {
  results: RunResult[];
  passed: number;
  failed: number;
  ok: boolean;
  missingSecrets: string[];
}

export interface DriftReport {
  specOperations: number;
  collectionOperations: number;
  added: string[];
  removed: string[];
  changed: string[];
  liveMissing?: string[];
  ok: boolean;
}

export interface CoverageReport {
  total: number;
  covered: string[];
  uncovered: string[];
  /** The subset of `uncovered` a request points at but never asserts on — a different fix. */
  unasserted?: Array<{ op: string; request: string; filePath?: string }>;
  percent: number;
  ok: boolean;
}

export type RequestBody =
  | { type: "none" }
  | { type: "json"; content: unknown }
  | { type: "text"; content: string }
  | { type: "form"; content: Record<string, string> }
  | { type: "graphql"; query: string; variables?: Record<string, unknown> }
  | { type: "multipart"; fields: Record<string, MultipartField> };

/** One `multipart/form-data` part: a plain value, a file read at send time, or typed text. */
export type MultipartField =
  | string
  | number
  | boolean
  | { file: string; filename?: string; contentType?: string }
  | { text: string; filename?: string; contentType?: string };

export type RequestAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apikey"; name: string; value: string; in: "header" | "query" }
  | {
      type: "oauth2";
      grant: "client_credentials" | "password" | "refresh_token";
      tokenUrl: string;
      clientId?: string;
      clientSecret?: string;
      username?: string;
      password?: string;
      refreshToken?: string;
      scope?: string;
      audience?: string;
      clientAuth: "body" | "basic";
      extra?: Record<string, string>;
      scheme: string;
    };

export type CaptureSource = string | { jsonpath: string } | { header: string } | { status: true };

/** Per-request transport settings; mirrors `RequestOptions` in the core schema. */
export interface RequestOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
}

export interface RequestDetail {
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string | number | boolean>;
  query?: Record<string, string | number | boolean>;
  body?: RequestBody;
  assertions?: Array<Record<string, unknown>>;
  auth?: RequestAuth;
  capture?: Record<string, CaptureSource>;
  order?: number;
  /** Labels for `truspec run --tag`. */
  tags?: string[];
  /** Per-request transport options. */
  options?: RequestOptions;
  script?: { pre?: string; post?: string };
  docs?: string;
  spec?: { operation?: string; operationId?: string };
  /** Raw YAML source of the file, for the editor. */
  raw?: string;
  /**
   * Version tag of the exact bytes this detail was read from. Sent back on save so the server can
   * refuse to overwrite an edit that landed on disk in between (an agent, a `git pull`, another
   * editor) instead of silently discarding it.
   */
  version?: string;
}

/**
 * Strip the fields the client adds to a request detail — the raw YAML the editor round-trips and
 * the version tag used for conflict detection — before the object is validated as a request.
 * The schema is `.strict()`, so anything left over is rejected by name.
 */
export function requestFields(detail: RequestDetail): Record<string, unknown> {
  const { raw: _raw, version: _version, ...rest } = detail;
  return rest as unknown as Record<string, unknown>;
}

export interface SaveResult {
  ok: boolean;
  path?: string;
  error?: string;
  /** The save was refused because the file changed on disk; `current` is what is there now. */
  conflict?: boolean;
  current?: string;
}

export interface CreateFolderResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface RenameResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface DeleteResult {
  ok: boolean;
  error?: string;
}

export interface DuplicateResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface EnvironmentDetail {
  tspec: string;
  name: string;
  variables: Record<string, string | number | boolean>;
  secrets: string[];
  raw?: string;
}

export interface EnvSaveResult {
  ok: boolean;
  name?: string;
  error?: string;
}

export interface FolderConfigDetail {
  tspec: string;
  name?: string;
  baseUrl?: string;
  headers?: Record<string, string | number | boolean>;
  auth?: RequestAuth;
  raw?: string;
}

export interface MockStatus {
  running: boolean;
  spec?: string;
  port?: number;
  url?: string;
  routes?: number;
  delayMs?: number;
}

export interface MockLogEntry {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  at: number;
}

export interface MockStartResult extends MockStatus {
  ok: boolean;
  error?: string;
}

export interface FlowStep {
  path: string;
  name: string;
  method: string;
  url: string;
  order: number;
  docs?: string;
  assertions: number;
  /** Var names this step's `capture:` block saves. */
  captures: string[];
  /** `{{var}}` names this step references (url/headers/query/body/auth, folder-inherited too). */
  consumes: string[];
  specRef?: string;
}

export interface FlowState {
  dir: string;
  steps: FlowStep[];
  errors: Array<{ path: string; error: string }>;
}

export interface ImportApiResult {
  ok: boolean;
  error?: string;
  stats?: { requests: number; folders: number };
  warnings?: string[];
  files?: string[];
}

export interface EnvSecretStatus {
  name: string;
  resolved: boolean;
  source?: "env" | "dotenv";
}

export interface EnvironmentReport {
  name: string;
  path: string;
  variables: Record<string, string>;
  secrets: EnvSecretStatus[];
  unresolved: string[];
}

export interface EnvListReport {
  root: string;
  environments: EnvironmentReport[];
  errors: Array<{ path: string; error: string }>;
}

export interface CodegenTargetInfo {
  id: string;
  label: string;
  group: string;
  syntax: string;
}

export interface CodegenResult {
  ok: boolean;
  error?: string;
  lang?: string;
  label?: string;
  syntax?: string;
  code?: string;
}

/** Success is the raw Postman collection (no `ok` field); failure is `{ok:false,error}`. */
export type ExportPostmanResult = Record<string, unknown>;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const getState = () => api<WorkspaceState>("/api/state");
export const getFlow = () => api<FlowState>("/api/flow");
export const getEnvironments = () => api<EnvListReport>("/api/environments");
export const importPostman = (json: unknown, targetDir?: string) =>
  api<ImportApiResult>("/api/import/postman", { method: "POST", body: JSON.stringify({ json, targetDir }) });
export const importBruno = (files: Array<{ path: string; content: string }>, targetDir?: string) =>
  api<ImportApiResult>("/api/import/bruno", { method: "POST", body: JSON.stringify({ files, targetDir }) });
export const importInsomnia = (json: unknown, targetDir?: string) =>
  api<ImportApiResult>("/api/import/insomnia", { method: "POST", body: JSON.stringify({ json, targetDir }) });
export const importHar = (json: unknown, targetDir?: string, options?: Record<string, unknown>) =>
  api<ImportApiResult>("/api/import/har", { method: "POST", body: JSON.stringify({ json, targetDir, options }) });
export const importCurlText = (text: string, targetDir?: string, name?: string) =>
  api<ImportApiResult>("/api/import/curl", { method: "POST", body: JSON.stringify({ text, targetDir, name }) });
export const getRequest = (path: string) =>
  api<RequestDetail>(`/api/request?path=${encodeURIComponent(path)}`);
export const run = (target: string | undefined, env: string | undefined, spec?: string) =>
  api<WorkspaceRunResult>("/api/run", { method: "POST", body: JSON.stringify({ target, env, spec }) });
export const drift = (spec: string) =>
  api<DriftReport>("/api/drift", { method: "POST", body: JSON.stringify({ spec }) });
export const coverage = (spec: string) =>
  api<CoverageReport>("/api/coverage", { method: "POST", body: JSON.stringify({ spec }) });
export const saveRequest = (path: string, content: string, baseVersion?: string) =>
  api<SaveResult>("/api/request", { method: "POST", body: JSON.stringify({ path, content, baseVersion }) });
export const saveRequestObject = (path: string, request: Record<string, unknown>, baseVersion?: string) =>
  api<SaveResult>("/api/request/object", {
    method: "POST",
    body: JSON.stringify({ path, request, baseVersion }),
  });
export const createFolder = (path: string) =>
  api<CreateFolderResult>("/api/folder", { method: "POST", body: JSON.stringify({ path }) });
export const renamePath = (path: string, newPath: string) =>
  api<RenameResult>("/api/rename", { method: "POST", body: JSON.stringify({ path, newPath }) });
export const deletePath = (path: string) =>
  api<DeleteResult>("/api/delete", { method: "POST", body: JSON.stringify({ path }) });
export const duplicatePath = (path: string, newPath?: string) =>
  api<DuplicateResult>("/api/duplicate", { method: "POST", body: JSON.stringify({ path, newPath }) });
export const getEnvironment = (name: string) =>
  api<EnvironmentDetail>(`/api/environment?name=${encodeURIComponent(name)}`);
export const saveEnvironment = (
  name: string,
  variables: Record<string, string | number | boolean>,
  secrets: string[],
) => api<EnvSaveResult>("/api/environment", { method: "POST", body: JSON.stringify({ name, variables, secrets }) });
export const getFolderConfig = (path: string) =>
  api<FolderConfigDetail>(`/api/folder?path=${encodeURIComponent(path)}`);
export const saveFolderConfig = (path: string, config: Record<string, unknown>) =>
  api<SaveResult>("/api/folder/object", { method: "POST", body: JSON.stringify({ path, config }) });
export const exportPostman = (path?: string) =>
  api<ExportPostmanResult>("/api/export/postman", { method: "POST", body: JSON.stringify({ path }) });

export const codegenTargets = () => api<{ targets: CodegenTargetInfo[] }>("/api/codegen/targets");
export const codegen = (
  request: Record<string, unknown>,
  lang: string,
  path?: string,
  env?: string,
) => api<CodegenResult>("/api/codegen", { method: "POST", body: JSON.stringify({ request, lang, path, env }) });

export const mockStatus = () => api<MockStatus>("/api/mock/status");
export const mockStart = (spec: string, port?: number, delayMs?: number) =>
  api<MockStartResult>("/api/mock/start", { method: "POST", body: JSON.stringify({ spec, port, delayMs }) });
export const mockStop = () => api<{ ok: boolean }>("/api/mock/stop", { method: "POST" });
export const mockLog = () => api<{ log: MockLogEntry[] }>("/api/mock/log");
