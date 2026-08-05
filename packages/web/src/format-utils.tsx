import { useMemo } from "react";

export const statusClass = (code: number): string => {
  if (code >= 500) return "s5";
  if (code >= 400) return "s4";
  if (code >= 300) return "s3";
  if (code >= 200) return "s2";
  return "s0";
};

export const prettyBody = (text: string): string => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

interface Token {
  t: string;
  cls: string;
}

/** Lightweight JSON syntax highlighter — keys/strings/numbers/booleans/punctuation get a color. */
function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],])|(\s+)|([^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let cls = "tok-plain";
    if (m[1]) cls = "tok-key";
    else if (m[2]) cls = "tok-str";
    else if (m[3]) cls = "tok-num";
    else if (m[4]) cls = "tok-bool";
    else if (m[5]) cls = "tok-punct";
    out.push({ t: m[0], cls });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

export function JsonBlock({ text }: { text: string }) {
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <pre className="body">
      {tokens.map((tok, i) => (
        <span key={i} className={tok.cls}>
          {tok.t}
        </span>
      ))}
    </pre>
  );
}
