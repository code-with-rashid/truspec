import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFetch } from "../src/transport";

/** A self-signed certificate valid for 127.0.0.1, written into `dir`. */
function selfSigned(dir: string, prefix: string): { cert: string; key: string } {
  const key = join(dir, `${prefix}.key.pem`);
  const cert = join(dir, `${prefix}.cert.pem`);
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", key, "-out", cert,
      "-days", "1", "-subj", "/CN=127.0.0.1",
      "-addext", "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  return { cert, key };
}

/**
 * Whether a usable `openssl` can actually produce the fixture.
 *
 * Checked by generating one rather than by running `openssl version`: the certificate needs
 * `-addext`, which older builds lack, and a platform where any part of this misbehaves should
 * *skip* — a missing or quirky shell tool is not a defect in the transport.
 */
function canMakeCerts(): boolean {
  let probe: string | undefined;
  try {
    probe = mkdtempSync(join(tmpdir(), "truspec-tls-probe-"));
    selfSigned(probe, "probe");
    return true;
  } catch {
    return false;
  } finally {
    if (probe) rmSync(probe, { recursive: true, force: true });
  }
}

/**
 * `--insecure`, `--ca` and the client-certificate flags decide whether a connection is verified.
 * They were tested only for "reading the file does not throw" — nothing asserted that `--ca`
 * actually trusts the CA, and nothing would have caught it silently doing what `--insecure` does.
 * These run against a real HTTPS server with a real self-signed certificate, and include the
 * negative control that makes the positive result mean something.
 */
describe.skipIf(!canMakeCerts())("transport TLS flags, against a real HTTPS server", () => {
  let dir: string;
  let server: Server;
  let url: string;
  let ownCa: string;
  let otherCa: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "truspec-tls-"));
    const mine = selfSigned(dir, "server");
    ownCa = mine.cert;
    // A second, unrelated self-signed certificate: trusting it must NOT let the first one through.
    otherCa = selfSigned(dir, "other").cert;
    server = createServer(
      { key: readFileSync(mine.key), cert: readFileSync(mine.cert) },
      (_q, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
      },
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    url = `https://127.0.0.1:${(server.address() as { port: number }).port}/x`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(() => r(undefined)));
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects an untrusted certificate by default", async () => {
    await expect(fetch(url)).rejects.toThrow();
  });

  it("accepts it with --insecure", async () => {
    const f = buildFetch({ insecure: true }, dir);
    const r = await f!(url);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('{"ok":true}');
  });

  it("accepts it with --ca naming that certificate", async () => {
    const f = buildFetch({ ca: [ownCa] }, dir);
    const r = await f!(url);
    expect(r.status).toBe(200);
  });

  it("still rejects it with --ca naming a different certificate", async () => {
    // The control: without this, `--ca` passing would be consistent with it quietly disabling
    // verification altogether, which is the failure mode that matters here.
    const f = buildFetch({ ca: [otherCa] }, dir);
    await expect(f!(url)).rejects.toThrow();
  });

  it("resolves a --ca path relative to the working directory", async () => {
    const f = buildFetch({ ca: ["server.cert.pem"] }, dir);
    const r = await f!(url);
    expect(r.status).toBe(200);
  });
});
