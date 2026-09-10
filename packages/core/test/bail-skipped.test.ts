import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPath } from "../src/workspace";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-bail-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seed(count: number): void {
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= count; i++) {
    writeFileSync(
      join(dir, `r${i}.tspec.yaml`),
      `tspec: "0.1"\nname: R${i}\nmethod: GET\nurl: "https://api.test/x"\norder: ${i}\nassertions:\n  - { type: status, equals: 200 }\n`,
    );
  }
}

/** Fails the first request, would pass the rest — so `--bail` stops after one. */
const failFirst = (): typeof fetch => {
  let n = 0;
  return (async () => {
    n += 1;
    return new Response("{}", { status: n === 1 ? 500 : 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
};

/**
 * `skipped` was only a count. The human report could say "4 skipped (bailed)", but a machine
 * reporter had no identities to work with — so the JUnit writer emitted a one-test suite for a
 * five-request run and the four that never ran vanished from the record.
 */
describe("a bailed run names the requests it skipped", () => {
  it("records each one, in the order it would have run", async () => {
    seed(4);
    const result = await runPath(dir, { bail: true, fetch: failFirst() });
    expect(result.results).toHaveLength(1);
    expect(result.skipped).toBe(3);
    expect(result.skippedRequests?.map((s) => s.name)).toEqual(["R2", "R3", "R4"]);
  });

  it("carries the file each came from, so a report can point at it", async () => {
    seed(2);
    const result = await runPath(dir, { bail: true, fetch: failFirst() });
    expect(result.skippedRequests?.[0]?.filePath).toBe(join(dir, "r2.tspec.yaml"));
  });

  it("sends nothing for a skipped request", async () => {
    seed(5);
    let sent = 0;
    const counting = (async () => {
      sent += 1;
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    await runPath(dir, { bail: true, fetch: counting });
    // Walking the loop to *name* the skipped requests must not mean running them.
    expect(sent).toBe(1);
  });

  it("names them across every iteration under --repeat", async () => {
    seed(2);
    const result = await runPath(dir, { bail: true, repeat: 2, fetch: failFirst() });
    // Row 1 request 1 fails; everything after it — including all of row 2 — is skipped.
    expect(result.skippedRequests?.map((s) => `${s.name}#${s.iteration}`)).toEqual([
      "R2#1",
      "R1#2",
      "R2#2",
    ]);
    expect(result.skipped).toBe(3);
  });

  it("omits the field entirely on a run that did not bail", async () => {
    seed(2);
    const ok = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const result = await runPath(dir, { bail: true, fetch: ok });
    expect(result.skipped).toBe(0);
    expect(result.skippedRequests).toBeUndefined();
  });
});
