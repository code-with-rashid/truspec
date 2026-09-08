import { dq, indentRest, ps, py, rb, sh } from "./quote";
import type { CodegenBody, HttpShape } from "./shape";

export interface CodegenTarget {
  /** Stable id used by the CLI (`--lang`), the MCP tool, and the UI. */
  id: string;
  /** Human label for a picker. */
  label: string;
  /** Language family, for grouping in a UI. */
  group: string;
  /** Fence info-string / editor mode for the produced snippet. */
  syntax: string;
  render: (shape: HttpShape) => string;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

const jsonText = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

/** The body as a single string, exactly as it goes on the wire. */
function bodyText(body: CodegenBody | undefined): string | undefined {
  if (!body) return undefined;
  if (body.kind === "text") return body.text;
  if (body.kind === "json") return jsonText(body.value);
  return new URLSearchParams(body.fields).toString();
}

function entries(headers: Record<string, string>): Array<[string, string]> {
  return Object.entries(headers);
}

/** Headers minus `Content-Type`, plus the value that was removed (some clients set it apart). */
function splitContentType(headers: Record<string, string>): {
  rest: Array<[string, string]>;
  contentType?: string;
} {
  const rest: Array<[string, string]> = [];
  let contentType: string | undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "content-type") contentType = v;
    else rest.push([k, v]);
  }
  return { rest, contentType };
}

function defaultContentType(body: CodegenBody | undefined): string {
  if (body?.kind === "form") return "application/x-www-form-urlencoded";
  if (body?.kind === "text") return "text/plain";
  return "application/json";
}

/** `{ "a": "b" }` style object literal, one entry per line, for the C-family + Python. */
function mapLiteral(
  pairs: Array<[string, string]>,
  quote: (s: string) => string,
  opts: { open?: string; close?: string; sep?: string; indent?: number } = {},
): string {
  const open = opts.open ?? "{";
  const close = opts.close ?? "}";
  const sep = opts.sep ?? ": ";
  const pad = " ".repeat(opts.indent ?? 2);
  if (pairs.length === 0) return `${open}${close}`;
  const body = pairs.map(([k, v]) => `${pad}${quote(k)}${sep}${quote(v)}`).join(",\n");
  return `${open}\n${body}\n${close}`;
}

/** Pick the shortest `r#…#` hash run that can't appear inside `s` (Rust raw strings). */
function rustRaw(s: string): string {
  let hashes = 0;
  while (s.includes(`"${"#".repeat(hashes)}`)) hashes += 1;
  const h = "#".repeat(hashes);
  return `r${h}"${s}"${h}`;
}

// ---------------------------------------------------------------------------
// shells
// ---------------------------------------------------------------------------

const curl: CodegenTarget["render"] = (s) => {
  const parts = [`curl -X ${s.method} ${sh(s.url)}`];
  for (const [k, v] of entries(s.headers)) parts.push(`-H ${sh(`${k}: ${v}`)}`);
  if (s.body?.kind === "form") {
    for (const [k, v] of Object.entries(s.body.fields)) parts.push(`--data-urlencode ${sh(`${k}=${v}`)}`);
  } else {
    const text = bodyText(s.body);
    if (text !== undefined) parts.push(`--data-raw ${sh(text)}`);
  }
  return parts.join(" \\\n  ");
};

const httpie: CodegenTarget["render"] = (s) => {
  const flags = s.body?.kind === "form" ? " --form" : "";
  const args = [`http${flags} ${s.method} ${sh(s.url)}`];
  for (const [k, v] of entries(s.headers)) args.push(sh(`${k}:${v}`));
  if (s.body?.kind === "form") {
    for (const [k, v] of Object.entries(s.body.fields)) args.push(sh(`${k}=${v}`));
    return args.join(" \\\n  ");
  }
  const text = bodyText(s.body);
  const cmd = args.join(" \\\n  ");
  // HTTPie reads a raw body from stdin, which sidesteps its `key=value` shorthand entirely —
  // so a body with nested objects or an unresolved `{{var}}` survives verbatim.
  return text === undefined ? cmd : `echo ${sh(text)} | ${cmd}`;
};

