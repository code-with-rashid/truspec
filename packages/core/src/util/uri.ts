/**
 * `decodeURIComponent` that returns its input unchanged instead of throwing a
 * `URIError` on a malformed `%`-escape. Used on untrusted import/spec data
 * (Postman URLs, OpenAPI `$ref` segments) where one bad escape must not abort
 * the whole parse.
 */
export function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
