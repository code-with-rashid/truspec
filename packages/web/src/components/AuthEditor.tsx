import type { RequestAuth } from "../api";

export function AuthEditor({ auth, onChange }: { auth?: RequestAuth; onChange: (auth: RequestAuth) => void }) {
  const type = auth?.type ?? "none";

  const setType = (next: RequestAuth["type"]): void => {
    if (next === "none") onChange({ type: "none" });
    else if (next === "bearer") onChange({ type: "bearer", token: auth?.type === "bearer" ? auth.token : "" });
    else if (next === "basic") {
      onChange({
        type: "basic",
        username: auth?.type === "basic" ? auth.username : "",
        password: auth?.type === "basic" ? auth.password : "",
      });
    } else {
      onChange({
        type: "apikey",
        name: auth?.type === "apikey" ? auth.name : "",
        value: auth?.type === "apikey" ? auth.value : "",
        in: auth?.type === "apikey" ? auth.in : "header",
      });
    }
  };

  return (
    <>
      <div className="type-row">
        <span className="type-label">scheme</span>
        <select aria-label="auth scheme" value={type} onChange={(e) => setType(e.target.value as RequestAuth["type"])}>
          <option value="none">none</option>
          <option value="bearer">bearer</option>
          <option value="basic">basic</option>
          <option value="apikey">apikey</option>
        </select>
      </div>

      {type === "none" && <div className="muted pad">none — inherits from folder config if present.</div>}

      {auth?.type === "bearer" && (
        <>
          <div className="kv">
            <div className="kv-row">
              <span className="kv-k">token</span>
              <input
                className="kv-input"
                spellCheck={false}
                value={auth.token}
                onChange={(e) => onChange({ type: "bearer", token: e.target.value })}
              />
            </div>
          </div>
          <p className="captured-hint" style={{ marginTop: 9 }}>
            usually a <code>{"{{var}}"}</code> reference to a captured or environment variable.
          </p>
        </>
      )}

      {auth?.type === "basic" && (
        <div className="kv">
          <div className="kv-row">
            <span className="kv-k">username</span>
            <input
              className="kv-input"
              spellCheck={false}
              value={auth.username}
              onChange={(e) => onChange({ ...auth, username: e.target.value })}
            />
          </div>
          <div className="kv-row">
            <span className="kv-k">password</span>
            <input
              className="kv-input"
              spellCheck={false}
              value={auth.password}
              onChange={(e) => onChange({ ...auth, password: e.target.value })}
            />
          </div>
        </div>
      )}

      {auth?.type === "apikey" && (
        <div className="kv">
          <div className="kv-row">
            <span className="kv-k">name</span>
            <input
              className="kv-input"
              spellCheck={false}
              value={auth.name}
              onChange={(e) => onChange({ ...auth, name: e.target.value })}
            />
          </div>
          <div className="kv-row">
            <span className="kv-k">value</span>
            <input
              className="kv-input"
              spellCheck={false}
              value={auth.value}
              onChange={(e) => onChange({ ...auth, value: e.target.value })}
            />
          </div>
          <div className="kv-row">
            <span className="kv-k">in</span>
            <select
              aria-label="api key location"
              value={auth.in}
              onChange={(e) => onChange({ ...auth, in: e.target.value as "header" | "query" })}
            >
              <option value="header">header</option>
              <option value="query">query</option>
            </select>
          </div>
        </div>
      )}
    </>
  );
}