const wget: CodegenTarget["render"] = (s) => {
  const parts = [`wget --method=${s.method}`];
  for (const [k, v] of entries(s.headers)) parts.push(`--header=${sh(`${k}: ${v}`)}`);
  const text = bodyText(s.body);
  if (text !== undefined) parts.push(`--body-data=${sh(text)}`);
  parts.push(`-O - ${sh(s.url)}`);
  return parts.join(" \\\n  ");
};

const powershell: CodegenTarget["render"] = (s) => {
  const { rest, contentType } = splitContentType(s.headers);
  const lines: string[] = [];
  if (rest.length > 0) {
    lines.push(`$headers = @{`);
    for (const [k, v] of rest) lines.push(`  ${ps(k)} = ${ps(v)}`);
    lines.push(`}`);
  }
  const text = bodyText(s.body);
  if (text !== undefined) lines.push(`$body = ${ps(text)}`);
  const args = [`-Uri ${ps(s.url)}`, `-Method ${s.method}`];
  if (rest.length > 0) args.push("-Headers $headers");
  if (text !== undefined) {
    args.push(`-ContentType ${ps(contentType ?? defaultContentType(s.body))}`);
    args.push("-Body $body");
  }
  lines.push(`Invoke-RestMethod ${args.join(" ")}`);
  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// javascript
// ---------------------------------------------------------------------------

const jsFetch: CodegenTarget["render"] = (s) => {
  const opts = [`  method: ${dq(s.method)}`];
  const headerPairs = entries(s.headers);
  if (headerPairs.length > 0) {
    opts.push(`  headers: ${indentRest(mapLiteral(headerPairs, dq), 2)}`);
  }
  if (s.body?.kind === "form") {
    opts.push(
      `  body: new URLSearchParams(${indentRest(mapLiteral(Object.entries(s.body.fields), dq), 2)})`,
    );
  } else if (s.body?.kind === "json") {
    opts.push(`  body: JSON.stringify(${indentRest(jsonText(s.body.value), 2)})`);
  } else if (s.body?.kind === "text") {
    opts.push(`  body: ${dq(s.body.text)}`);
  }
  return [
    `const response = await fetch(${dq(s.url)}, {`,
    opts.join(",\n"),
    `});`,
    ``,
    `console.log(response.status, await response.text());`,
  ].join("\n");
};

const jsAxios: CodegenTarget["render"] = (s) => {
  const opts = [`  method: ${dq(s.method.toLowerCase())}`, `  url: ${dq(s.url)}`];
  const headerPairs = entries(s.headers);
  if (headerPairs.length > 0) opts.push(`  headers: ${indentRest(mapLiteral(headerPairs, dq), 2)}`);
  if (s.body?.kind === "form") {
    opts.push(`  data: new URLSearchParams(${indentRest(mapLiteral(Object.entries(s.body.fields), dq), 2)})`);
  } else if (s.body?.kind === "json") {
    opts.push(`  data: ${indentRest(jsonText(s.body.value), 2)}`);
  } else if (s.body?.kind === "text") {
    opts.push(`  data: ${dq(s.body.text)}`);
  }
  return [
    `import axios from "axios";`,
    ``,
    `const response = await axios({`,
    opts.join(",\n"),
    `});`,
    ``,
    `console.log(response.status, response.data);`,
  ].join("\n");
};

// ---------------------------------------------------------------------------
// python
// ---------------------------------------------------------------------------

function pythonSnippet(lib: "requests" | "httpx", s: HttpShape): string {
  const lines = [`import ${lib}`, ``, `url = ${py(s.url)}`];
  const headerPairs = entries(s.headers);
  if (headerPairs.length > 0) lines.push(`headers = ${mapLiteral(headerPairs, py, { indent: 4 })}`);
  const args = ["url"];
  if (headerPairs.length > 0) args.push("headers=headers");
  if (s.body?.kind === "json") {
    lines.push(`payload = ${pyValue(s.body.value, 0)}`);
    args.push("json=payload");
  } else if (s.body?.kind === "form") {
    lines.push(`data = ${mapLiteral(Object.entries(s.body.fields), py, { indent: 4 })}`);
    args.push("data=data");
  } else if (s.body?.kind === "text") {
    lines.push(`data = ${py(s.body.text)}`);
    args.push("data=data");
  }
  lines.push(``, `response = ${lib}.request(${py(s.method)}, ${args.join(", ")})`);
  lines.push(`print(response.status_code)`, `print(response.text)`);
  return lines.join("\n");
}

/** Render a JSON value as a Python literal (True/False/None differ from JSON). */
function pyValue(value: unknown, depth: number): string {
  const pad = "    ".repeat(depth + 1);
  const close = "    ".repeat(depth);
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return py(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((v) => `${pad}${pyValue(v, depth + 1)}`).join(",\n")}\n${close}]`;
  }
  if (typeof value === "object") {
    const pairs = Object.entries(value as Record<string, unknown>);
    if (pairs.length === 0) return "{}";
    return `{\n${pairs.map(([k, v]) => `${pad}${py(k)}: ${pyValue(v, depth + 1)}`).join(",\n")}\n${close}}`;
  }
  return "None";
}

// ---------------------------------------------------------------------------
// compiled languages
// ---------------------------------------------------------------------------

const go: CodegenTarget["render"] = (s) => {
  const text = bodyText(s.body);
  const imports = ["\t\"fmt\"", "\t\"io\"", "\t\"net/http\""];
  if (text !== undefined) imports.push("\t\"strings\"");
  const lines = [
    `package main`,
    ``,
    `import (`,
    imports.join("\n"),
    `)`,
    ``,
    `func main() {`,
  ];
  // A Go raw string can hold newlines but not a backtick; fall back to an interpreted literal.
  const bodyExpr =
    text === undefined ? "nil" : `strings.NewReader(${text.includes("`") ? dq(text) : `\`${text}\``})`;
  lines.push(`\treq, err := http.NewRequest(${dq(s.method)}, ${dq(s.url)}, ${bodyExpr})`);
  lines.push(`\tif err != nil {`, `\t\tpanic(err)`, `\t}`);
  for (const [k, v] of entries(s.headers)) lines.push(`\treq.Header.Set(${dq(k)}, ${dq(v)})`);
  lines.push(
    ``,
    `\tres, err := http.DefaultClient.Do(req)`,
    `\tif err != nil {`,
    `\t\tpanic(err)`,
    `\t}`,
    `\tdefer res.Body.Close()`,
    ``,
    `\tbody, _ := io.ReadAll(res.Body)`,
    `\tfmt.Println(res.Status)`,
    `\tfmt.Println(string(body))`,
    `}`,
  );
  return lines.join("\n");
};

const ruby: CodegenTarget["render"] = (s) => {
  const klass = s.method.charAt(0) + s.method.slice(1).toLowerCase();
  const lines = [
    `require "net/http"`,
    `require "uri"`,
    ``,
    `uri = URI(${rb(s.url)})`,
    `request = Net::HTTP::${klass}.new(uri)`,
  ];
  for (const [k, v] of entries(s.headers)) lines.push(`request[${rb(k)}] = ${rb(v)}`);
  if (s.body?.kind === "form") {
    lines.push(`request.set_form_data(${mapLiteral(Object.entries(s.body.fields), rb, { sep: " => " })})`);
  } else {
    const text = bodyText(s.body);
    if (text !== undefined) lines.push(`request.body = ${rb(text)}`);
  }
  lines.push(
    ``,
    `response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") do |http|`,
    `  http.request(request)`,
    `end`,
    ``,
    `puts response.code`,
    `puts response.body`,
  );
  return lines.join("\n");
};

