import { describe, expect, it } from "vitest";
import { authBadge, bodyBadge, scriptBadge } from "../src/components/RequestWorkspace";

describe("bodyBadge", () => {
  it("counts the parts of a keyed body, where the count is the useful part", () => {
    expect(bodyBadge({ type: "multipart", fields: { a: "1", b: { file: "./x" } } })).toBe("multipart 2");
    expect(bodyBadge({ type: "form", content: { a: "1" } })).toBe("form 1");
  });

  it("names the type of the rest, where the type is", () => {
    expect(bodyBadge({ type: "json", content: {} })).toBe("json");
    expect(bodyBadge({ type: "text", content: "hi" })).toBe("text");
    expect(bodyBadge({ type: "graphql", query: "{ a }" })).toBe("graphql");
  });

  it("says nothing for no body — `body none` would read worse than a bare tab", () => {
    expect(bodyBadge(undefined)).toBeUndefined();
    expect(bodyBadge({ type: "none" })).toBeUndefined();
  });

  it("counts an empty keyed body as zero rather than hiding it: the type is still a fact", () => {
    expect(bodyBadge({ type: "multipart", fields: {} })).toBe("multipart 0");
  });
});

describe("authBadge", () => {
  it("names the scheme", () => {
    expect(authBadge({ type: "bearer", token: "{{t}}" })).toBe("bearer");
    expect(authBadge({ type: "basic", username: "u", password: "p" })).toBe("basic");
  });

  it("says nothing for no auth", () => {
    expect(authBadge(undefined)).toBeUndefined();
    expect(authBadge({ type: "none" })).toBeUndefined();
  });
});

describe("scriptBadge", () => {
  it("names the phases that are present, in run order", () => {
    expect(scriptBadge({ pre: "x" })).toBe("pre");
    expect(scriptBadge({ post: "x" })).toBe("post");
    expect(scriptBadge({ pre: "x", post: "y" })).toBe("pre+post");
  });

  it("treats an empty script string as no script", () => {
    expect(scriptBadge({ pre: "" })).toBeUndefined();
    expect(scriptBadge({})).toBeUndefined();
    expect(scriptBadge(undefined)).toBeUndefined();
  });
});
