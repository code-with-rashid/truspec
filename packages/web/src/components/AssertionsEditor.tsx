export type Assertion = Record<string, unknown>;

const TYPES = ["status", "header", "jsonpath", "body", "duration", "schema"] as const;

function templateFor(type: string): Assertion {
  switch (type) {
    case "status":
      return { type: "status", equals: 200 };
    case "header":
      return { type: "header", name: "", exists: true };
    case "jsonpath":
      return { type: "jsonpath", path: "$.", exists: true };
    case "body":
      return { type: "body", contains: "" };
    case "duration":
      return { type: "duration", ltMs: 1000 };
    case "schema":
      return { type: "schema" };
    default:
      return { type };
  }
}

/** Inline editor for TruSpec's declarative assertions (status/header/jsonpath/body/duration/schema
 * — see CLAUDE.md). Mirrors Postman's inline "Tests" tab / Bruno's "Assert" tab: assertions used
 * to be read-only here, forcing a trip to the raw YAML editor for the single most basic thing an
 * API client lets you do — declare what a passing response looks like. */
export function AssertionsEditor({ assertions, onChange }: { assertions: Assertion[]; onChange: (a: Assertion[]) => void }) {
  const update = (i: number, next: Assertion): void => {
    const copy = [...assertions];
    copy[i] = next;
    onChange(copy);
  };
  const remove = (i: number): void => onChange(assertions.filter((_, idx) => idx !== i));
  const add = (): void => onChange([...assertions, templateFor("status")]);

  return (
    <div className="asserts-edit">
      {assertions.map((a, i) => (
        <AssertionRow key={i} assertion={a} onChange={(next) => update(i, next)} onRemove={() => remove(i)} />
      ))}
      <button className="btn ghost small editable-kv-add" onClick={add}>
        + add assertion
      </button>
    </div>
  );
}

