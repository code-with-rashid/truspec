import type { RequestDetail } from "../api";

type Script = RequestDetail["script"];

const BLOCKS: Array<{ key: "pre" | "post"; label: string; hint: string }> = [
  {
    key: "pre",
    label: "pre-request",
    hint: "runs before the request is resolved — use tr.set(name, value) to compute dynamic values (timestamps, nonces, signatures) referenced elsewhere as {{name}}.",
  },
  {
    key: "post",
    label: "post-response",
    hint: "runs after the response arrives — use tr.set(name, tr.response.json.foo) to capture values, or tr.expect(cond, msg) to assert.",
  },
];

/** Was a read-only <pre> dump — the only way to add, edit, or remove a script was the raw YAML
 * editor, with no affordance even hinting that was possible. Matches the textarea-based editing
 * pattern BodyEditor already uses for its text/graphql bodies. */
export function ScriptEditor({ script, onChange }: { script?: Script; onChange: (script: Script) => void }) {
  const setBlock = (key: "pre" | "post", value: string | undefined): void => {
    const next: Script = { ...script };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  return (
    <>
      {BLOCKS.map(({ key, label, hint }) => {
        const value = script?.[key];
        return (
          <div className="script-block" key={key}>
            {value === undefined ? (
              <button className="btn ghost small" onClick={() => setBlock(key, "")}>
                + add {label} script
              </button>
            ) : (
              <>
                <div className="type-row">
                  <span className="type-label">{label}</span>
                  <span className="spacer" />
                  <button className="btn ghost small" onClick={() => setBlock(key, undefined)}>
                    remove
                  </button>
                </div>
                <textarea className="script-text" spellCheck={false} value={value} onChange={(e) => setBlock(key, e.target.value)} />
                <p className="captured-hint" style={{ marginTop: 7 }}>
                  {hint}
                </p>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
