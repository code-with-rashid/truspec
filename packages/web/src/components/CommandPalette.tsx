import { useEffect, useRef } from "react";
import type { RequestSummary } from "../api";
import { folderOf } from "../tree";

export function CommandPalette({
  query,
  onQuery,
  items,
  total,
  onSelect,
  onClose,
}: {
  query: string;
  onQuery: (q: string) => void;
  items: RequestSummary[];
  total: number;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-head">
          <span className="glyph">⌕</span>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="jump to a request, run, or view…"
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list">
          {items.map((r) => (
            <button key={r.path} className="palette-item" onClick={() => onSelect(r.path)}>
              <span className={`m m-${r.method}`}>{r.method}</span>
              <span className="palette-item-main">
                <span className="palette-item-name">{r.name}</span>
                <code className="palette-item-url">{r.url}</code>
              </span>
              <span className="palette-item-folder">{folderOf(r.path)}</span>
            </button>
          ))}
          {items.length === 0 && <div className="palette-empty">no matches.</div>}
        </div>
        <div className="palette-foot">
          <span>
            <span className="n">{total}</span> requests
          </span>
          <span className="spacer" />
          <span>↵ open</span>
          <span>local-first · no telemetry</span>
        </div>
      </div>
    </div>
  );
}
