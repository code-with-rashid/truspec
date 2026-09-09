import { useEffect, useMemo, useRef, useState } from "react";
import {
  codegen,
  codegenTargets,
  type CodegenTargetInfo,
  type RequestDetail,
} from "../api";

const LANG_KEY = "truspec.codegenLang";

/**
 * "Code" panel — renders the current request as a runnable snippet in another client or language.
 *
 * Generation happens server-side through the same engine the runner uses, so the snippet shows the
 * request as it will actually be sent: folder base URL, inherited headers and auth applied, and the
 * active environment's variables substituted (anything unresolved keeps its `{{name}}` placeholder
 * so the reader can see what to fill in). This replaces the old client-side curl-only builder,
 * which duplicated the resolution rules and drifted from them.
 */
export function CodeModal({
  request,
  path,
  env,
  onClose,
}: {
  request: RequestDetail;
  path?: string;
  env?: string;
  onClose: () => void;
}) {
  const [targets, setTargets] = useState<CodegenTargetInfo[]>([]);
  const [lang, setLang] = useState<string>(
    () => window.localStorage.getItem(LANG_KEY) ?? "curl",
  );
  const [code, setCode] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void codegenTargets()
      .then((r) => setTargets(r.targets))
      .catch(() => setTargets([]));
  }, []);

  // Strip client-only fields (`raw` is the YAML source) before the object hits schema validation.
  const payload = useMemo(() => {
    const { raw: _raw, ...rest } = request as RequestDetail & { raw?: string };
    return rest as unknown as Record<string, unknown>;
  }, [request]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void codegen(payload, lang, path, env)
      .then((r) => {
        if (cancelled) return;
        setError(r.ok ? null : (r.error ?? "could not generate"));
        setCode(r.code ?? "");
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payload, lang, path, env]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickLang = (id: string): void => {
    setLang(id);
    // Remember the language: a developer generating snippets is almost always in one stack.
    try {
      window.localStorage.setItem(LANG_KEY, id);
    } catch {
      // private mode / storage disabled — the picker still works for this session.
    }
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard permission denied/unavailable — nothing else useful to do here.
    }
  };

  const groups = useMemo(() => {
    const byGroup = new Map<string, CodegenTargetInfo[]>();
    for (const t of targets) {
      const list = byGroup.get(t.group);
      if (list) list.push(t);
      else byGroup.set(t.group, [t]);
    }
    return [...byGroup.entries()];
  }, [targets]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>code — {request.name}</span>
          <button ref={closeRef} className="btn ghost small" onClick={onClose}>
            close
          </button>
        </div>
        <div className="modal-body code-modal">
          <div className="code-toolbar">
            <label className="code-lang">
              language
              <select
                className="kv-input"
                value={lang}
                onChange={(e) => pickLang(e.target.value)}
                aria-label="snippet language"
              >
                {groups.map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <span className="spacer" />
            <button className="btn ghost small" disabled={!code} onClick={() => void copy()}>
              {copied ? "copied ✓" : "copy"}
            </button>
          </div>
          {error && <div className="err">{error}</div>}
          <pre className="code-out" aria-live="polite" aria-busy={loading}>
            {loading && !code ? "generating…" : code}
          </pre>
          {env ? (
            <p className="muted small">
              Variables resolved against <strong>{env}</strong>; anything still shown as{" "}
              <code>{"{{name}}"}</code> has no value in that environment.
            </p>
          ) : (
            <p className="muted small">
              No environment selected — <code>{"{{name}}"}</code> placeholders are left as authored.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
