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
}: {
  tabs: TabStripItem[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="tab-strip">
      {tabs.map((t) => (
        <div
          key={t.path}
          className={`tab-strip-item ${t.path === activePath ? "active" : ""}`}
          onClick={() => onSelect(t.path)}
          role="button"
          tabIndex={0}
          title={t.path}
        >
          <span className={`m m-${t.method}`}>{t.method}</span>
          <span className="tab-strip-name">{t.name}</span>
          {t.dirty && <span className="tab-strip-dot" title="unsaved changes" />}
          <button
            className="tab-strip-close"
            title="close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.path);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
