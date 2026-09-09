import { jsonpath } from "@truspec/core/jsonpath";
import { useMemo, useState } from "react";
import { JsonBlock, prettyBody } from "../format-utils";

export type BodyMode = "pretty" | "raw";

/**
 * Above this many characters the body is shown as plain text instead of syntax-highlighted.
 *
 * Highlighting emits one `<span>` per token, so it is linear in tokens and brutal in DOM nodes: a
 * 1.16MB list response measured at 480,002 spans, 7.6s to first paint, and ~750ms per click
 * afterwards. One unpaginated endpoint was enough to lock the tab. Colour is a nicety; a
 * responsive page is not.
 */
const HIGHLIGHT_LIMIT = 256 * 1024;

/** Above this, only the first slice is put in the DOM — always with a visible notice saying so. */
const RENDER_LIMIT = 2 * 1024 * 1024;

interface Match {
  /** Dotted path of this match, usable verbatim in an assertion or capture. */
  path: string;
  value: unknown;
}

/**
 * Response body viewer with a filter box that doubles as a **path picker**.
 *
 * Reading a body is only half the job — the other half is turning what you found into an
 * assertion, which every other client leaves you to do by hand (read the body, retype the path,
 * hope you got it right). Here a `$.`-prefixed filter evaluates the real JSONPath engine against
 * the real response, shows exactly what it selects, and offers one click to assert or capture it.
 * A filter that doesn't start with `$` is a plain text search over the body instead.
 */
