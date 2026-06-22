import { z } from "zod";

/**
 * Schema version stamped into every TruSpec file. Bump on any breaking change and
 * ship a migration before doing so (version the format from day one).
 */
export const SCHEMA_VERSION = "0.1";

/** HTTP methods supported by the v0 runner. */
export const HttpMethod = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/**
 * A string that may contain `{{variable}}` templates, resolved at run time from
 * the active environment, folder config, and OS/.env variables.
 */
const Template = z.string();

/** Flat map of string/number/boolean values (headers, query params, variables). */
const Primitive = z.union([z.string(), z.number(), z.boolean()]);
const KeyValue = z.record(z.string(), Primitive);

/** Request body. Omit entirely for no body. */
export const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("json"), content: z.unknown() }),
  z.object({ type: z.literal("text"), content: z.string() }),
  z.object({ type: z.literal("form"), content: z.record(z.string(), z.string()) }),
  z.object({
    type: z.literal("graphql"),
    query: z.string(),
    variables: z.record(z.string(), z.unknown()).optional(),
  }),
]);

/** Auth, optionally inherited from folder config. Secrets are referenced by name. */
export const Auth = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: Template }),
  z.object({ type: z.literal("basic"), username: Template, password: Template }),
  z.object({
    type: z.literal("apikey"),
    name: z.string(),
    value: Template,
    in: z.enum(["header", "query"]).default("header"),
  }),
]);

/**
 * Declarative, machine-checkable assertions. These — not JS scripts — are what
 * power CI gating and coverage in v0. A JS scripting sandbox is deferred.
 */
export const Assertion = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    equals: z.number().int().optional(),
    in: z.array(z.number().int()).optional(),
    lt: z.number().int().optional(),
    gte: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("header"),
    name: z.string(),
    equals: z.string().optional(),
    matches: z.string().optional(),
    exists: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("jsonpath"),
    path: z.string(),
    equals: z.unknown().optional(),
    exists: z.boolean().optional(),
    matches: z.string().optional(),
  }),
  z.object({
    type: z.literal("body"),
    contains: z.string().optional(),
    matches: z.string().optional(),
  }),
  z.object({ type: z.literal("duration"), ltMs: z.number().positive() }),
  z.object({
    type: z.literal("schema"),
    /** Validate against the schema for this status (default: the response's actual status). */
    status: z.number().int().optional(),
    /** Media type whose schema to use (default: application/json). */
    contentType: z.string().optional(),
    /** Fail if the spec declares no schema for this status/type (default: skip with a note). */
    required: z.boolean().optional(),
  }),
]);

/** Links a request back to its OpenAPI operation — consumed by drift & coverage. */
const SpecLink = z.object({
  operationId: z.string().optional(),
  /** `${METHOD} ${path}`, e.g. "GET /pets/{id}" — fallback when no operationId. */
  operation: z.string().optional(),
});

/** Source for a captured variable: a jsonpath shorthand, or an explicit source. */
export const CaptureSource = z.union([
  z.string(),
  z.object({ jsonpath: z.string() }).strict(),
  z.object({ header: z.string() }).strict(),
  z.object({ status: z.literal(true) }).strict(),
]);

/** A single request. One request per file: `<name>.tspec.yaml`. */
export const RequestSchema = z
  .object({
    tspec: z.string().default(SCHEMA_VERSION),
    name: z.string().min(1),
    method: HttpMethod.default("GET"),
    url: Template,
    headers: KeyValue.optional(),
    query: KeyValue.optional(),
    body: Body.optional(),
    auth: Auth.optional(),
    assertions: z.array(Assertion).default([]),
    /** Capture response values into variables for later requests in the run. */
    capture: z.record(z.string(), CaptureSource).optional(),
    /** Run order within a collection (lower first; default 0, then by path). */
    order: z.number().optional(),
    /** Pre-request + post-response scripts run in a Node vm context (see CLAUDE.md; not a security sandbox). */
    script: z.object({ pre: z.string().optional(), post: z.string().optional() }).strict().optional(),
    docs: z.string().optional(),
    spec: SpecLink.optional(),
  })
  .strict();

/** Folder-level config (`folder.tspec.yaml`) inherited by requests in that folder. */
export const FolderConfigSchema = z
  .object({
    tspec: z.string().default(SCHEMA_VERSION),
    name: z.string().optional(),
    baseUrl: Template.optional(),
    headers: KeyValue.optional(),
    auth: Auth.optional(),
  })
  .strict();

/** An environment (`environments/<name>.env.yaml`). Secrets are referenced, never inlined. */
export const EnvironmentSchema = z
  .object({
    tspec: z.string().default(SCHEMA_VERSION),
    name: z.string().min(1),
    variables: z.record(z.string(), Primitive).default({}),
    /** Names of OS/.env variables surfaced as `{{name}}`; values are never stored here. */
    secrets: z.array(z.string()).default([]),
  })
  .strict();