const php: CodegenTarget["render"] = (s) => {
  const opts = [
    `  CURLOPT_URL => ${dq(s.url)},`,
    `  CURLOPT_RETURNTRANSFER => true,`,
    `  CURLOPT_CUSTOMREQUEST => ${dq(s.method)},`,
  ];
  const text = bodyText(s.body);
  if (text !== undefined) opts.push(`  CURLOPT_POSTFIELDS => ${dq(text)},`);
  const headerPairs = entries(s.headers);
  if (headerPairs.length > 0) {
    opts.push(`  CURLOPT_HTTPHEADER => [`);
    for (const [k, v] of headerPairs) opts.push(`    ${dq(`${k}: ${v}`)},`);
    opts.push(`  ],`);
  }
  return [
    `<?php`,
    ``,
    `$curl = curl_init();`,
    `curl_setopt_array($curl, [`,
    opts.join("\n"),
    `]);`,
    ``,
    `$response = curl_exec($curl);`,
    `curl_close($curl);`,
    `echo $response;`,
  ].join("\n");
};

const java: CodegenTarget["render"] = (s) => {
  const text = bodyText(s.body);
  const lines = [
    `import java.net.URI;`,
    `import java.net.http.HttpClient;`,
    `import java.net.http.HttpRequest;`,
    `import java.net.http.HttpResponse;`,
    ``,
    `HttpRequest request = HttpRequest.newBuilder()`,
    `    .uri(URI.create(${dq(s.url)}))`,
  ];
  for (const [k, v] of entries(s.headers)) lines.push(`    .header(${dq(k)}, ${dq(v)})`);
  const publisher =
    text === undefined
      ? `HttpRequest.BodyPublishers.noBody()`
      : `HttpRequest.BodyPublishers.ofString(${dq(text)})`;
  lines.push(`    .method(${dq(s.method)}, ${publisher})`, `    .build();`, ``);
  lines.push(
    `HttpResponse<String> response = HttpClient.newHttpClient()`,
    `    .send(request, HttpResponse.BodyHandlers.ofString());`,
    ``,
    `System.out.println(response.statusCode());`,
    `System.out.println(response.body());`,
  );
  return lines.join("\n");
};

