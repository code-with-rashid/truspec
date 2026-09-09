/** One server-sent event, as delivered. */
export interface SseEvent {
  /** The `event:` field, when the stream names its events. */
  event?: string;
  /** The `data:` field. Multiple `data:` lines in one block are joined with a newline, per spec. */
  data: string;
  /** The `id:` field, when present. */
  id?: string;
}

/** Whether a response body is a server-sent event stream. */
export function isEventStream(contentType: string): boolean {
  return /^\s*text\/event-stream\b/i.test(contentType);
}

/**
 * Parse an SSE body into its events (WHATWG event-stream format).
 *
 * Deliberately a parser over the whole text rather than an incremental one: the runner already
 * collects the bytes, and a request that has finished is what assertions run against. Lines
 * starting with `:` are comments (heartbeats, which is what most keep-alives are made of) and are
 * dropped; a block with no `data:` is not an event.
 */
export function parseEventStream(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  // Normalise the three line endings the spec allows before splitting into blocks.
  for (const block of text.replace(/\r\n|\r/g, "\n").split("\n\n")) {
    const data: string[] = [];
    let event: string | undefined;
    let id: string | undefined;
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      // "If value starts with a space, remove it" — one space, not all whitespace.
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") data.push(value);
      else if (field === "event") event = value;
      else if (field === "id") id = value;
      // `retry:` and unknown fields are ignored, as a browser would.
    }
    if (data.length === 0) continue;
    events.push({ ...(event !== undefined ? { event } : {}), data: data.join("\n"), ...(id !== undefined ? { id } : {}) });
  }
  return events;
}

/** How many events to collect before closing a stream that may never end. */
export const MAX_STREAM_EVENTS = 200;

/** Number of complete event blocks in the text collected so far, to know when the cap is reached. */
export function countEventBlocks(text: string): number {
  let count = 0;
  let index = text.indexOf("\n\n");
  while (index !== -1) {
    count += 1;
    index = text.indexOf("\n\n", index + 2);
  }
  return count;
}
