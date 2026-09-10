import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { generateCode } from "../src/codegen";
import { parse } from "../src/format";
import { runRequest } from "../src/runner/run";

const run = promisify(execFile);

interface Arrived {
  target: string;
  headers: Record<string, string>;
  body: string;
}

/** A loopback server that records every request it receives, verbatim. */
async function recorder(): Promise<{ url: (path: string) => string; got: Arrived[]; close: () => Promise<void> }> {
  const got: Arrived[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        // Hop-by-hop and client-chosen headers are not what a generator is responsible for.
        if (["host", "connection", "content-length", "accept-encoding", "user-agent", "accept-language"].includes(k)) {
          continue;
        }
        headers[k] = String(v);
      }
      got.push({ target: req.url ?? "", headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    got,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/**
 * The promise a generated snippet makes is "run this and you get the same request". Every other
 * codegen test asserts the snippet's *text*, which cannot tell whether it runs at all — and for a
 * long time the `curl` one did not, because the URL went out exactly as authored and `curl`
 * rejects a raw space with `URL rejected: Malformed input to a URL function`.
 *
 * This test crosses that seam with the one runtime always available here: it executes the
 * javascript-fetch snippet in a real Node process and compares what arrived against what the
 * runner itself sent for the same file.
 */
describe("a generated snippet reproduces the request", () => {
  it("sends the same target, headers and body as the runner", async () => {
    const rec = await recorder();
    const dir = mkdtempSync(join(tmpdir(), "truspec-codegen-fidelity-"));
    try {
      // Every awkward character in one request: a space in the query (illegal in a URL as typed),
      // a double quote in a header value, and an apostrophe in the JSON body.
      const req = parse.request.parse(
        `tspec: "0.1"
name: Awkward
method: POST
url: "${rec.url("/things?expand=owner&q=a b")}"
headers:
  Accept: application/json
  X-Note: 'say "hi"'
body:
  type: json
  content:
    name: "it's"
    tags: ["a", "b"]
assertions:
  - { type: status, equals: 200 }
`,
      );

      await runRequest(req, {});
      const fromRunner = rec.got[0];
      expect(fromRunner).toBeDefined();

      const { code } = generateCode(req, "javascript-fetch");
      const script = join(dir, "snippet.mjs");
      writeFileSync(script, code);
      await run(process.execPath, [script]);
      const fromSnippet = rec.got[1];
      expect(fromSnippet).toBeDefined();

      expect(fromSnippet!.target).toBe(fromRunner!.target);
      expect(fromSnippet!.headers).toEqual(fromRunner!.headers);
      // The snippet pretty-prints its JSON so a reader can follow it; the request it describes is
      // the same one.
      expect(JSON.parse(fromSnippet!.body)).toEqual(JSON.parse(fromRunner!.body));
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await rec.close();
    }
  }, 20_000);

  /**
   * The snippet above is executed by `fetch`, which normalizes an illegal URL itself — so it
   * cannot see the defect that motivated this file. `curl` can: it refuses one outright. It ships
   * with every CI image this project runs on, but the test skips rather than fails where it does
   * not, since a missing shell tool is not a defect in the generator.
   */
  it("emits a curl command that actually runs", async () => {
    // The snippet is a shell command, so the premise is a POSIX shell *and* curl. Windows ships
    // `curl.exe` but no `/bin/sh`, so checking only for curl would fail there rather than skip.
    const runnable =
      existsSync("/bin/sh") &&
      (await run("curl", ["--version"]).then(
        () => true,
        () => false,
      ));
    if (!runnable) return;

    const rec = await recorder();
    try {
      const req = parse.request.parse(
        `tspec: "0.1"\nname: Space\nurl: "${rec.url("/things?q=a b")}"\nassertions: []\n`,
      );
      const { code } = generateCode(req, "curl");
      // The snippet is a shell command; `-s` keeps curl's progress meter out of the test output.
      await run("/bin/sh", ["-c", `${code.replace(/^curl /, "curl -s ")}`]);
      expect(rec.got[0]?.target).toBe("/things?q=a%20b");
    } finally {
      await rec.close();
    }
  }, 20_000);

  it("emits a URL a shell client will accept, encoding what the runner leaves to fetch", () => {
    const req = parse.request.parse(
      'tspec: "0.1"\nname: Space\nurl: "https://api.test/things?q=a b"\nassertions: []\n',
    );
    expect(generateCode(req, "curl").code).toContain("https://api.test/things?q=a%20b");
    expect(generateCode(req, "curl").code).not.toContain("q=a b");
  });

  it("leaves a URL still carrying a placeholder verbatim, for a reader to fill in", () => {
    const req = parse.request.parse(
      'tspec: "0.1"\nname: Var\nurl: "{{baseUrl}}/pets/{{petId}}"\nassertions: []\n',
    );
    expect(generateCode(req, "curl").code).toContain("{{baseUrl}}/pets/{{petId}}");
  });

  it("leaves a relative URL verbatim, having no base to resolve it against", () => {
    const req = parse.request.parse('tspec: "0.1"\nname: Rel\nurl: "/pets/1"\nassertions: []\n');
    expect(generateCode(req, "curl").code).toContain("'/pets/1'");
  });
});
