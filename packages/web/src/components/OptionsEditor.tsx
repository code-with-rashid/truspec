import type { RequestOptions } from "../api";

interface Props {
  options: RequestOptions | undefined;
  onChange: (options: RequestOptions | undefined) => void;
}

interface NumberFieldSpec {
  key: "timeoutMs" | "retries" | "retryDelayMs" | "maxRedirects";
  label: string;
  hint: string;
  min: number;
  max?: number;
}

const NUMBER_FIELDS: NumberFieldSpec[] = [
  { key: "timeoutMs", label: "timeout (ms)", hint: "overrides the run-wide timeout; 0 disables it", min: 0 },
  { key: "retries", label: "retries", hint: "re-send on a transport error, 429 or 5xx — never on a failed assertion", min: 0, max: 10 },
  { key: "retryDelayMs", label: "retry delay (ms)", hint: "base pause before a retry; doubles each attempt", min: 0 },
  { key: "maxRedirects", label: "max redirects", hint: "hops allowed when redirects are followed", min: 1, max: 20 },
];

/**
 * Edit a request's transport `options`.
 *
 * These changed how a request is sent long before the UI could show them, so a timeout or a retry
 * set in the file was invisible here — and a reader had no way to tell a slow request from one
 * deliberately given ten seconds.
 */
export function OptionsEditor({ options, onChange }: Props): JSX.Element {
  const set = (patch: RequestOptions): void => {
    const next: RequestOptions = { ...options, ...patch };
    for (const key of Object.keys(next) as Array<keyof RequestOptions>) {
      if (next[key] === undefined) delete next[key];
    }
    // No keys left means no `options:` block at all, rather than an empty one in the diff.
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  if (options === undefined) {
    return (
      <button
        className="options-add"
        title="per-request timeout, retries and redirect following"
        onClick={() => onChange({ retries: 0 })}
      >
        + options
      </button>
    );
  }

  return (
    <div className="options-edit">
      <div className="type-row">
        <span className="type-label">transport options</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={() => onChange(undefined)}>
          remove
        </button>
      </div>
      <div className="options-grid">
        {NUMBER_FIELDS.map((f) => (
          <label key={f.key} title={f.hint}>
            <span>{f.label}</span>
            <input
              type="number"
              min={f.min}
              max={f.max}
              value={options[f.key] ?? ""}
              placeholder="default"
              onChange={(e) =>
                set({ [f.key]: e.target.value === "" ? undefined : Number(e.target.value) } as RequestOptions)
              }
            />
          </label>
        ))}
        <label
          className="options-check"
          title="off by default: TruSpec reports the ACTUAL response a URL returns, so a 3xx stays assertable"
        >
          <input
            type="checkbox"
            checked={options.followRedirects ?? false}
            onChange={(e) => set({ followRedirects: e.target.checked ? true : undefined })}
          />
          <span>follow redirects</span>
        </label>
      </div>
    </div>
  );
}
