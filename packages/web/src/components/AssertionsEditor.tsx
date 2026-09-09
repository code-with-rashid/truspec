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
          aria-label="status codes"
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
          aria-label={`status ${mode}`}
          type="number"
          value={String(a[mode] ?? "")}
          onChange={(e) => onChange({ type: "status", [mode]: Number(e.target.value) })}
        />
      )}
    </>
  );
}

const HEADER_MODES = ["exists", "equals", "notEquals", "contains", "matches"] as const;

function HeaderFields({ a, onChange }: { a: Assertion; onChange: (a: Assertion) => void }) {
  const name = String(a.name ?? "");
  const mode = HEADER_MODES.find((m) => a[m] !== undefined) ?? "exists";
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
          onChange({ type: "header", name, [m]: m === "exists" ? true : "" });
        }}
      >
        {HEADER_MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {mode === "exists" ? (
        <BoolSelect
          label="header exists"
          value={a.exists !== false}
          onChange={(v) => onChange({ type: "header", name, exists: v })}
        />
      ) : (
        <input
          className="kv-input assert-value"
          aria-label="header assertion value"
          spellCheck={false}
          value={String(a[mode] ?? "")}
          onChange={(e) => onChange({ type: "header", name, [mode]: e.target.value })}
        />
      )}
    </>
  );
}

/** Grouped so a fifteen-entry dropdown still reads as a short list of related choices. */
const JSONPATH_MODE_GROUPS: Array<[string, readonly string[]]> = [
  ["presence", ["exists", "empty"]],
  ["value", ["equals", "notEquals", "oneOf", "contains", "matches"]],
  ["number", ["gt", "gte", "lt", "lte"]],
  ["shape", ["valueType", "length", "minLength", "maxLength"]],
];
const JSONPATH_MODES = JSONPATH_MODE_GROUPS.flatMap(([, modes]) => modes);
const NUMBER_MODES = new Set(["gt", "gte", "lt", "lte", "length", "minLength", "maxLength"]);
const BOOL_MODES = new Set(["exists", "empty"]);
const VALUE_TYPES = ["string", "number", "boolean", "object", "array", "null"] as const;

/**
 * Read a typed value out of a text field. `equals: 200` and `equals: "200"` are different
 * assertions, and the UI could previously only ever produce the string — so a numeric or boolean
 * comparison was impossible without dropping to the YAML editor.
 */
function coerce(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

/** Render a value back into the text field it came from, without JSON-quoting a plain string. */
function uncoerce(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value) ?? "";
}

function JsonpathFields({ a, onChange }: { a: Assertion; onChange: (a: Assertion) => void }) {
  const path = String(a.path ?? "$.");
  const mode = JSONPATH_MODES.find((m) => a[m] !== undefined) ?? "exists";
  const set = (next: Assertion): void => onChange({ type: "jsonpath", path, ...next });

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
          if (BOOL_MODES.has(m)) set({ [m]: true });
          else if (NUMBER_MODES.has(m)) set({ [m]: 0 });
          else if (m === "valueType") set({ valueType: "string" });
          else if (m === "oneOf") set({ oneOf: [] });
          else set({ [m]: "" });
        }}
      >
        {JSONPATH_MODE_GROUPS.map(([group, modes]) => (
          <optgroup key={group} label={group}>
            {modes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {BOOL_MODES.has(mode) ? (
        <BoolSelect
          label={`jsonpath ${mode}`}
          value={a[mode] !== false}
          onChange={(v) => set({ [mode]: v })}
        />
      ) : NUMBER_MODES.has(mode) ? (
        <input
          className="kv-input assert-value"
          aria-label="jsonpath assertion value"
          type="number"
          value={String(a[mode] ?? "")}
          onChange={(e) => set({ [mode]: Number(e.target.value) })}
        />
      ) : mode === "valueType" ? (
        <select
          aria-label="jsonpath value type"
          value={String(a.valueType ?? "string")}
          onChange={(e) => set({ valueType: e.target.value })}
        >
          {VALUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      ) : mode === "oneOf" ? (
        <input
          className="kv-input assert-value"
          aria-label="jsonpath assertion value"
          spellCheck={false}
          placeholder='"a", "b", 3'
          value={Array.isArray(a.oneOf) ? a.oneOf.map(uncoerce).join(", ") : ""}
          onChange={(e) =>
            set({
              oneOf: e.target.value
                .split(",")
                .map((part) => coerce(part))
                .filter((v) => v !== ""),
            })
          }
        />
      ) : (
        <input
          className="kv-input assert-value"
          aria-label="jsonpath assertion value"
          spellCheck={false}
          value={uncoerce(a[mode])}
          onChange={(e) => set({ [mode]: mode === "matches" ? e.target.value : coerce(e.target.value) })}
        />
      )}
    </>
  );
}

/** A true/false picker — clearer than a bare checkbox when the field means "assert absent". */
function BoolSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <select aria-label={label} value={value ? "true" : "false"} onChange={(e) => onChange(e.target.value === "true")}>
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
  );
}

const BODY_MODES = ["contains", "notContains", "equals", "matches", "empty"] as const;

function BodyFields({ a, onChange }: { a: Assertion; onChange: (a: Assertion) => void }) {
  const mode = BODY_MODES.find((m) => a[m] !== undefined) ?? "contains";
  return (
    <>
      <select
        aria-label="body assertion mode"
        value={mode}
        onChange={(e) => {
          const m = e.target.value;
          onChange({ type: "body", [m]: m === "empty" ? true : "" });
        }}
      >
        {BODY_MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {mode === "empty" ? (
        <BoolSelect
          label="body empty"
          value={a.empty !== false}
          onChange={(v) => onChange({ type: "body", empty: v })}
        />
      ) : (
        <input
          className="kv-input assert-value"
          aria-label="body assertion value"
          spellCheck={false}
          value={String(a[mode] ?? "")}
          onChange={(e) => onChange({ type: "body", [mode]: e.target.value })}
        />
      )}
    </>
  );
}

function DurationFields({ a, onChange }: { a: Assertion; onChange: (a: Assertion) => void }) {
  return (
    <input
      className="kv-input assert-value"
      aria-label="duration limit in ms"
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