function AssertionRow({ assertion, onChange, onRemove }: { assertion: Assertion; onChange: (a: Assertion) => void; onRemove: () => void }) {
  const type = String(assertion.type ?? "status");

  return (
    <div className="assert-row">
      <select
        aria-label="assertion type"
        className="assert-type-select"
        value={type}
        onChange={(e) => onChange(templateFor(e.target.value))}
      >
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <div className="assert-fields">
        {type === "status" && <StatusFields a={assertion} onChange={onChange} />}
        {type === "header" && <HeaderFields a={assertion} onChange={onChange} />}
        {type === "jsonpath" && <JsonpathFields a={assertion} onChange={onChange} />}
        {type === "body" && <BodyFields a={assertion} onChange={onChange} />}
        {type === "duration" && <DurationFields a={assertion} onChange={onChange} />}
        {type === "schema" && <SchemaFields a={assertion} onChange={onChange} />}
      </div>
      <button className="row-action-btn danger" title="remove assertion" aria-label="remove assertion" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

function StatusFields({ a, onChange }: { a: Assertion; onChange: (a: Assertion) => void }) {
  const mode = a.equals !== undefined ? "equals" : a.in !== undefined ? "in" : a.lt !== undefined ? "lt" : "gte";
  const setMode = (m: string): void => {
    if (m === "equals") onChange({ type: "status", equals: 200 });
    else if (m === "in") onChange({ type: "status", in: [200, 201] });
    else if (m === "lt") onChange({ type: "status", lt: 400 });
    else onChange({ type: "status", gte: 200 });
  };
  return (
    <>
      <select aria-label="status assertion mode" value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="equals">equals</option>
        <option value="in">in</option>
        <option value="lt">lt</option>
        <option value="gte">gte</option>
      </select>
      {mode === "in" ? (
        <input
          className="kv-input assert-value"
          spellCheck={false}
          placeholder="200, 201, 204"
          value={Array.isArray(a.in) ? a.in.join(", ") : ""}
          onChange={(e) =>
            onChange({
              type: "status",
              in: e.target.value
                .split(",")
                .map((s) => Number(s.trim()))
                .filter((n) => !Number.isNaN(n)),
            })
          }
        />
      ) : (
        <input
          className="kv-input assert-value"
          type="number"
          value={String(a[mode] ?? "")}
          onChange={(e) => onChange({ type: "status", [mode]: Number(e.target.value) })}
        />
      )}
    </>
  );
}

function HeaderFields({ a, onChange }: { a: Assertion; onChange: (a: Assertion) => void }) {
  const name = String(a.name ?? "");
  const mode = a.equals !== undefined ? "equals" : a.matches !== undefined ? "matches" : "exists";
  return (
    <>
      <input
        className="kv-input assert-name"
        placeholder="header name"
        spellCheck={false}
        value={name}
        onChange={(e) => onChange({ ...a, type: "header", name: e.target.value })}
      />
      <select
        aria-label="header assertion mode"
        value={mode}
        onChange={(e) => {
          const m = e.target.value;
          const base = { type: "header", name };
          onChange(m === "exists" ? { ...base, exists: true } : m === "equals" ? { ...base, equals: "" } : { ...base, matches: "" });
        }}
      >
        <option value="exists">exists</option>
        <option value="equals">equals</option>
        <option value="matches">matches</option>
      </select>
      {mode !== "exists" && (
        <input
          className="kv-input assert-value"
          spellCheck={false}
          value={String(a[mode] ?? "")}
          onChange={(e) => onChange({ type: "header", name, [mode]: e.target.value })}
        />
      )}
    </>
  );
}

function JsonpathFields({ a, onChange }: { a: Assertion; onChange: (a: Assertion) => void }) {
  const path = String(a.path ?? "$.");
  const mode = a.equals !== undefined ? "equals" : a.matches !== undefined ? "matches" : "exists";
  return (
    <>
      <input
        className="kv-input assert-name"
        placeholder="$.jsonpath"
        spellCheck={false}
        value={path}
        onChange={(e) => onChange({ ...a, type: "jsonpath", path: e.target.value })}
      />
      <select
        aria-label="jsonpath assertion mode"
        value={mode}
        onChange={(e) => {
          const m = e.target.value;
          const base = { type: "jsonpath", path };
          onChange(m === "exists" ? { ...base, exists: true } : m === "equals" ? { ...base, equals: "" } : { ...base, matches: "" });
        }}
      >
        <option value="exists">exists</option>
        <option value="equals">equals</option>
        <option value="matches">matches</option>
      </select>
      {mode !== "exists" && (
        <input
          className="kv-input assert-value"
          spellCheck={false}
          value={String(a[mode] ?? "")}
          onChange={(e) => onChange({ type: "jsonpath", path, [mode]: e.target.value })}
        />
      )}
    </>
  );
}

function BodyFields({ a, onChange }: { a: Assertion; onChange: (a: Assertion) => void }) {
  const mode = a.matches !== undefined ? "matches" : "contains";
  return (
    <>
      <select
        aria-label="body assertion mode"
        value={mode}
        onChange={(e) => onChange({ type: "body", [e.target.value]: "" })}
      >
        <option value="contains">contains</option>
        <option value="matches">matches</option>
      </select>
      <input
        className="kv-input assert-value"
        spellCheck={false}
        value={String(a[mode] ?? "")}
        onChange={(e) => onChange({ type: "body", [mode]: e.target.value })}
      />
    </>
  );
}

function DurationFields({ a, onChange }: { a: Assertion; onChange: (a: Assertion) => void }) {
  return (
    <input
      className="kv-input assert-value"
      type="number"
      placeholder="ltMs"
      value={String(a.ltMs ?? "")}
      onChange={(e) => onChange({ type: "duration", ltMs: Number(e.target.value) })}
    />
  );
}

function SchemaFields({ a, onChange }: { a: Assertion; onChange: (a: Assertion) => void }) {
  return (
    <>
      <input
        className="kv-input assert-name"
        type="number"
        placeholder="status (optional)"
        value={a.status === undefined ? "" : String(a.status)}
        onChange={(e) => onChange({ ...a, type: "schema", status: e.target.value === "" ? undefined : Number(e.target.value) })}
      />
      <input
        className="kv-input assert-value"
        placeholder="content-type (optional)"
        spellCheck={false}
        value={String(a.contentType ?? "")}
        onChange={(e) => onChange({ ...a, type: "schema", contentType: e.target.value || undefined })}
      />
      <label className="assert-required" title="without this, a status the spec doesn't document is skipped (passes) rather than failed">
        <input
          type="checkbox"
          checked={a.required === true}
          onChange={(e) => onChange({ ...a, type: "schema", required: e.target.checked || undefined })}
        />
        required
      </label>
    </>
  );
}
