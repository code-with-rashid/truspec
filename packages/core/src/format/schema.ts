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

// Every nested object is `.strict()` too — NOT just the top-level request/folder/env schemas — so a
// typo'd OPTIONAL key (e.g. `exits` for `exists`, or `operatonId` for `operationId`) surfaces as a
// parse error instead of being silently stripped. A stripped key otherwise yields confusing silent
// behavior: a condition-less assertion that always fails, or an empty `spec: {}` link that drift then
// mis-reports as stale. (Required-field typos were already caught; this closes the optional-key gap,
// honoring CLAUDE.md's "unknown keys are rejected" hard rule at every level.)

/**
 * One `multipart/form-data` part: a plain value, an explicit text part with its own media type,
 * or a file read from disk at send time (path relative to the request file, confined to the
 * workspace).
 */
export const MultipartField = z.union([
  Primitive,
  z
    .object({
      file: Template,
      /** Filename sent in the part's Content-Disposition. Defaults to the file's basename. */
      filename: z.string().optional(),
      contentType: z.string().optional(),
    })
    .strict(),
  z.object({ text: Template, contentType: z.string().optional(), filename: z.string().optional() }).strict(),
]);

/** Request body. Omit entirely for no body. */
export const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("json"), content: z.unknown() }).strict(),
  z.object({ type: z.literal("text"), content: z.string() }).strict(),
  z.object({ type: z.literal("form"), content: z.record(z.string(), z.string()) }).strict(),
  z
    .object({
      type: z.literal("graphql"),
      query: z.string(),
      variables: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  /**
   * `multipart/form-data`. A field is either a plain value or a file part; the boundary is
   * generated at send time, so a `Content-Type` header must NOT be set by hand.
   */
  z
    .object({
      type: z.literal("multipart"),
      fields: z.record(z.string(), MultipartField),
    })
    .strict(),
]);

/** Auth, optionally inherited from folder config. Secrets are referenced by name. */
export const Auth = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("bearer"), token: Template }).strict(),
  z.object({ type: z.literal("basic"), username: Template, password: Template }).strict(),
  z
    .object({
      type: z.literal("apikey"),
      name: z.string(),
      value: Template,
      in: z.enum(["header", "query"]).default("header"),
    })
    .strict(),
  /**
   * OAuth2 — the runner fetches a token from `tokenUrl` before sending the request and caches it
   * for the rest of the run. Only the grants a machine can complete unattended are supported:
   * an interactive authorization-code flow needs a browser, which a CI gate does not have (capture
   * the resulting refresh token once and use `grant: refresh_token` instead).
   */
  z
    .object({
      type: z.literal("oauth2"),
      grant: z.enum(["client_credentials", "password", "refresh_token"]).default("client_credentials"),
      tokenUrl: Template,
      clientId: Template.optional(),
      clientSecret: Template.optional(),
      /** `password` grant only. */
      username: Template.optional(),
      /** `password` grant only. */
      password: Template.optional(),
      /** `refresh_token` grant only. */
      refreshToken: Template.optional(),
      scope: Template.optional(),
      /** Extra token-endpoint parameter some providers require (Auth0, Okta). */
      audience: Template.optional(),
      /** Where the client credentials go: the request body (default) or an HTTP Basic header. */
      clientAuth: z.enum(["body", "basic"]).default("body"),
      /** Any further parameters to post to the token endpoint verbatim. */
      extra: z.record(z.string(), Template).optional(),
      /** Authorization header scheme for the acquired token. */
      scheme: z.string().default("Bearer"),
    })
    .strict(),
]);

/**
 * Declarative, machine-checkable assertions. These — not JS scripts — are what
 * power CI gating and coverage in v0. A JS scripting sandbox is deferred.
 */