const csharp: CodegenTarget["render"] = (s) => {
  const { rest, contentType } = splitContentType(s.headers);
  const text = bodyText(s.body);
  const lines = [
    `using System;`,
    `using System.Net.Http;`,
    `using System.Text;`,
    `using System.Threading.Tasks;`,
    ``,
    `var client = new HttpClient();`,
    `var request = new HttpRequestMessage(new HttpMethod(${dq(s.method)}), ${dq(s.url)});`,
  ];
  // Content-Type belongs to the *content* in .NET; adding it to request.Headers throws.
  for (const [k, v] of rest) lines.push(`request.Headers.Add(${dq(k)}, ${dq(v)});`);
  if (text !== undefined) {
    lines.push(
      `request.Content = new StringContent(${dq(text)}, Encoding.UTF8, ${dq(contentType ?? defaultContentType(s.body))});`,
    );
  }
  lines.push(
    ``,
    `var response = await client.SendAsync(request);`,
    `Console.WriteLine((int)response.StatusCode);`,
    `Console.WriteLine(await response.Content.ReadAsStringAsync());`,
  );
  return lines.join("\n");
};

const RUST_METHOD_FNS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

const rust: CodegenTarget["render"] = (s) => {
  const usesMethodEnum = !RUST_METHOD_FNS.has(s.method);
  const call = usesMethodEnum
    ? `.request(reqwest::Method::${s.method}, ${dq(s.url)})`
    : `.${s.method.toLowerCase()}(${dq(s.url)})`;
  const lines = [
    `#[tokio::main]`,
    `async fn main() -> Result<(), Box<dyn std::error::Error>> {`,
    `    let client = reqwest::Client::new();`,
    `    let response = client`,
    `        ${call}`,
  ];
  for (const [k, v] of entries(s.headers)) lines.push(`        .header(${dq(k)}, ${dq(v)})`);
  const text = bodyText(s.body);
  if (text !== undefined) lines.push(`        .body(${rustRaw(text)})`);
  lines.push(
    `        .send()`,
    `        .await?;`,
    ``,
    `    println!("{}", response.status());`,
    `    println!("{}", response.text().await?);`,
    `    Ok(())`,
    `}`,
  );
  return lines.join("\n");
};

const swift: CodegenTarget["render"] = (s) => {
  const lines = [
    `import Foundation`,
    ``,
    `var request = URLRequest(url: URL(string: ${dq(s.url)})!)`,
    `request.httpMethod = ${dq(s.method)}`,
  ];
  for (const [k, v] of entries(s.headers)) {
    lines.push(`request.setValue(${dq(v)}, forHTTPHeaderField: ${dq(k)})`);
  }
  const text = bodyText(s.body);
  if (text !== undefined) lines.push(`request.httpBody = ${dq(text)}.data(using: .utf8)`);
  lines.push(
    ``,
    `let (data, response) = try await URLSession.shared.data(for: request)`,
    `print((response as? HTTPURLResponse)?.statusCode ?? 0)`,
    `print(String(data: data, encoding: .utf8) ?? "")`,
  );
  return lines.join("\n");
};

