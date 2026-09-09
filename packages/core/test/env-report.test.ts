import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffEnvironments, listEnvironments } from "../src/workspace";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-env-"));
  mkdirSync(join(dir, "environments"), { recursive: true });
  mkdirSync(join(dir, "api"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const writeEnv = (name: string, body: string): void =>
  writeFileSync(join(dir, "environments", `${name}.env.yaml`), body);

const local = 'tspec: "0.1"\nname: local\nvariables: { baseUrl: "http://localhost:4000", petId: "1" }\nsecrets: [token]\n';
const prod = 'tspec: "0.1"\nname: prod\nvariables: { baseUrl: "https://api.example.com" }\nsecrets: [token, apiKey]\n';

describe("listEnvironments", () => {
  it("lists each environment with its variables and declared secrets", () => {
    writeEnv("local", local);
    const r = listEnvironments(dir, {});
    expect(r.environments.length).toBe(1);
    const env = r.environments[0]!;
    expect(env.name).toBe("local");
    expect(env.path).toBe("environments/local.env.yaml");
    expect(env.variables).toEqual({ baseUrl: "http://localhost:4000", petId: "1" });
    expect(env.secrets).toEqual([{ name: "token", resolved: false }]);
    expect(env.unresolved).toEqual(["token"]);
  });

  it("resolves a secret from the process environment, and says where from", () => {
    writeEnv("local", local);
    const env = listEnvironments(dir, { token: "s3cret" }).environments[0]!;
    expect(env.secrets[0]).toEqual({ name: "token", resolved: true, source: "env" });
    expect(env.unresolved).toEqual([]);
  });

  it("resolves a secret from the project .env, with a real environment variable winning", () => {
    writeEnv("local", local);
    writeFileSync(join(dir, ".env"), "token=from-dotenv\n");
    expect(listEnvironments(dir, {}).environments[0]!.secrets[0]).toEqual({
      name: "token",
      resolved: true,
      source: "dotenv",
    });
    expect(listEnvironments(dir, { token: "from-env" }).environments[0]!.secrets[0]!.source).toBe("env");
  });

  it("never returns a secret's value, from either source", () => {
    writeEnv("local", local);
    writeFileSync(join(dir, ".env"), "token=super-secret-value\n");
    // This report is printed to terminals and pasted into issues.
    expect(JSON.stringify(listEnvironments(dir, { token: "another-secret" }))).not.toContain("secret-value");
    expect(JSON.stringify(listEnvironments(dir, { token: "another-secret" }))).not.toContain("another-secret");
  });

  it("reports an unparseable environment file without losing the others", () => {
    writeEnv("local", local);
    writeEnv("broken", "name: [unclosed\n");
    const r = listEnvironments(dir, {});
    expect(r.environments.map((e) => e.name)).toEqual(["local"]);
    expect(r.errors.map((e) => e.path)).toEqual(["environments/broken.env.yaml"]);
  });

  it("finds environments from a subdirectory, the way the runner does", () => {
    writeEnv("local", local);
    expect(listEnvironments(join(dir, "api"), {}).environments.length).toBe(1);
  });

  it("returns nothing rather than throwing when there are no environments", () => {
    rmSync(join(dir, "environments"), { recursive: true, force: true });
    expect(listEnvironments(dir, {}).environments).toEqual([]);
  });

  it("lists in a stable order", () => {
    writeEnv("zeta", 'tspec: "0.1"\nname: zeta\n');
    writeEnv("alpha", 'tspec: "0.1"\nname: alpha\n');
    expect(listEnvironments(dir, {}).environments.map((e) => e.name)).toEqual(["alpha", "zeta"]);
  });
});

describe("diffEnvironments", () => {
  const envs = (): [ReturnType<typeof listEnvironments>["environments"][0], ReturnType<typeof listEnvironments>["environments"][0]] => {
    writeEnv("local", local);
    writeEnv("prod", prod);
    const r = listEnvironments(dir, {});
    return [r.environments.find((e) => e.name === "local")!, r.environments.find((e) => e.name === "prod")!];
  };

  it("reports a name declared on one side only — the failure this exists to catch", () => {
    const [a, b] = envs();
    const d = diffEnvironments(a, b);
    expect(d.onlyInA).toEqual(["petId"]);
    expect(d.onlyInB).toEqual(["apiKey"]);
  });

  it("reports a variable whose value differs", () => {
    const [a, b] = envs();
    expect(diffEnvironments(a, b).changed).toEqual([
      { name: "baseUrl", a: "http://localhost:4000", b: "https://api.example.com" },
    ]);
  });

  it("treats a secret declared in both as the same, without comparing values it does not have", () => {
    const [a, b] = envs();
    expect(diffEnvironments(a, b).same).toContain("token");
  });

  it("flags a name that is a plain variable on one side and a secret on the other", () => {
    writeEnv("a", 'tspec: "0.1"\nname: a\nvariables: { apiKey: "inline" }\n');
    writeEnv("b", 'tspec: "0.1"\nname: b\nsecrets: [apiKey]\n');
    const r = listEnvironments(dir, {});
    const d = diffEnvironments(r.environments[0]!, r.environments[1]!);
    // A real difference in kind, not "same name, moving on".
    expect(d.changed).toEqual([{ name: "apiKey", a: "inline", b: "(secret)" }]);
  });

  it("reports identical environments as identical", () => {
    writeEnv("a", 'tspec: "0.1"\nname: a\nvariables: { x: "1" }\nsecrets: [t]\n');
    writeEnv("b", 'tspec: "0.1"\nname: b\nvariables: { x: "1" }\nsecrets: [t]\n');
    const r = listEnvironments(dir, {});
    const d = diffEnvironments(r.environments[0]!, r.environments[1]!);
    expect(d.onlyInA).toEqual([]);
    expect(d.onlyInB).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(d.same.sort()).toEqual(["t", "x"]);
  });
});
