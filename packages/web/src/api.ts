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
  };
  assertions: AssertionResult[];
  captured?: Record<string, unknown>;
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
  percent: number;
  ok: boolean;
}

export type RequestBody =
  | { type: "none" }
  | { type: "json"; content: unknown }
  | { type: "text"; content: string }
  | { type: "form"; content: Record<string, string> }
  | { type: "graphql"; query: string; variables?: Record<string, unknown> };

export type RequestAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apikey"; name: string; value: string; in: "header" | "query" };

export type CaptureSource = string | { jsonpath: string } | { header: string } | { status: true };

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
  script?: { pre?: string; post?: string };
  docs?: string;
  spec?: { operation?: string; operationId?: string };
  /** Raw YAML source of the file, for the editor. */
  raw?: string;
}

export interface SaveResult {
  ok: boolean;
  path?: string;
  error?: string;
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

/** Success is the raw Postman collection (no `ok` field); failure is `{ok:false,error}`. */
export type ExportPostmanResult = Record<string, unknown>;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const getState = () => api<WorkspaceState>("/api/state");
export const getFlow = () => api<FlowState>("/api/flow");
export const importPostman = (json: unknown, targetDir?: string) =>
  api<ImportApiResult>("/api/import/postman", { method: "POST", body: JSON.stringify({ json, targetDir }) });
export const importBruno = (files: Array<{ path: string; content: string }>, targetDir?: string) =>
  api<ImportApiResult>("/api/import/bruno", { method: "POST", body: JSON.stringify({ files, targetDir }) });
export const getRequest = (path: string) =>
  api<RequestDetail>(`/api/request?path=${encodeURIComponent(path)}`);
export const run = (target: string | undefined, env: string | undefined, spec?: string) =>
  api<WorkspaceRunResult>("/api/run", { method: "POST", body: JSON.stringify({ target, env, spec }) });
export const drift = (spec: string) =>
  api<DriftReport>("/api/drift", { method: "POST", body: JSON.stringify({ spec }) });
export const coverage = (spec: string) =>
  api<CoverageReport>("/api/coverage", { method: "POST", body: JSON.stringify({ spec }) });
export const saveRequest = (path: string, content: string) =>
  api<SaveResult>("/api/request", { method: "POST", body: JSON.stringify({ path, content }) });
export const saveRequestObject = (path: string, request: Record<string, unknown>) =>
  api<SaveResult>("/api/request/object", { method: "POST", body: JSON.stringify({ path, request }) });
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

export const mockStatus = () => api<MockStatus>("/api/mock/status");
export const mockStart = (spec: string, port?: number, delayMs?: number) =>
  api<MockStartResult>("/api/mock/start", { method: "POST", body: JSON.stringify({ spec, port, delayMs }) });
export const mockStop = () => api<{ ok: boolean }>("/api/mock/stop", { method: "POST" });
export const mockLog = () => api<{ log: MockLogEntry[] }>("/api/mock/log");
