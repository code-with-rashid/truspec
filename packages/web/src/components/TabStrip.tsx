export interface TabStripItem {
  path: string;
  name: string;
  method: string;
  dirty: boolean;
}

export function TabStrip({
  tabs,
  activePath,
  onSelect,
  onClose,
  onContextMenu,
}: {
  tabs: TabStripItem[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onContextMenu: (x: number, y: number, path: string) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    // The row used to be a `role="button"` div wrapping the close button: a `nested-interactive`
    // violation (a screen reader cannot reach the inner control), and keyboard-inert besides —
    // `tabIndex={0}` with no key handler looks focusable but does nothing on Enter. Selection and
    // close are now two sibling buttons, operable for free, in a container with no interactive
    // role. Deliberately NOT a `role="tablist"`: that requires every child to be a `role="tab"`
    // (the close buttons are not) and implies tabpanels this UI does not have. These are open
    // documents, so `aria-current` is the honest way to mark the active one.
    <nav className="tab-strip" aria-label="open requests">
      {tabs.map((t) => (
        <div
          key={t.path}
          className={`tab-strip-item ${t.path === activePath ? "active" : ""}`}
          onContextMenu={(e) => {
            e.preventDefault();
            onContextMenu(e.clientX, e.clientY, t.path);
          }}
        >
          <button
            type="button"
            aria-current={t.path === activePath ? "page" : undefined}
            className="tab-strip-main"
            title={t.path}
            onClick={() => onSelect(t.path)}
          >
            <span className={`m m-${t.method}`}>{t.method}</span>
            <span className="tab-strip-name">{t.name}</span>
            {t.dirty && <span className="tab-strip-dot" title="unsaved changes" />}
          </button>
          <button
            type="button"
            className="tab-strip-close"
            title="close"
            aria-label={`close ${t.name}`}
            onClick={onClose.bind(null, t.path)}
          >
            ✕
          </button>
        </div>
      ))}
    </nav>
  );
}
