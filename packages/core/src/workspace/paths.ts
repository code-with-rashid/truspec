import { sep } from "node:path";

/**
 * A relative path as the collection format speaks it: forward slashes, on every platform.
 *
 * `path.relative()` answers in the host OS's separator, so the same collection served from Windows
 * hands out `posts\get.tspec.yaml` where Linux hands out `posts/get.tspec.yaml`. Those strings are
 * identifiers over the HTTP API and to MCP clients, and text in generated docs and exports — none
 * of which should depend on which machine happens to be running.
 *
 * The `sep === "/"` guard is not an optimisation. A blanket `replace(/\\/g, "/")` would corrupt a
 * POSIX filename that legitimately contains a backslash; on Windows no filename can contain a
 * forward slash, so there the conversion is lossless.
 */
export function toPosixPath(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
