import { describe, expect, it } from "vitest";
import { importInsomnia } from "../src/importers/insomnia";
import { importPostman } from "../src/importers/postman";
import { parse } from "../src/format";
import { envSlug } from "../src/importers/environment";

const envOf = (files: Array<{ path: string; content: string }>, name: string) =>
  files.find((f) => f.path === `environments/${name}.env.yaml`);

/**
 * Neither importer emitted an environment, so every import produced a collection that could not
 * run: `{{baseUrl}}` referenced by every request and declared nowhere. The on-ramp led to a dead
 * end, and `truspec lint` said so once per request.
 */
describe("Insomnia environments", () => {
  const EXPORT = {
    _type: "export",
    __export_format: 4,
    resources: [
      { _id: "wrk_1", _type: "workspace", name: "Shop" },
      { _id: "env_base", _type: "environment", parentId: "wrk_1", name: "Base Environment", data: { baseUrl: "https://api.example.com", apiVersion: "v2" } },
      { _id: "env_local", _type: "environment", parentId: "env_base", name: "Local", data: { baseUrl: "http://localhost:4000", token: "shh" } },
      { _id: "req_1", _type: "request", parentId: "wrk_1", name: "List", method: "GET", url: "{{ _.baseUrl }}/pets" },
    ],
  };

  it("writes one file per environment, and they parse", () => {
    const { files } = importInsomnia(EXPORT);
    for (const name of ["base-environment", "local"]) {
      const file = envOf(files, name);
      expect(file, `missing environments/${name}.env.yaml`).toBeDefined();
      expect(() => parse.environment.parse(file!.content)).not.toThrow();
    }
  });

  it("flattens the parent chain, so a sub-environment carries what it inherits", () => {
    const { files } = importInsomnia(EXPORT);
    const local = parse.environment.parse(envOf(files, "local")!.content);
    // Its own value wins…
    expect(local.variables.baseUrl).toBe("http://localhost:4000");
    // …and the base's is still there, which is what Insomnia does when `Local` is selected.
    expect(local.variables.apiVersion).toBe("v2");
  });

  it("declares a credential-named variable as a secret and does not write its value", () => {
    const { files, warnings } = importInsomnia(EXPORT);
    const local = envOf(files, "local")!;
    const parsed = parse.environment.parse(local.content);
    expect(parsed.secrets).toEqual(["token"]);
    expect(parsed.variables.token).toBeUndefined();
    // Never inline secrets — the value must not appear anywhere in the file.
    expect(local.content).not.toContain("shh");
    // But it is not silently lost either.
    expect(warnings.join("\n")).toContain("token declared as secret(s)");
  });

  it("skips a non-scalar value, which cannot be a {{var}} substitution", () => {
    const { files } = importInsomnia({
      _type: "export",
      resources: [
        { _id: "e", _type: "environment", name: "E", data: { flat: "1", nested: { a: 1 } } },
        { _id: "r", _type: "request", name: "R", method: "GET", url: "{{ _.flat }}/x" },
      ],
    });
    const parsed = parse.environment.parse(envOf(files, "e")!.content);
    expect(parsed.variables).toEqual({ flat: "1" });
  });

  it("emits nothing for an environment with no data", () => {
    const { files } = importInsomnia({
      _type: "export",
      resources: [
        { _id: "e", _type: "environment", name: "Empty", data: {} },
        { _id: "r", _type: "request", name: "R", method: "GET", url: "https://api.test/x" },
      ],
    });
    expect(files.some((f) => f.path.startsWith("environments/"))).toBe(false);
  });
});

/**
 * `{{ _.var }}` normalization lived inline in the URL handling, so an imported request came out
 * with a clean `url` next to an untouched `token: "{{ _.token }}"` — a name with a `_.` prefix that
 * nothing declares and nothing will resolve.
 */
describe("Insomnia {{ _.var }} normalization reaches every field", () => {
  const { files } = importInsomnia({
    _type: "export",
    resources: [
      { _id: "e", _type: "environment", name: "E", data: { baseUrl: "https://api.test", token: "t", v: "1" } },
      {
        _id: "r",
        _type: "request",
        name: "R",
        method: "POST",
        url: "{{ _.baseUrl }}/x",
        headers: [{ name: "X-V", value: "{{ _.v }}" }],
        parameters: [{ name: "q", value: "{{ _.v }}" }],
        authentication: { type: "bearer", token: "{{ _.token }}" },
        body: { mimeType: "application/json", text: '{"v":"{{ _.v }}"}' },
      },
    ],
  });
  const request = parse.request.parse(files.find((f) => f.path.endsWith("r.tspec.yaml"))!.content);

  it("normalizes the url", () => {
    expect(request.url).toBe("{{baseUrl}}/x");
  });

  it("normalizes headers and query", () => {
    expect(request.headers?.["X-V"]).toBe("{{v}}");
    expect(request.query?.q).toBe("{{v}}");
  });

  it("normalizes auth", () => {
    expect(request.auth).toEqual({ type: "bearer", token: "{{token}}" });
  });

  it("normalizes the body", () => {
    expect(JSON.stringify(request.body)).toContain("{{v}}");
    expect(JSON.stringify(request.body)).not.toContain("_.");
  });
});

describe("Postman collection variables", () => {
  const COLLECTION = {
    info: { name: "Shop API", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    variable: [
      { key: "baseUrl", value: "https://api.example.com" },
      { key: "apiVersion", value: "v2" },
      { key: "token", value: "secret-token-value" },
      { key: "off", value: "x", disabled: true },
    ],
    item: [{ name: "List", request: { method: "GET", url: "{{baseUrl}}/pets" } }],
  };

  it("writes an environment named for the collection", () => {
    const { files } = importPostman(COLLECTION);
    const file = envOf(files, "shop-api");
    expect(file).toBeDefined();
    expect(parse.environment.parse(file!.content).variables).toEqual({
      baseUrl: "https://api.example.com",
      apiVersion: "v2",
    });
  });

  it("routes a credential-named variable to secrets, value withheld", () => {
    const { files } = importPostman(COLLECTION);
    const file = envOf(files, "shop-api")!;
    expect(parse.environment.parse(file.content).secrets).toEqual(["token"]);
    expect(file.content).not.toContain("secret-token-value");
  });

  it("skips a disabled variable, as it does for a disabled header", () => {
    const { files } = importPostman(COLLECTION);
    expect(parse.environment.parse(envOf(files, "shop-api")!.content).variables.off).toBeUndefined();
  });

  it("falls back to `imported` when the collection does not name itself", () => {
    const { files } = importPostman({ item: [], variable: [{ key: "a", value: "1" }] });
    expect(envOf(files, "imported")).toBeDefined();
  });

  it("emits nothing when the collection carries no variables", () => {
    const { files } = importPostman({ info: { name: "X" }, item: [] });
    expect(files.some((f) => f.path.startsWith("environments/"))).toBe(false);
  });
});

describe("envSlug", () => {
  it("makes a name usable as `--env <name>`", () => {
    expect(envSlug("Base Environment")).toBe("base-environment");
    expect(envSlug("Prod (EU)")).toBe("prod-eu");
    expect(envSlug("  ")).toBe("imported");
    expect(envSlug("!!!")).toBe("imported");
  });
});
