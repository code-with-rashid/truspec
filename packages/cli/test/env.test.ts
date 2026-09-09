import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { envCommand } from "../src/commands/env";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-env-cli-"));
  mkdirSync(join(dir, "environments"), { recursive: true });
  writeFileSync(
    join(dir, "environments", "local.env.yaml"),
    'tspec: "0.1"\nname: local\nvariables: { baseUrl: "http://localhost:4000", petId: "1" }\nsecrets: [token]\n',
  );
  writeFileSync(
    join(dir, "environments", "prod.env.yaml"),
    'tspec: "0.1"\nname: prod\nvariables: { baseUrl: "https://api.example.com" }\nsecrets: [token, apiKey]\n',
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function capture() {
  let out = "";
  let err = "";
  return {
    stdout: (s: string) => {
      out += s;
    },
    stderr: (s: string) => {
      err += s;
    },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

async function run(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const cap = capture();
  const code = await envCommand(argv, { cwd: dir, processEnv: env, stdout: cap.stdout, stderr: cap.stderr });
  return { code, out: cap.out, err: cap.err };
}

describe("truspec env", () => {
  it("lists environments with counts and flags unresolved secrets", async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/local\s+2 var\(s\), 1 secret\(s\)\s+⚠ 1 unresolved/);
    expect(r.out).toMatch(/prod\s+1 var\(s\), 2 secret\(s\)/);
  });

  it("shows one environment's variables and where each secret resolves from", async () => {
    const r = await run(["local"], { token: "s3cret-value" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("baseUrl");
    expect(r.out).toMatch(/token\s+resolved from the environment/);
    // The value itself is never printed — this output gets pasted into issues.
    expect(r.out).not.toContain("s3cret-value");
  });

  it("says plainly when a secret has no value", async () => {
    const r = await run(["local"]);
    expect(r.out).toMatch(/token\s+NOT SET/);
    expect(r.out).toMatch(/1 secret\(s\) have no value/);
  });

  it("diffs two environments, naming what only one of them declares", async () => {
    const r = await run(["--diff", "local", "prod"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("only in local (1):");
    expect(r.out).toContain("- petId");
    expect(r.out).toContain("only in prod (1):");
    expect(r.out).toContain("+ apiKey");
    expect(r.out).toContain("~ baseUrl: http://localhost:4000  →  https://api.example.com");
  });

  it("reports identical environments as identical", async () => {
    writeFileSync(join(dir, "environments", "a.env.yaml"), 'tspec: "0.1"\nname: a\nvariables: { x: "1" }\n');
    writeFileSync(join(dir, "environments", "b.env.yaml"), 'tspec: "0.1"\nname: b\nvariables: { x: "1" }\n');
    expect((await run(["--diff", "a", "b"])).out).toMatch(/Identical/);
  });

  it("emits machine-readable JSON", async () => {
    const list = JSON.parse((await run(["--json"])).out) as { environments: Array<{ name: string }> };
    expect(list.environments.map((e) => e.name)).toEqual(["local", "prod"]);

    const diff = JSON.parse((await run(["--diff", "local", "prod", "--json"])).out) as { onlyInA: string[] };
    expect(diff.onlyInA).toEqual(["petId"]);
  });

  it("names the known environments when one is not found", async () => {
    const r = await run(["staging"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Environment not found: staging/);
    expect(r.err).toMatch(/Known: local, prod/);
  });

  it("requires two names for --diff", async () => {
    const r = await run(["--diff", "local"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--diff needs two environment names/);
  });

  it("exits 1 when the workspace has no environments", async () => {
    rmSync(join(dir, "environments"), { recursive: true, force: true });
    const r = await run([]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/No environments found/);
  });

  it("warns about an unparseable environment but still lists the rest", async () => {
    writeFileSync(join(dir, "environments", "broken.env.yaml"), "name: [unclosed\n");
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/could not read environments\/broken.env.yaml/);
    expect(r.out).toContain("local");
  });
});

describe("truspec env --diff, as a gate", () => {
  it("marks which of the differing names are secrets", async () => {
    // "only in prod: apiKey" reads as a missing variable unless you know apiKey is a secret — and
    // the fix differs: a variable is added to the file, a secret is set where the run happens.
    const r = await run(["--diff", "local", "prod"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("+ apiKey  (secret)");
    expect(r.out).toContain("- petId");
    expect(r.out).not.toContain("- petId  (secret)");
  });

  it("--strict fails when either side declares a name the other does not", async () => {
    const r = await run(["--diff", "local", "prod", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/2 name\(s\) declared in only one of local, prod/);
  });

  it("--strict does not fail on a differing value, which is the point of environments", async () => {
    writeFileSync(
      join(dir, "environments", "b.env.yaml"),
      'tspec: "0.1"\nname: b\nvariables: { baseUrl: "https://other.example.com", petId: "9" }\nsecrets: [token]\n',
    );
    const r = await run(["--diff", "local", "b", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("different (2)");
  });

  it("still exits 0 without --strict, because a difference is information", async () => {
    expect((await run(["--diff", "local", "prod"])).code).toBe(0);
  });

  it("reports the secret names in --json, for a machine that has to decide the same thing", async () => {
    const r = await run(["--diff", "local", "prod", "--json"]);
    expect(JSON.parse(r.out).secretNames).toEqual(["apiKey", "token"]);
  });
});
