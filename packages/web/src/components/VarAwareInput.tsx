import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

interface Trigger {
  /** Index right after the triggering `{{`. */
  start: number;
  partial: string;
}

/** Finds the nearest unclosed `{{` before the caret, if any, and the partial name typed since. */
function detectTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const openIdx = before.lastIndexOf("{{");
  if (openIdx === -1) return null;
  const between = before.slice(openIdx + 2);
  if (between.includes("}}") || between.includes("{{") || between.includes(" ")) return null;
  return { start: openIdx + 2, partial: between };
}

/** A plain text input that offers `{{var}}` autocomplete against a known set of environment
 * variable names — the same "type `{{` and get suggestions" affordance Postman/Bruno both have,
 * which a bare `<input>` bound straight to `onFieldChange` (rounds 2-3's pattern) doesn't. */
export function VarAwareInput({
  value,
  onChange,
  suggestions,
  className,
  ariaLabel,
  placeholder,
  spellCheck,
  onKeyDownExtra,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
  spellCheck?: boolean;
  onKeyDownExtra?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [triggerStart, setTriggerStart] = useState<number | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  // `.url-bar` (and other input containers) use `overflow: hidden` to clip its rounded corners —
  // a dropdown positioned relative to that box would be clipped away too, so this is measured in
  // viewport coordinates and rendered `position: fixed`, which escapes that clipping entirely.
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && ref.current) {
      ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  // Close (rather than try to track) on scroll of any ancestor — the request builder's top pane
  // scrolls internally (round 1), and re-measuring on every scroll tick isn't worth the churn for
  // a menu that's only open for the few keystrokes it takes to pick a suggestion.
  useEffect(() => {
    if (!open) return;
    const onScroll = (): void => setOpen(false);
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [open]);

  const recheck = (text: string, caret: number): void => {
    const hit = detectTrigger(text, caret);
    if (hit && suggestions.length > 0) {
      setTriggerStart(hit.start);
      setQuery(hit.partial);
      setActiveIdx(0);
      const r = ref.current?.getBoundingClientRect();
      if (r) setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const filtered = suggestions.filter((s) => s.toLowerCase().includes(query.toLowerCase())).slice(0, 8);

  const applySuggestion = (name: string): void => {
    if (triggerStart === null || !ref.current) return;
    const caret = ref.current.selectionStart ?? value.length;
    const before = value.slice(0, triggerStart);
    const afterCaret = value.slice(caret);
    const insertText = afterCaret.startsWith("}}") ? name : `${name}}}`;
    onChange(before + insertText + afterCaret);
    pendingCaret.current = before.length + insertText.length;
    setOpen(false);
  };

  return (
    <div className="var-input-wrap">
      <input
        ref={ref}
        className={className}
        aria-label={ariaLabel}
        placeholder={placeholder}
        spellCheck={spellCheck}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          recheck(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onClick={(e) => recheck(value, e.currentTarget.selectionStart ?? 0)}
        onKeyUp={(e) => {
          if (!open) recheck(value, e.currentTarget.selectionStart ?? 0);
        }}
        onKeyDown={(e) => {
          if (open && filtered.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => (i + 1) % filtered.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              const choice = filtered[activeIdx];
              if (choice !== undefined) applySuggestion(choice);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              return;
            }
          }
          onKeyDownExtra?.(e);
        }}
        onBlur={() => setOpen(false)}
      />
      {open && filtered.length > 0 && menuRect && (
        <div
          className="var-suggest"
          role="listbox"
          style={{ top: menuRect.top, left: menuRect.left, width: menuRect.width }}
        >
          {filtered.map((s, i) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={i === activeIdx}
              className={`var-suggest-item ${i === activeIdx ? "active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applySuggestion(s)}
            >
              {`{{${s}}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
