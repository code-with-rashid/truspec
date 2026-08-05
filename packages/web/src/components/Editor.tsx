import { useEffect, useRef, useState } from "react";

export type EditMode = "edit" | "new";

export function Editor({
  mode,
  initialPath,
  initialText,
  err,
  saving,
  onSave,
  onCancel,
}: {
  mode: EditMode;
  initialPath: string;
  initialText: string;
  err: string | null;
  saving: boolean;
  onSave: (path: string, text: string) => void;
  onCancel: () => void;
}) {
  // Draft lives here (seeded once per mount via key) so keystrokes don't re-render App.
  const [path, setPath] = useState(initialPath);
  const [text, setText] = useState(initialText);
  const save = () => {
    const p = path.trim();
    if (p) onSave(p, text);
  };
  // "Esc to cancel" / "⌘/Ctrl+Enter to save" (per the hint) must work the moment the editor is open —
  // not only when the textarea happens to be focused. A keydown handler scoped to the textarea misses
  // the path input, the buttons, and the just-opened state (focus still on the "+ new" button). A
  // document-level listener covers all of those; refs keep it calling the latest save/cancel without
  // re-binding on every keystroke.
  const saveRef = useRef(save);
  saveRef.current = save;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelRef.current();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        saveRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="editor">
      <div className="editor-bar">
        <span className="editor-title">{mode === "new" ? "new request" : "edit request"}</span>
        {mode === "new" ? (
          <input
            className="path-input"
            aria-label="file path"
            value={path}
            spellCheck={false}
            placeholder="folder/name.tspec.yaml"
            onChange={(e) => setPath(e.target.value)}
          />
        ) : (
          <code className="path-fixed">{path}</code>
        )}
        <span className="grow" />
        <button className="btn ghost small" onClick={onCancel} disabled={saving}>
          cancel
        </button>
        <button className="btn run small" onClick={save} disabled={saving || !path.trim()}>
          {saving ? "saving…" : "save"}
        </button>
      </div>
      <textarea
        className="editor-text"
        aria-label="request YAML"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      {err ? <div className="editor-err">{err}</div> : <div className="editor-hint muted">validated against the schema on save · ⌘/Ctrl+Enter to save · Esc to cancel</div>}
    </div>
  );
}
