import type { VarValue } from "../runner";

/** One iteration's variables, from a row of a dataset. */
export type DataRow = Record<string, VarValue>;

/**
 * Parse an RFC 4180 CSV into rows keyed by the header line.
 *
 * Written rather than delegated because the alternative — `split(",")` — silently corrupts every
 * real dataset the moment a value contains a comma, a quote, or a newline, which is exactly what
 * request payloads contain.
 */
export function parseCsv(text: string): DataRow[] {
  const records = parseCsvRecords(text);
  const header = records.shift();
  if (!header) return [];
  const columns = header.map((h) => h.trim());
  const rows: DataRow[] = [];
  for (const record of records) {
    // A trailing newline yields one empty record; that is formatting, not a row of data.
    if (record.length === 1 && record[0] === "") continue;
    const row: DataRow = {};
    columns.forEach((name, i) => {
      if (name) row[name] = record[i] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

/** Split CSV text into records of fields, honoring quoted fields and `""` escapes. */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  // Normalize CRLF so a Windows-authored file does not leave a stray \r on every last field.
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += c;
    }
  }
  record.push(field);
  records.push(record);
  return records;
}

/** Parse a JSON dataset: an array of flat objects, one per iteration. */
export function parseJsonData(text: string): DataRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Data file is not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error("Data file must be a JSON array of objects");
  return parsed.map((row, i) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Data row ${i + 1} is not an object`);
    }
    const out: DataRow = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (v === null || v === undefined) {
        out[k] = "";
      } else if (typeof v === "object") {
        // A nested value has no textual form a `{{var}}` could carry; JSON is the honest one.
        out[k] = JSON.stringify(v);
      } else {
        out[k] = v as VarValue;
      }
    }
    return out;
  });
}

/** Pick the parser from the file extension, defaulting to CSV. */
export function parseDataText(text: string, path: string): DataRow[] {
  return /\.json$/i.test(path) ? parseJsonData(text) : parseCsv(text);
}
