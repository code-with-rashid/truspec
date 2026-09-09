import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { CookieJar, runRequest, setCookiesOf } from "../src/runner";
import { runPath } from "../src/workspace";

const at = (s: string): number => Date.parse(s);
const NOW = at("2026-01-01T00:00:00Z");

describe("CookieJar storage", () => {
  it("stores a cookie and sends it back to the same host and path", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://api.test/login", ["sid=abc"], NOW);
    expect(jar.headerFor("https://api.test/me", NOW)).toBe("sid=abc");
  });

  it("does not leak a cookie to another host", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://api.test/login", ["sid=abc"], NOW);
    expect(jar.headerFor("https://other.test/me", NOW)).toBeUndefined();
  });

  it("treats a host-only cookie as exact, and a Domain cookie as covering subdomains", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://api.test/", ["host=1"], NOW);
    jar.setFromResponse("https://api.test/", ["wide=1; Domain=api.test"], NOW);
    expect(jar.headerFor("https://sub.api.test/", NOW)).toBe("wide=1");
    expect(jar.headerFor("https://api.test/", NOW)).toContain("host=1");
  });

  it("refuses a Domain that the setting host does not belong to", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://evil.test/", ["sid=1; Domain=api.test"], NOW);
    expect(jar.headerFor("https://api.test/", NOW)).toBeUndefined();
    // …and the cookie falls back to the setting host rather than vanishing.
    expect(jar.headerFor("https://evil.test/", NOW)).toBe("sid=1");
  });

  it("does not let a look-alike host match a domain cookie", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://api.test/", ["sid=1; Domain=api.test"], NOW);
    expect(jar.headerFor("https://evilapi.test/", NOW)).toBeUndefined();
  });

  it("scopes by path, defaulting to the directory of the setting URL", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://api.test/admin/login", ["sid=1"], NOW);
    expect(jar.headerFor("https://api.test/admin/users", NOW)).toBe("sid=1");
    expect(jar.headerFor("https://api.test/public", NOW)).toBeUndefined();
    // A path prefix only matches on a segment boundary.
    jar.setFromResponse("https://api.test/", ["p=1; Path=/api"], NOW);
    expect(jar.headerFor("https://api.test/api/x", NOW)).toContain("p=1");
    expect(jar.headerFor("https://api.test/apifoo", NOW) ?? "").not.toContain("p=1");
  });

  it("withholds a Secure cookie from a plaintext request", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://api.test/", ["sid=1; Secure"], NOW);
    expect(jar.headerFor("https://api.test/x", NOW)).toBe("sid=1");
    expect(jar.headerFor("http://api.test/x", NOW)).toBeUndefined();
  });

  it("honors Expires, prefers Max-Age over it, and treats a past expiry as a deletion", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://api.test/", ["a=1; Expires=Thu, 01 Jan 2026 01:00:00 GMT"], NOW);
    expect(jar.headerFor("https://api.test/", NOW)).toBe("a=1");
    expect(jar.headerFor("https://api.test/", NOW + 2 * 3600_000)).toBeUndefined();

    jar.setFromResponse("https://api.test/", ["b=1; Expires=Thu, 01 Jan 2020 00:00:00 GMT; Max-Age=3600"], NOW);
    expect(jar.headerFor("https://api.test/", NOW)).toContain("b=1");

    jar.setFromResponse("https://api.test/", ["b=; Expires=Thu, 01 Jan 2020 00:00:00 GMT"], NOW);
    expect(jar.headerFor("https://api.test/", NOW)).toBeUndefined();
  });

  it("replaces a cookie with the same name, path and domain", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://api.test/", ["sid=old"], NOW);
    jar.setFromResponse("https://api.test/", ["sid=new"], NOW);
    expect(jar.headerFor("https://api.test/", NOW)).toBe("sid=new");
    expect(jar.all().length).toBe(1);
  });

  it("sends the most specific path first", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://api.test/", ["broad=1; Path=/"], NOW);
    jar.setFromResponse("https://api.test/", ["narrow=1; Path=/deep/er"], NOW);
    expect(jar.headerFor("https://api.test/deep/er/x", NOW)).toBe("narrow=1; broad=1");
  });

  it("ignores malformed input rather than throwing", () => {
    const jar = new CookieJar();
    jar.setFromResponse("not a url", ["sid=1"], NOW);
    jar.setFromResponse("https://api.test/", ["", "novalue", "=orphan"], NOW);
    expect(jar.all()).toEqual([]);
    expect(jar.headerFor("also not a url", NOW)).toBeUndefined();
  });

  it("reads repeated Set-Cookie headers individually, not comma-joined", () => {
    const response = new Response("", {
      headers: [
        ["set-cookie", "a=1; Expires=Thu, 01 Jan 2027 00:00:00 GMT"],
        ["set-cookie", "b=2"],
      ],
    });
    const cookies = setCookiesOf(response);
    expect(cookies.length).toBe(2);
    // Comma-joining would have corrupted the Expires date into a second cookie.
    const jar = new CookieJar();
    jar.setFromResponse("https://api.test/", cookies, NOW);
    expect(jar.all().map((c) => c.name).sort()).toEqual(["a", "b"]);
  });
});

