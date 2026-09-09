import { useState } from "react";

interface Props {
  tags: string[] | undefined;
  onChange: (tags: string[] | undefined) => void;
}

/**
 * Edit a request's `tags`.
 *
 * `truspec run --tag smoke` has shipped since the tag field existed, and the UI showed neither
 * which requests carried a tag nor any way to add one — so the selection you run in CI was
 * invisible in the client you author in.
 */
export function TagsEditor({ tags, onChange }: Props): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const list = tags ?? [];

  const commit = (): void => {
    // Comma-separated input is what people type; splitting it beats rejecting it.
    const added = draft
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !list.includes(t));
    if (added.length > 0) onChange([...list, ...added]);
    setDraft("");
    setAdding(false);
  };

  const remove = (tag: string): void => {
    const next = list.filter((t) => t !== tag);
    // An empty array would serialize as `tags: []`, which is noise in a diff and means nothing.
    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <span className="tags-field">
      {list.map((tag) => (
        <span className="tag-chip" key={tag}>
          {tag}
          <button aria-label={`remove tag ${tag}`} title={`remove tag ${tag}`} onClick={() => remove(tag)}>
            ✕
          </button>
        </span>
      ))}
      {adding ? (
        <input
          className="tag-input"
          aria-label="new tag"
          autoFocus
          value={draft}
          placeholder="smoke, auth"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
          }}
        />
      ) : (
        <button className="tag-add" title="add a tag — `truspec run --tag <name>` runs only tagged requests" onClick={() => setAdding(true)}>
          + tag
        </button>
      )}
    </span>
  );
}
