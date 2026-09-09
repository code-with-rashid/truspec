import { sep } from "node:path";
import { describe, expect, it } from "vitest";
import { toPosixPath } from "../src/workspace/paths";

describe("toPosixPath", () => {
  it("leaves an already-posix path alone", () => {
    expect(toPosixPath("posts/get.tspec.yaml")).toBe("posts/get.tspec.yaml");
    expect(toPosixPath("get.tspec.yaml")).toBe("get.tspec.yaml");
    expect(toPosixPath("")).toBe("");
  });

  it("converts the host separator, so the same collection reads the same from any machine", () => {
    // On POSIX this is already a no-op; on Windows it is the whole point. Asserting against `sep`
    // keeps the test meaningful on both rather than only on the platform CI happens to run.
    const joined = ["posts", "nested", "get.tspec.yaml"].join(sep);
    expect(toPosixPath(joined)).toBe("posts/nested/get.tspec.yaml");
  });

  it("does not corrupt a POSIX filename that legitimately contains a backslash", () => {
    // A blanket replace(/\\/g, "/") would mangle this. Backslash is a legal filename character on
    // POSIX and an illegal one on Windows, so the conversion has to be separator-aware.
    const name = "odd\\name.tspec.yaml";
    expect(toPosixPath(name)).toBe(sep === "/" ? name : "odd/name.tspec.yaml");
  });
});
