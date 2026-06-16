export interface RequestSummary {
  path: string;
  name: string;
  method: string;
  url: string;
  operation?: string;
  assertions: number;
}

export interface WorkspaceState {
  dir: string;
  requests: RequestSummary[];
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

export interface RequestDetail {
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string | number | boolean>;
  query?: Record<string, string | number | boolean>;
  assertions?: Array<Record<string, unknown>>;
  auth?: { type: string };
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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const getState = () => api<WorkspaceState>("/api/state");
export const getRequest = (path: string) =>
  api<RequestDetail>(`/api/request?path=${encodeURIComponent(path)}`);
export const run = (target: string | undefined, env: string | undefined) =>
  api<WorkspaceRunResult>("/api/run", { method: "POST", body: JSON.stringify({ target, env }) });
export const drift = (spec: string) =>
  api<DriftReport>("/api/drift", { method: "POST", body: JSON.stringify({ spec }) });
export const coverage = (spec: string) =>
  api<CoverageReport>("/api/coverage", { method: "POST", body: JSON.stringify({ spec }) });
export const saveRequest = (path: string, content: string) =>
  api<SaveResult>("/api/request", { method: "POST", body: JSON.stringify({ path, content }) });