export function ResponseBody({
  bodyText,
  onAssert,
  onCapture,
}: {
  bodyText: string;
  /** Append `{ type: jsonpath, path, exists: true }` to the request's assertions. */
  onAssert?: (path: string) => void;
  /** Capture the value at `path` into a named variable. */
  onCapture?: (path: string, name: string) => void;
}) {
  const [mode, setMode] = useState<BodyMode>("pretty");
  const [wrap, setWrap] = useState(true);
  const [filter, setFilter] = useState("");
  const [captureFor, setCaptureFor] = useState<string | null>(null);
  const [captureName, setCaptureName] = useState("");

  // Pretty-printing inflates the text ~1.5x, so skip it for a body already past what we render.
  const pretty = useMemo(
    () => (bodyText.length > RENDER_LIMIT ? bodyText : prettyBody(bodyText)),
    [bodyText],
  );
  const full = mode === "pretty" ? pretty : bodyText;
  const truncated = full.length > RENDER_LIMIT;
  const shown = truncated ? full.slice(0, RENDER_LIMIT) : full;
  const highlight = shown.length <= HIGHLIGHT_LIMIT;
  const isPathFilter = filter.trimStart().startsWith("$");

  const json = useMemo<unknown>(() => {
    try {
      return JSON.parse(bodyText) as unknown;
    } catch {
      return undefined;
    }
  }, [bodyText]);

  const pathResult = useMemo<{ matches: Match[]; error?: string } | null>(() => {
    const expr = filter.trim();
    if (!isPathFilter || expr.length < 2) return null;
    if (json === undefined) return { matches: [], error: "response body is not JSON" };
    try {
      // The engine returns values, not paths. For the common `$.a.b` / `$.a[0]` forms the path
      // *is* the expression, so a single match can be offered verbatim; a wildcard that selects
      // several values cannot name each one, and says so rather than inventing paths.
      const values = jsonpath(json, expr);
      return { matches: values.map((value) => ({ path: expr, value })) };
    } catch (e) {
      return { matches: [], error: (e as Error).message };
    }
  }, [filter, isPathFilter, json]);

  const textMatches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle || isPathFilter) return null;
    const lines = shown.split("\n");
    const hits = lines.filter((l) => l.toLowerCase().includes(needle));
    return { hits, total: lines.length };
  }, [filter, isPathFilter, shown]);

  const singleMatch = pathResult && !pathResult.error && pathResult.matches.length === 1;

  return (
    <div className="response-body">
      <div className="body-toolbar">
        <input
          className="kv-input body-filter"
          aria-label="filter response"
          spellCheck={false}
          placeholder="find text, or $.a.b[0] to select a value"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setCaptureFor(null);
          }}
        />
        {filter && (
          <button className="btn ghost small" onClick={() => setFilter("")} aria-label="clear filter">
            ✕
          </button>
        )}
        <span className="spacer" />
        <button
          className={`btn ghost small ${mode === "pretty" ? "on" : ""}`}
          onClick={() => setMode(mode === "pretty" ? "raw" : "pretty")}
          aria-pressed={mode === "pretty"}
          title="pretty-print JSON"
        >
          pretty
        </button>
        <button
          className={`btn ghost small ${wrap ? "on" : ""}`}
          onClick={() => setWrap((w) => !w)}
          aria-pressed={wrap}
          title="wrap long lines"
        >
          wrap
        </button>
      </div>

      {pathResult && (
        <div className={`path-result ${pathResult.error ? "bad" : ""}`}>
          {pathResult.error ? (
            <span>{pathResult.error}</span>
          ) : pathResult.matches.length === 0 ? (
            <span>no match</span>
          ) : (
            <>
              <span className="path-count">
                {pathResult.matches.length} match{pathResult.matches.length === 1 ? "" : "es"}
              </span>
              <code className="path-value">
                {pathResult.matches.map((m) => JSON.stringify(m.value)).join(", ")}
              </code>
              <span className="spacer" />
              {singleMatch && onAssert && (
                <button
                  className="btn ghost small add-assert"
                  aria-label="add assertion for this path"
                  onClick={() => onAssert(filter.trim())}
                  title="add an assertion for this path"
                >
                  + assert
                </button>
              )}
              {singleMatch && onCapture && (
                <button
                  className="btn ghost small add-capture"
                  aria-label="capture this path"
                  onClick={() => {
                    setCaptureFor(filter.trim());
                    setCaptureName(suggestName(filter.trim()));
                  }}
                  title="capture this value into a variable"
                >
                  + capture
                </button>
              )}
            </>
          )}
        </div>
      )}

      {captureFor && onCapture && (
        <div className="path-result">
          <label className="capture-name">
            variable
            <input
              autoFocus
              className="kv-input"
              aria-label="capture variable name"
              spellCheck={false}
              value={captureName}
              onChange={(e) => setCaptureName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && captureName.trim()) {
                  onCapture(captureFor, captureName.trim());
                  setCaptureFor(null);
                }
                if (e.key === "Escape") setCaptureFor(null);
              }}
            />
          </label>
          <button
            className="btn small capture-save"
            aria-label="save capture"
            disabled={!captureName.trim()}
            onClick={() => {
              onCapture(captureFor, captureName.trim());
              setCaptureFor(null);
            }}
          >
            save
          </button>
          <button className="btn ghost small" onClick={() => setCaptureFor(null)}>
            cancel
          </button>
        </div>
      )}

      {textMatches && (
        <div className="path-result">
          <span className="path-count">
            {textMatches.hits.length} of {textMatches.total} line{textMatches.total === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {!textMatches && (truncated || !highlight) && (
        // Never present part of a body as if it were all of it, and say why it looks plainer.
        <div className="body-truncated" role="status">
          {truncated
            ? `Large response: showing the first ${Math.round(RENDER_LIMIT / 1024)}KB of ${Math.round(full.length / 1024)}KB. Save or copy the response for the whole body.`
            : `Large response: showing all ${Math.round(full.length / 1024)}KB without syntax highlighting, to keep the page responsive.`}
        </div>
      )}

      <div className={wrap ? "body-wrap" : "body-nowrap"}>
        {textMatches ? (
          // Filtering to matching lines keeps a huge body navigable; the raw text is one click away.
          <pre className="body">{textMatches.hits.join("\n") || "no line matches"}</pre>
        ) : mode === "pretty" && highlight ? (
          <JsonBlock text={shown} />
        ) : (
          <pre className="body">{shown}</pre>
        )}
      </div>
    </div>
  );
}

/** Suggest a variable name from the last path segment (`$.data.userId` → `userId`). */
function suggestName(path: string): string {
  const segments = path.replace(/\[\d+\]/g, "").split(".").filter(Boolean);
  const last = segments[segments.length - 1] ?? "value";
  return last === "$" ? "value" : last;
}
