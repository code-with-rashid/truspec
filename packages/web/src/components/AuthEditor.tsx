import type { RequestAuth } from "../api";
import { VarAwareInput } from "./VarAwareInput";

export function AuthEditor({
  auth,
  onChange,
  envVarNames,
}: {
  auth?: RequestAuth;
  onChange: (auth: RequestAuth) => void;
  /** Environment variable names, for `{{...}}` autocomplete in the token/username/password/value
   * fields — these almost always hold a captured or environment variable reference, same as the
   * URL, params, and headers value fields. Omit to fall back to a plain input. */
  envVarNames?: string[];
}) {
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
    } else if (next === "apikey") {
      onChange({
        type: "apikey",
        name: auth?.type === "apikey" ? auth.name : "",
        value: auth?.type === "apikey" ? auth.value : "",
        in: auth?.type === "apikey" ? auth.in : "header",
      });
    } else {
      onChange(
        auth?.type === "oauth2"
          ? auth
          : {
              type: "oauth2",
              grant: "client_credentials",
              tokenUrl: "",
              clientAuth: "body",
              scheme: "Bearer",
            },
      );
    }
  };

  /** A labelled row whose value supports `{{var}}` autocomplete when an environment is active. */
  const field = (
    label: string,
    value: string,
    onValue: (v: string) => void,
    hint?: string,
  ): JSX.Element => (
    <div className="kv-row" key={label}>
      <span className="kv-k" title={hint}>
        {label}
      </span>
      {envVarNames && envVarNames.length > 0 ? (
        <VarAwareInput
          className="kv-input"
          ariaLabel={label}
          spellCheck={false}
          value={value}
          onChange={onValue}
          suggestions={envVarNames}
        />
      ) : (
        <input
          className="kv-input"
          aria-label={label}
          spellCheck={false}
          value={value}
          onChange={(e) => onValue(e.target.value)}
        />
      )}
    </div>
  );

  return (
    <>
      <div className="type-row">
        <span className="type-label">scheme</span>
        <select aria-label="auth scheme" value={type} onChange={(e) => setType(e.target.value as RequestAuth["type"])}>
          <option value="none">none</option>
          <option value="bearer">bearer</option>
          <option value="basic">basic</option>
          <option value="apikey">apikey</option>
          <option value="oauth2">oauth2</option>
        </select>
      </div>

      {type === "none" && <div className="muted pad">none — inherits from folder config if present.</div>}

      {auth?.type === "bearer" && (
        <>
          <div className="kv">
            <div className="kv-row">
              <span className="kv-k">token</span>
              {envVarNames && envVarNames.length > 0 ? (
                <VarAwareInput
                  className="kv-input"
                  spellCheck={false}
                  value={auth.token}
                  onChange={(v) => onChange({ type: "bearer", token: v })}
                  suggestions={envVarNames}
                />
              ) : (
                <input
                  className="kv-input"
                  spellCheck={false}
                  value={auth.token}
                  onChange={(e) => onChange({ type: "bearer", token: e.target.value })}
                />
              )}
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
            {envVarNames && envVarNames.length > 0 ? (
              <VarAwareInput
                className="kv-input"
                spellCheck={false}
                value={auth.username}
                onChange={(v) => onChange({ ...auth, username: v })}
                suggestions={envVarNames}
              />
            ) : (
              <input
                className="kv-input"
                spellCheck={false}
                value={auth.username}
                onChange={(e) => onChange({ ...auth, username: e.target.value })}
              />
            )}
          </div>
          <div className="kv-row">
            <span className="kv-k">password</span>
            {envVarNames && envVarNames.length > 0 ? (
              <VarAwareInput
                className="kv-input"
                spellCheck={false}
                value={auth.password}
                onChange={(v) => onChange({ ...auth, password: v })}
                suggestions={envVarNames}
              />
            ) : (
              <input
                className="kv-input"
                spellCheck={false}
                value={auth.password}
                onChange={(e) => onChange({ ...auth, password: e.target.value })}
              />
            )}
          </div>
        </div>
      )}

      {auth?.type === "oauth2" && (
        <>
          <div className="kv">
            <div className="kv-row">
              <span className="kv-k">grant</span>
              <select
                aria-label="oauth2 grant"
                value={auth.grant}
                onChange={(e) => onChange({ ...auth, grant: e.target.value as typeof auth.grant })}
              >
                <option value="client_credentials">client credentials</option>
                <option value="password">password</option>
                <option value="refresh_token">refresh token</option>
              </select>
            </div>
            {field("token url", auth.tokenUrl, (v) => onChange({ ...auth, tokenUrl: v }))}
            {auth.grant !== "refresh_token" &&
              field("client id", auth.clientId ?? "", (v) => onChange({ ...auth, clientId: v }))}
            {auth.grant !== "refresh_token" &&
              field("client secret", auth.clientSecret ?? "", (v) => onChange({ ...auth, clientSecret: v }))}
            {auth.grant === "password" &&
              field("username", auth.username ?? "", (v) => onChange({ ...auth, username: v }))}
            {auth.grant === "password" &&
              field("password", auth.password ?? "", (v) => onChange({ ...auth, password: v }))}
            {auth.grant === "refresh_token" &&
              field("refresh token", auth.refreshToken ?? "", (v) => onChange({ ...auth, refreshToken: v }))}
            {field("scope", auth.scope ?? "", (v) => onChange({ ...auth, scope: v }), "optional")}
            {field("audience", auth.audience ?? "", (v) => onChange({ ...auth, audience: v }), "optional — Auth0/Okta")}
            <div className="kv-row">
              <span className="kv-k" title="where the client id/secret are sent">
                client auth
              </span>
              <select
                aria-label="oauth2 client auth"
                value={auth.clientAuth}
                onChange={(e) => onChange({ ...auth, clientAuth: e.target.value as "body" | "basic" })}
              >
                <option value="body">request body</option>
                <option value="basic">basic header</option>
              </select>
            </div>
          </div>
          <p className="captured-hint" style={{ marginTop: 9 }}>
            The token is fetched at run time and cached for the rest of the run. Keep the secret in an
            environment secret — <code>{"{{clientSecret}}"}</code> — never inline.
          </p>
        </>
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
            {envVarNames && envVarNames.length > 0 ? (
              <VarAwareInput
                className="kv-input"
                spellCheck={false}
                value={auth.value}
                onChange={(v) => onChange({ ...auth, value: v })}
                suggestions={envVarNames}
              />
            ) : (
              <input
                className="kv-input"
                spellCheck={false}
                value={auth.value}
                onChange={(e) => onChange({ ...auth, value: e.target.value })}
              />
            )}
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
