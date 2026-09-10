import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportCommand } from "../src/commands/export";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-export-"));
  mkdirSync(join(dir, "api", "users"), { recursive: true });
  writeFileSync(
    join(dir, "api", "folder.tspec.yaml"),
    'tspec: "0.1"\nname: Shop API\nbaseUrl: "{{baseUrl}}"\nheaders: { Accept: application/json }\nauth: { type: bearer, token: "{{token}}" }\n',
  );
  writeFileSync(
    join(dir, "api", "users", "list.tspec.yaml"),
    `tspec: "0.1"\nname: List users\nmethod: GET\nurl: "/users"\nquery: { limit: 10 }\nassertions:\n  - { type: status, equals: 200 }\n`,
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

const run = async (argv: string[]) => {
  const cap = capture();
  const code = await exportCommand(argv, { cwd: dir, processEnv: {}, stdout: cap.stdout, stderr: cap.stderr });
  return { code, out: cap.out, err: cap.err };
};

/** The single request in the fixture, wherever it sits in the exported tree. */
function onlyRequest(json: string): { method: string; url: string; header: Array<{ key: string }>; auth?: { type: string } } {
  const found: unknown[] = [];
  const walk = (items: unknown[]): void => {
    for (const raw of items) {
      const it = raw as { item?: unknown[]; request?: unknown };
      if (it.item) walk(it.item);
      else if (it.request) found.push(it.request);
    }
  };
  walk((JSON.parse(json) as { item: unknown[] }).item);
  expect(found).toHaveLength(1);
  return found[0] as ReturnType<typeof onlyRequest>;
}

/**
 * `exportPostman` has existed in core and behind the web UI's export button for a long time; the
 * CLI had no way to reach it, so "you are not locked in" only held for people already running the
 * UI. Handing a collection to someone who works in Postman is a scripting job — a release step, a
 * CI artifact — which is where a CLI belongs.
 */
describe("truspec export postman", () => {
  it("writes a v2.1 collection to stdout", async () => {
    const r = await run(["postman", "api"]);
    expect(r.code).toBe(0);
    const c = JSON.parse(r.out) as { info: { name: string; schema: string } };
    expect(c.info.schema).toContain("v2.1.0");
    expect(c.info.name).toBe("Shop API");
  });

  it("names the collection from --name when given", async () => {
    const r = await run(["postman", "api", "--name", "Custom"]);
    expect((JSON.parse(r.out) as { info: { name: string } }).info.name).toBe("Custom");
  });

  it("takes the directory as a positional or --dir, and refuses a conflict", async () => {
    expect((await run(["postman", "api"])).code).toBe(0);
    expect((await run(["postman", "--dir", "api"])).code).toBe(0);
    const clash = await run(["postman", "api", "--dir", "other"]);
    expect(clash.code).toBe(2);
    expect(clash.err).toContain("Conflicting collection directory");
  });

  it("writes to a file with --output, keeping stdout for the JSON otherwise", async () => {
    const out = join(dir, "collection.json");
    const r = await run(["postman", "api", "--output", out]);
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8"))).toHaveProperty("info");
  });

  it("puts warnings and counts on stderr, so a redirect gets clean JSON", async () => {
    writeFileSync(
      join(dir, "api", "users", "opts.tspec.yaml"),
      'tspec: "0.1"\nname: Has options\nurl: "/x"\noptions: { retries: 2 }\nassertions: []\n',
    );
    const r = await run(["postman", "api"]);
    expect(r.err).toContain("warning:");
    // The whole of stdout must still be the collection.
    expect(() => JSON.parse(r.out)).not.toThrow();
  });

  it("refuses an unknown target by name, and says what is known", async () => {
    const r = await run(["insomnia", "api"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Unknown export target "insomnia"');
    expect(r.err).toContain("postman");
  });

  it("refuses a missing path and a file where a directory belongs", async () => {
    expect((await run(["postman", "nope"])).err).toContain("Path not found: nope");
    writeFileSync(join(dir, "a.txt"), "x");
    expect((await run(["postman", "a.txt"])).err).toContain("Not a directory");
  });

  it("fails rather than emitting an empty collection", async () => {
    mkdirSync(join(dir, "empty"));
    const r = await run(["postman", "empty"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("No requests found");
  });
});

/**
 * The export dropped everything `folder.tspec.yaml` contributes — base URL, inherited headers,
 * inherited auth — so a request came out as `/users` with no credential. It parsed, it imported,
 * and it could not run: the one outcome an export must not produce, since its whole purpose is
 * handing the collection to someone else.
 */
describe("an exported request carries its folder chain", () => {
  it("prepends the folder's baseUrl", async () => {
    const req = onlyRequest((await run(["postman", "api"])).out);
    expect(req.url).toBe("{{baseUrl}}/users?limit=10");
  });

  it("keeps {{vars}} unresolved — Postman spells them the same way", async () => {
    expect(onlyRequest((await run(["postman", "api"])).out).url).toContain("{{baseUrl}}");
  });

  it("carries inherited headers", async () => {
    const req = onlyRequest((await run(["postman", "api"])).out);
    expect(req.header.map((h) => h.key)).toContain("Accept");
  });

  it("carries inherited auth as Postman's auth block", async () => {
    expect(onlyRequest((await run(["postman", "api"])).out).auth?.type).toBe("bearer");
  });

  it("does not also send the credential as a header", async () => {
    // resolveRequest materialises auth into an Authorization header and Postman's auth block adds
    // one too; a request carrying both sends the credential twice.
    const req = onlyRequest((await run(["postman", "api"])).out);
    expect(req.header.map((h) => h.key.toLowerCase())).not.toContain("authorization");
  });

  it("folds query into the URL exactly once", async () => {
    const req = onlyRequest((await run(["postman", "api"])).out);
    expect(req.url.match(/limit=10/g)).toHaveLength(1);
  });
});
