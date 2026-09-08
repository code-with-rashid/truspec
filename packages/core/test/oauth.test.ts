import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { type OAuth2Auth, resolveOAuthToken, runRequest, type TokenCache } from "../src/runner";

const TOKEN_URL = "https://auth.test/oauth/token";

interface Call {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/** A fetch double that answers the token endpoint and echoes every call it saw. */
function stubFetch(
  tokenResponse: { status?: number; body?: string } = {},
  apiStatus = 200,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    if (url === TOKEN_URL) {
      return new Response(tokenResponse.body ?? JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), {
        status: tokenResponse.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: apiStatus, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

function auth(yaml: string): OAuth2Auth {
  return parse.request.parse(`name: r\nurl: "https://api.test/x"\nauth:\n${yaml}`).auth as OAuth2Auth;
}

const CLIENT_CREDENTIALS = auth(`  type: oauth2
  tokenUrl: "${TOKEN_URL}"
  clientId: cid
  clientSecret: csecret
  scope: "read:pets"`);

describe("resolveOAuthToken", () => {
  it("posts a client_credentials grant and returns the Authorization header", async () => {
    const { fetch, calls } = stubFetch();
    const r = await resolveOAuthToken(CLIENT_CREDENTIALS, { vars: {}, fetch });
    expect(r).toEqual({ ok: true, header: "Bearer tok-1", cached: false });
    expect(calls[0]!.url).toBe(TOKEN_URL);
    const form = new URLSearchParams(calls[0]!.body);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("client_secret")).toBe("csecret");
    expect(form.get("scope")).toBe("read:pets");
    expect(calls[0]!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("sends the client credentials as HTTP Basic when clientAuth is basic", async () => {
    const { fetch, calls } = stubFetch();
    await resolveOAuthToken({ ...CLIENT_CREDENTIALS, clientAuth: "basic" }, { vars: {}, fetch });
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    expect(new URLSearchParams(calls[0]!.body).get("client_id")).toBeNull();
  });

  it("interpolates variables into every field of the auth block", async () => {
    const { fetch, calls } = stubFetch();
    const a = auth(`  type: oauth2
  tokenUrl: "{{authUrl}}/oauth/token"
  clientId: "{{cid}}"
  clientSecret: "{{secret}}"`);
    const r = await resolveOAuthToken(a, {
      vars: { authUrl: "https://auth.test", cid: "abc", secret: "xyz" },
      fetch,
    });
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe(TOKEN_URL);
    expect(new URLSearchParams(calls[0]!.body).get("client_id")).toBe("abc");
  });

  it("fails with the unresolved names rather than posting a half-empty token request", async () => {
    const { fetch, calls } = stubFetch();
    const a = auth(`  type: oauth2\n  tokenUrl: "{{authUrl}}/t"\n  clientId: "{{cid}}"`);
    const r = await resolveOAuthToken(a, { vars: {}, fetch });
    expect(r).toEqual({ ok: false, error: "OAuth2: unresolved variables in the auth block: {{authUrl}}, {{cid}}" });
    expect(calls).toEqual([]);
  });

  it("rejects a grant whose required fields are missing, before any network call", async () => {
    const { fetch, calls } = stubFetch();
    const pw = auth(`  type: oauth2\n  grant: password\n  tokenUrl: "${TOKEN_URL}"\n  username: bob`);
    expect(await resolveOAuthToken(pw, { vars: {}, fetch })).toEqual({
      ok: false,
      error: "OAuth2: password grant needs username and password",
    });
    const rt = auth(`  type: oauth2\n  grant: refresh_token\n  tokenUrl: "${TOKEN_URL}"`);
    expect((await resolveOAuthToken(rt, { vars: {}, fetch })).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("supports the password and refresh_token grants", async () => {
    const { fetch, calls } = stubFetch();
    const pw = auth(`  type: oauth2
  grant: password
  tokenUrl: "${TOKEN_URL}"
  username: bob
  password: hunter2
  clientId: cid`);
    await resolveOAuthToken(pw, { vars: {}, fetch });
    const form = new URLSearchParams(calls[0]!.body);
    expect(form.get("grant_type")).toBe("password");
    expect(form.get("username")).toBe("bob");
    expect(form.get("password")).toBe("hunter2");

    const rt = auth(`  type: oauth2\n  grant: refresh_token\n  tokenUrl: "${TOKEN_URL}"\n  refreshToken: rt-9`);
    await resolveOAuthToken(rt, { vars: {}, fetch });
    expect(new URLSearchParams(calls[1]!.body).get("refresh_token")).toBe("rt-9");
  });

  it("passes audience and extra parameters through verbatim", async () => {
    const { fetch, calls } = stubFetch();
    const a = auth(`  type: oauth2
  tokenUrl: "${TOKEN_URL}"
  clientId: cid
  audience: "https://api.test"
  extra: { resource: "urn:x", tenant: "acme" }`);
    await resolveOAuthToken(a, { vars: {}, fetch });
    const form = new URLSearchParams(calls[0]!.body);
    expect(form.get("audience")).toBe("https://api.test");
    expect(form.get("resource")).toBe("urn:x");
    expect(form.get("tenant")).toBe("acme");
  });

  it("uses a configured scheme instead of Bearer", async () => {
    const { fetch } = stubFetch();
    const r = await resolveOAuthToken({ ...CLIENT_CREDENTIALS, scheme: "DPoP" }, { vars: {}, fetch });
    expect(r).toMatchObject({ ok: true, header: "DPoP tok-1" });
  });

  it("surfaces the provider's own error body on a non-2xx token response", async () => {
    const { fetch } = stubFetch({ status: 401, body: '{"error":"invalid_client"}' });
    const r = await resolveOAuthToken(CLIENT_CREDENTIALS, { vars: {}, fetch });
    expect(r).toEqual({
      ok: false,
      error: 'OAuth2: token endpoint returned 401: {"error":"invalid_client"}',
    });
  });

  it("reports a non-JSON response and a JSON response with no access_token", async () => {
    const html = await resolveOAuthToken(CLIENT_CREDENTIALS, {
      vars: {},
      fetch: stubFetch({ body: "<html>nope</html>" }).fetch,
    });
    expect(html.ok).toBe(false);
    expect((html as { error: string }).error).toMatch(/did not return JSON/);

    const empty = await resolveOAuthToken(CLIENT_CREDENTIALS, {
      vars: {},
      fetch: stubFetch({ body: '{"token_type":"Bearer"}' }).fetch,
    });
    expect(empty).toEqual({ ok: false, error: "OAuth2: token response had no access_token" });
  });

  it("reports a transport failure without throwing", async () => {
    const boom = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r = await resolveOAuthToken(CLIENT_CREDENTIALS, { vars: {}, fetch: boom });
    expect(r).toEqual({
      ok: false,
      error: `OAuth2: token request to ${TOKEN_URL} failed: ECONNREFUSED`,
    });
  });
});

describe("token cache", () => {
  it("reuses a cached token instead of hitting the token endpoint again", async () => {
    const { fetch, calls } = stubFetch();
    const cache: TokenCache = new Map();
    const first = await resolveOAuthToken(CLIENT_CREDENTIALS, { vars: {}, fetch, cache, now: () => 0 });
    const second = await resolveOAuthToken(CLIENT_CREDENTIALS, { vars: {}, fetch, cache, now: () => 1000 });
    expect(first.ok && first.cached).toBe(false);
    expect(second.ok && second.cached).toBe(true);
    expect(calls.length).toBe(1);
  });

  it("re-fetches once the token is inside the expiry skew", async () => {
    const { fetch, calls } = stubFetch({ body: JSON.stringify({ access_token: "t", expires_in: 60 }) });
    const cache: TokenCache = new Map();
    await resolveOAuthToken(CLIENT_CREDENTIALS, { vars: {}, fetch, cache, now: () => 0 });
    // expires_in 60s minus the 30s skew ⇒ valid until t=30s.
    await resolveOAuthToken(CLIENT_CREDENTIALS, { vars: {}, fetch, cache, now: () => 29_000 });
    expect(calls.length).toBe(1);
    await resolveOAuthToken(CLIENT_CREDENTIALS, { vars: {}, fetch, cache, now: () => 31_000 });
    expect(calls.length).toBe(2);
  });

  it("keys the cache by grant, endpoint, client, scope and audience", async () => {
    const { fetch, calls } = stubFetch();
    const cache: TokenCache = new Map();
    await resolveOAuthToken(CLIENT_CREDENTIALS, { vars: {}, fetch, cache, now: () => 0 });
    await resolveOAuthToken(
      { ...CLIENT_CREDENTIALS, scope: "write:pets" },
      { vars: {}, fetch, cache, now: () => 0 },
    );
    expect(calls.length).toBe(2);
  });
});

describe("runRequest with oauth2", () => {
  it("acquires a token and sends it on the request", async () => {
    const { fetch, calls } = stubFetch();
    const req = parse.request.parse(`
name: Get pet
url: "https://api.test/pets/1"
auth:
  type: oauth2
  tokenUrl: "${TOKEN_URL}"
  clientId: cid
  clientSecret: csecret
assertions:
  - { type: status, equals: 200 }
`);
    const result = await runRequest(req, { fetch });
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[1]!.url).toBe("https://api.test/pets/1");
    expect(calls[1]!.headers.Authorization).toBe("Bearer tok-1");
  });

  it("fails the request with the token error and never sends it", async () => {
    const { fetch, calls } = stubFetch({ status: 403, body: '{"error":"unauthorized_client"}' });
    const req = parse.request.parse(
      `name: r\nurl: "https://api.test/x"\nauth:\n  type: oauth2\n  tokenUrl: "${TOKEN_URL}"\n  clientId: cid`,
    );
    const result = await runRequest(req, { fetch });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unauthorized_client/);
    expect(calls.length).toBe(1); // token attempt only — the API was never called
  });

  it("inherits an oauth2 block from folder config", async () => {
    const { fetch, calls } = stubFetch();
    const req = parse.request.parse(`name: r\nurl: "/pets"\nassertions: []`);
    const result = await runRequest(req, {
      fetch,
      folder: {
        tspec: "0.1",
        baseUrl: "https://api.test",
        auth: { ...CLIENT_CREDENTIALS },
      },
    });
    expect(result.ok).toBe(true);
    expect(calls[1]!.headers.Authorization).toBe("Bearer tok-1");
  });

  it("lets a request's own auth override an inherited oauth2 block", async () => {
    const { fetch, calls } = stubFetch();
    const req = parse.request.parse(
      `name: r\nurl: "/pets"\nauth:\n  type: bearer\n  token: static\nassertions: []`,
    );
    await runRequest(req, {
      fetch,
      folder: { tspec: "0.1", baseUrl: "https://api.test", auth: { ...CLIENT_CREDENTIALS } },
    });
    expect(calls.length).toBe(1); // no token endpoint call at all
    expect(calls[0]!.headers.Authorization).toBe("Bearer static");
  });

  it("shares one token across a collection run", async () => {
    const { fetch, calls } = stubFetch();
    const cache: TokenCache = new Map();
    const req = parse.request.parse(
      `name: r\nurl: "https://api.test/x"\nauth:\n  type: oauth2\n  tokenUrl: "${TOKEN_URL}"\n  clientId: cid\nassertions: []`,
    );
    await runRequest(req, { fetch, tokenCache: cache });
    await runRequest(req, { fetch, tokenCache: cache });
    expect(calls.filter((c) => c.url === TOKEN_URL).length).toBe(1);
  });
});