/** A fetch double that sets a cookie on /login and echoes what it received. */
function sessionServer(): { fetch: typeof fetch; seen: Array<{ url: string; cookie?: string }> } {
  const seen: Array<{ url: string; cookie?: string }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url, cookie: headers.Cookie ?? headers.cookie });
    if (url.endsWith("/login")) {
      return new Response("{}", { status: 200, headers: { "set-cookie": "sid=abc; Path=/" } });
    }
    if (url.endsWith("/redirect")) {
      return new Response("", {
        status: 302,
        headers: { location: "https://api.test/after", "set-cookie": "hop=1; Path=/" },
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: fn, seen };
}

describe("cookies through the runner", () => {
  const req = (name: string, url: string, extra = "") =>
    parse.request.parse(`name: ${name}\nurl: "${url}"\n${extra}assertions:\n  - { type: status, lt: 400 }\n`);

  it("sends nothing when no jar is supplied", async () => {
    const s = sessionServer();
    await runRequest(req("Login", "https://api.test/login"), { fetch: s.fetch });
    await runRequest(req("Me", "https://api.test/me"), { fetch: s.fetch });
    expect(s.seen[1]!.cookie).toBeUndefined();
  });

  it("carries a session cookie from one request to the next through a shared jar", async () => {
    const s = sessionServer();
    const cookieJar = new CookieJar();
    await runRequest(req("Login", "https://api.test/login"), { fetch: s.fetch, cookieJar });
    await runRequest(req("Me", "https://api.test/me"), { fetch: s.fetch, cookieJar });
    expect(s.seen[1]!.cookie).toBe("sid=abc");
  });

  it("stores a cookie set on a redirect hop, not just the final response", async () => {
    const s = sessionServer();
    const cookieJar = new CookieJar();
    await runRequest(req("R", "https://api.test/redirect", "options: { followRedirects: true }\n"), {
      fetch: s.fetch,
      cookieJar,
    });
    expect(cookieJar.headerFor("https://api.test/x")).toBe("hop=1");
    // …and the hop itself already carried it forward.
    expect(s.seen[1]!.cookie).toBe("hop=1");
  });

  it("lets an explicit Cookie header win over the jar", async () => {
    const s = sessionServer();
    const cookieJar = new CookieJar();
    cookieJar.setFromResponse("https://api.test/", ["sid=fromjar"]);
    await runRequest(req("Me", "https://api.test/me", 'headers:\n  Cookie: "sid=mine"\n'), {
      fetch: s.fetch,
      cookieJar,
    });
    expect(s.seen[0]!.cookie).toBe("sid=mine");
  });
});

describe("cookies through a workspace run", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "truspec-cookies-"));
    mkdirSync(join(dir, "api"), { recursive: true });
    const write = (file: string, order: number, url: string): void =>
      writeFileSync(
        join(dir, "api", file),
        `tspec: "0.1"\nname: ${file}\nurl: "${url}"\norder: ${order}\nassertions:\n  - { type: status, lt: 400 }\n`,
      );
    write("01-login.tspec.yaml", 1, "https://api.test/login");
    write("02-me.tspec.yaml", 2, "https://api.test/me");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("shares one jar across the run by default", async () => {
    const s = sessionServer();
    const result = await runPath(join(dir, "api"), { fetch: s.fetch });
    expect(result.ok).toBe(true);
    expect(s.seen[1]!.cookie).toBe("sid=abc");
  });

  it("sends nothing when cookies are turned off", async () => {
    const s = sessionServer();
    await runPath(join(dir, "api"), { fetch: s.fetch, cookies: false });
    expect(s.seen[1]!.cookie).toBeUndefined();
  });
});

describe("scoping a cookie the way a browser does", () => {
  it("sends a Secure cookie back over http on loopback", () => {
    // The one that bites in practice. `http://localhost` is what a collection points at all day,
    // and Rails/Django/Express set `Secure` on the session cookie by default: the jar stored it
    // and never sent it, so the login returned 200 and the next request 401 with no explanation.
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:4000", "http://app.localhost"]) {
      const jar = new CookieJar();
      jar.setFromResponse(`${origin}/login`, ["sid=abc; Secure; HttpOnly; Path=/"]);
      expect(jar.headerFor(`${origin}/me`), origin).toBe("sid=abc");
    }
  });

  it("still withholds a Secure cookie from plain http elsewhere", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://api.test/", ["s=1; Secure", "p=2"]);
    expect(jar.headerFor("http://api.test/")).toBe("p=2");
    expect(jar.headerFor("https://api.test/")).toBe("p=2; s=1");
  });

  it("refuses a Domain that would scope a cookie to a whole suffix", () => {
    // `Domain=com` was accepted, so a cookie set by one host was sent to every other .com host
    // the run touched. A run that talks to an auth server and an API is exactly that shape.
    const jar = new CookieJar();
    jar.setFromResponse("https://evil.com/x", ["sid=leak; Domain=com; Path=/"]);
    expect(jar.headerFor("https://api.com/v1")).toBeUndefined();
    // It is kept for the host that set it — dropping the attribute, not the cookie.
    expect(jar.headerFor("https://evil.com/x")).toBe("sid=leak");
  });

  it("still allows widening to a real registrable domain", () => {
    const jar = new CookieJar();
    jar.setFromResponse("https://a.example.com/x", ["sid=1; Domain=example.com"]);
    expect(jar.headerFor("https://b.example.com/")).toBe("sid=1");
    expect(jar.headerFor("https://notexample.com/")).toBeUndefined();
  });

  it("honours the __Host- and __Secure- name prefixes", () => {
    // The prefix is a promise about scope. Storing one that breaks it is worse than ignoring
    // prefixes entirely: the name says host-only while the jar hands it to every sibling host.
    const jar = new CookieJar();
    jar.setFromResponse("https://api.test/", [
      "__Host-a=1; Secure; Domain=api.test; Path=/", // Domain is forbidden on __Host-
      "__Host-b=2; Secure; Path=/deep", // Path must be /
      "__Host-c=3; Path=/", // must be Secure
      "__Secure-d=4", // must be Secure
      "__Host-ok=5; Secure; Path=/",
      "__Secure-ok=6; Secure",
    ]);
    expect(jar.all().map((c) => c.name).sort()).toEqual(["__Host-ok", "__Secure-ok"]);
  });
});
