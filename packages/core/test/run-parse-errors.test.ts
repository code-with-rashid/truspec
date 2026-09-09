import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPath } from "../src/workspace";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-parse-err-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ok = (name: string, order: number): void =>
  writeFileSync(
    join(dir, `${name}.tspec.yaml`),
    `tspec: "0.1"\nname: ${name}\nmethod: GET\nurl: "http://x/${name}"\norder: ${order}\nassertions: [ { type: status, equals: 200 } ]\n`,
  );

const fetchOk: typeof globalThis.fetch = () => Promise.resolve(new Response("{}", { status: 200 }));

describe("a request file that does not parse", () => {
  it("does not take the rest of the run with it", async () => {
    // Before: `runPath` threw from inside a `.map`, so one typo aborted the whole run and the
    // message named no file at all.
    ok("first", 1);
    writeFileSync(join(dir, "broken.tspec.yaml"), "tspec: \"0.1\"\nname: Broken\nheadrs: { a: b }\n");
    ok("second", 2);

    const r = await runPath(dir, { fetch: fetchOk });
    expect(r.results.map((x) => x.name)).toEqual(["first", "second"]);
    expect(r.passed).toBe(2);
  });

  it("names the file, and says which key was probably meant", async () => {
    writeFileSync(join(dir, "broken.tspec.yaml"), "tspec: \"0.1\"\nname: Broken\nmethod: GET\nurl: \"http://x\"\nheadrs: { a: b }\n");
    const r = await runPath(dir, { fetch: fetchOk });
    expect(r.parseErrors?.length).toBe(1);
    expect(basename(r.parseErrors![0]!.file)).toBe("broken.tspec.yaml");
    expect(r.parseErrors![0]!.error).toContain("did you mean 'headers'?");
  });

  it("fails the run even when every request that DID parse passed", async () => {
    // The gate's whole job: a file nobody could read is not a file that passed.
    ok("first", 1);
    writeFileSync(join(dir, "broken.tspec.yaml"), "name: [unclosed\n");
    const r = await runPath(dir, { fetch: fetchOk });
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(0);
    expect(r.ok).toBe(false);
  });

  it("reports every bad file, in a stable order, not just the first", async () => {
    writeFileSync(join(dir, "b.tspec.yaml"), "tspec: \"0.1\"\nname: B\nnope: 1\n");
    writeFileSync(join(dir, "a.tspec.yaml"), "tspec: \"0.1\"\nname: A\nnope: 1\n");
    const r = await runPath(dir, { fetch: fetchOk });
    expect(r.parseErrors?.map((e) => basename(e.file))).toEqual(["a.tspec.yaml", "b.tspec.yaml"]);
  });

  it("leaves the field off entirely when everything parsed", async () => {
    ok("first", 1);
    expect((await runPath(dir, { fetch: fetchOk })).parseErrors).toBeUndefined();
  });

  it("still throws for a single explicitly-named file, where there is nothing else to run", async () => {
    // Naming one broken file is a mistake to correct, not a report to read.
    writeFileSync(join(dir, "broken.tspec.yaml"), "tspec: \"0.1\"\nname: Broken\nheadrs: { a: b }\n");
    const r = await runPath(join(dir, "broken.tspec.yaml"), { fetch: fetchOk });
    expect(r.ok).toBe(false);
    expect(r.parseErrors?.length).toBe(1);
  });
});
