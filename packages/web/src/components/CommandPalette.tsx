import { useEffect, useRef } from "react";
import type { RequestSummary } from "../api";
import { folderOf } from "../tree";

export interface PaletteCommand {
  id: string;
  label: string;
}

export function CommandPalette({
  query,
  onQuery,
  items,
  commands,
  total,
  onSelect,
  onRunCommand,
  onClose,
}: {
  query: string;
  onQuery: (q: string) => void;
  items: RequestSummary[];
  /** Non-request actions the palette's own placeholder promises ("run, or view…") — jumping to a
   * view, running the whole collection — shown above request matches, distinguished by a "→"
   * glyph rather than a method badge so they're never mistaken for a request. */
  commands: PaletteCommand[];
  total: number;
  onSelect: (path: string) => void;
  onRunCommand: (id: string) => void;
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
            onKeyDown={(e) => {
              // The footer advertises "↵ open" — Enter must open the top match, matching the
              // mouse-click behavior on a `.palette-item`/`.palette-cmd`. Commands rank first.
              if (e.key !== "Enter") return;
              if (commands[0]) onRunCommand(commands[0].id);
              else if (items[0]) onSelect(items[0].path);
            }}
            placeholder="jump to a request, run, or view…"
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list">
          {commands.map((c) => (
            <button key={c.id} className="palette-item palette-cmd" onClick={() => onRunCommand(c.id)}>
              <span className="palette-cmd-glyph">→</span>
              <span className="palette-item-main">
                <span className="palette-item-name">{c.label}</span>
              </span>
            </button>
          ))}
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
          {items.length === 0 && commands.length === 0 && <div className="palette-empty">no matches.</div>}
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