const kotlin: CodegenTarget["render"] = (s) => {
  const { contentType } = splitContentType(s.headers);
  const text = bodyText(s.body);
  const lines = [
    `import okhttp3.MediaType.Companion.toMediaType`,
    `import okhttp3.OkHttpClient`,
    `import okhttp3.Request`,
    `import okhttp3.RequestBody.Companion.toRequestBody`,
    ``,
    `val client = OkHttpClient()`,
  ];
  if (text !== undefined) {
    lines.push(
      `val body = ${dq(text)}.toRequestBody(${dq(contentType ?? defaultContentType(s.body))}.toMediaType())`,
    );
  }
  lines.push(`val request = Request.Builder()`, `    .url(${dq(s.url)})`);
  for (const [k, v] of entries(s.headers)) lines.push(`    .addHeader(${dq(k)}, ${dq(v)})`);
  lines.push(`    .method(${dq(s.method)}, ${text === undefined ? "null" : "body"})`, `    .build()`, ``);
  lines.push(
    `client.newCall(request).execute().use { response ->`,
    `    println(response.code)`,
    `    println(response.body?.string())`,
    `}`,
  );
  return lines.join("\n");
};

const dart: CodegenTarget["render"] = (s) => {
  const lines = [
    `import 'package:http/http.dart' as http;`,
    ``,
    `void main() async {`,
    `  final request = http.Request(${dq(s.method)}, Uri.parse(${dq(s.url)}));`,
  ];
  const headerPairs = entries(s.headers);
  if (headerPairs.length > 0) {
    lines.push(`  request.headers.addAll(${indentRest(mapLiteral(headerPairs, dq, { indent: 4 }), 2)});`);
  }
  const text = bodyText(s.body);
  if (text !== undefined) lines.push(`  request.body = ${dq(text)};`);
  lines.push(
    ``,
    `  final response = await request.send();`,
    `  print(response.statusCode);`,
    `  print(await response.stream.bytesToString());`,
    `}`,
  );
  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

export const CODEGEN_TARGETS: CodegenTarget[] = [
  { id: "curl", label: "cURL", group: "Shell", syntax: "bash", render: curl },
  { id: "httpie", label: "HTTPie", group: "Shell", syntax: "bash", render: httpie },
  { id: "wget", label: "wget", group: "Shell", syntax: "bash", render: wget },
  { id: "powershell", label: "PowerShell", group: "Shell", syntax: "powershell", render: powershell },
  { id: "javascript-fetch", label: "JavaScript — fetch", group: "JavaScript", syntax: "javascript", render: jsFetch },
  { id: "javascript-axios", label: "JavaScript — axios", group: "JavaScript", syntax: "javascript", render: jsAxios },
  {
    id: "python-requests",
    label: "Python — requests",
    group: "Python",
    syntax: "python",
    render: (s) => pythonSnippet("requests", s),
  },
  {
    id: "python-httpx",
    label: "Python — httpx",
    group: "Python",
    syntax: "python",
    render: (s) => pythonSnippet("httpx", s),
  },
  { id: "go", label: "Go — net/http", group: "Go", syntax: "go", render: go },
  { id: "ruby", label: "Ruby — net/http", group: "Ruby", syntax: "ruby", render: ruby },
  { id: "php", label: "PHP — cURL", group: "PHP", syntax: "php", render: php },
  { id: "java", label: "Java — HttpClient", group: "JVM", syntax: "java", render: java },
  { id: "kotlin", label: "Kotlin — OkHttp", group: "JVM", syntax: "kotlin", render: kotlin },
  { id: "csharp", label: "C# — HttpClient", group: ".NET", syntax: "csharp", render: csharp },
  { id: "rust", label: "Rust — reqwest", group: "Rust", syntax: "rust", render: rust },
  { id: "swift", label: "Swift — URLSession", group: "Swift", syntax: "swift", render: swift },
  { id: "dart", label: "Dart — http", group: "Dart", syntax: "dart", render: dart },
];
