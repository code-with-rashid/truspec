export interface ConfirmModalProps {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Generic confirm dialog on the shared `.modal-overlay`/`.modal` chrome (same as FlowView's import dialog). */
export function ConfirmModal({
  title,
  body,
  confirmLabel = "confirm",
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="btn ghost small" disabled={busy} onClick={onCancel}>
            close
          </button>
        </div>
        <div className="modal-body">
          <p className="muted">{body}</p>
          <div className="modal-actions">
            <button className="btn ghost" disabled={busy} onClick={onCancel}>
              cancel
            </button>
            <button className={`btn ${danger ? "danger" : "run"}`} disabled={busy} onClick={onConfirm}>
              {busy ? "…" : confirmLabel}
            </button>
          </div>
          {error && <div className="editor-err">{error}</div>}
        </div>
      </div>
    </div>
  );
}