export const Assertion = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("status"),
      equals: z.number().int().optional(),
      in: z.array(z.number().int()).optional(),
      lt: z.number().int().optional(),
      gte: z.number().int().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("header"),
      name: z.string(),
      equals: z.string().optional(),
      notEquals: z.string().optional(),
      contains: z.string().optional(),
      matches: z.string().optional(),
      exists: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("jsonpath"),
      path: z.string(),
      equals: z.unknown().optional(),
      notEquals: z.unknown().optional(),
      exists: z.boolean().optional(),
      matches: z.string().optional(),
      /** Substring of a string value, or membership in an array value. */
      contains: z.unknown().optional(),
      /** Value must equal one of these. */
      oneOf: z.array(z.unknown()).optional(),
      /** Numeric comparisons against the matched value. */
      gt: z.number().optional(),
      gte: z.number().optional(),
      lt: z.number().optional(),
      lte: z.number().optional(),
      /**
       * JSON type of the matched value. Named `valueType` rather than `type` because `type` is
       * already the assertion's own discriminator.
       */
      valueType: z.enum(["string", "number", "boolean", "object", "array", "null"]).optional(),
      /** Exact length of a string or array value. */
      length: z.number().int().nonnegative().optional(),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().nonnegative().optional(),
      /** `true` asserts an empty string/array/object; `false` asserts a non-empty one. */
      empty: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("body"),
      equals: z.string().optional(),
      contains: z.string().optional(),
      notContains: z.string().optional(),
      matches: z.string().optional(),
      empty: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal("duration"), ltMs: z.number().positive() }).strict(),
  z
    .object({
      /**
       * Assertions over a `text/event-stream` response's events.
       *
       * A streaming endpoint's response *is* its events; asserting on the concatenated stream text
       * works but says nothing about how many arrived, in what order, or under which name. Every
       * condition below is AND-ed, and the count conditions apply after `event` filters.
       */
      type: z.literal("sse"),
      /** Only consider events whose `event:` field is this. */
      event: z.string().optional(),
      /** Exactly this many (matching) events. */
      count: z.number().int().nonnegative().optional(),
      minCount: z.number().int().nonnegative().optional(),
      maxCount: z.number().int().nonnegative().optional(),
      /** At least one matching event's `data` contains this substring. */
      contains: z.string().optional(),
      /** At least one matching event's `data` matches this regular expression. */
      matches: z.string().optional(),
      /** Select inside each matching event's `data`, parsed as JSON. */
      jsonpath: z.string().optional(),
      /** With `jsonpath`: at least one event where the selected value equals this. */
      equals: z.unknown().optional(),
      /** With `jsonpath`: whether at least one event has (or no event has) the path. */
      exists: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("schema"),
      /** Validate against the schema for this status (default: the response's actual status). */
      status: z.number().int().optional(),
      /** Media type whose schema to use (default: application/json). */
      contentType: z.string().optional(),
      /** Fail if the spec declares no schema for this status/type (default: skip with a note). */
      required: z.boolean().optional(),
    })
    .strict(),
]);

/**
 * Per-request transport options. All optional; every default matches what the runner did before
 * these existed, so adding the block never changes an existing request's behavior.
 */
export const RequestOptions = z
  .object({
    /** Overrides the run-wide timeout for this request. `0` disables it. */
    timeoutMs: z.number().int().nonnegative().optional(),
    /** Re-send on a transport error, 429, or 5xx. Assertion failures are never retried. */
    retries: z.number().int().min(0).max(10).optional(),
    /** Base pause before a retry; doubles each attempt (capped). Default 200ms. */
    retryDelayMs: z.number().int().nonnegative().optional(),
    /**
     * Follow 3xx responses. Off by default: TruSpec observes the ACTUAL response a URL returns,
     * so a redirect stays assertable and `contract` can validate a 3xx operation the spec declares.
     */
    followRedirects: z.boolean().optional(),
    /** Redirect hops allowed when `followRedirects` is on. Default 5. */
    maxRedirects: z.number().int().min(1).max(20).optional(),
  })
  .strict();

/** Links a request back to its OpenAPI operation — consumed by drift & coverage. */
const SpecLink = z
  .object({
    operationId: z.string().optional(),
    /** `${METHOD} ${path}`, e.g. "GET /pets/{id}" — fallback when no operationId. */
    operation: z.string().optional(),
  })
  .strict();

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
    /**
     * Free-form labels for selecting a subset of a collection at run time
     * (`truspec run --tag smoke`). Kept as plain strings so a tag can also be a team
     * convention (`owner:payments`) without the format needing to know about it.
     */
    tags: z.array(z.string().min(1)).optional(),
    /** Transport options (timeout, retries, redirects) for this request. */
    options: RequestOptions.optional(),
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
