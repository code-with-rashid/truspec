import { useEffect, useRef } from "react";

export interface ShortcutRow {
  keys: string[];
  what: string;
}

export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

/** `⌘` on Apple platforms, `Ctrl` elsewhere — shown as the user's own keyboard labels it. */
export const modKey = (): string =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** Every shortcut the app binds, in one place — the reference and the bindings can't drift apart. */
export function shortcutGroups(mod = modKey()): ShortcutGroup[] {
  return [
    {
      title: "anywhere",
      rows: [
        { keys: [mod, "K"], what: "command palette — jump to a request, run, or switch view" },
        { keys: ["?"], what: "this list" },
        { keys: ["Esc"], what: "close the palette, a dialog, or cancel an edit" },
      ],
    },
    {
      title: "the open request",
      rows: [
        { keys: [mod, "↵"], what: "send" },
        { keys: ["↵"], what: "send (from the URL field)" },
        { keys: [mod, "S"], what: "save" },
      ],
    },
    {
      title: "tabs",
      rows: [
        { keys: [mod, "Alt", "←"], what: "previous tab" },
        { keys: [mod, "Alt", "→"], what: "next tab" },
        { keys: [mod, "Alt", "W"], what: "close the current tab" },
      ],
    },
  ];
}

/**
 * A shortcut reference.
 *
 * The app bound several shortcuts and advertised none of them — an unlisted shortcut is one only
 * the person who wrote it uses. `?` opens this, and the palette lists it too, so it is reachable
 * both by guess and by search.
 */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>keyboard shortcuts</span>
          <button ref={closeRef} className="btn ghost small" onClick={onClose}>
            close
          </button>
        </div>
        <div className="modal-body">
          {shortcutGroups().map((group) => (
            <div key={group.title} className="shortcut-group">
              <div className="shortcut-title">{group.title}</div>
              {group.rows.map((row) => (
                <div key={row.what} className="shortcut-row">
                  <span className="shortcut-keys">
                    {row.keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                  <span className="shortcut-what">{row.what}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
