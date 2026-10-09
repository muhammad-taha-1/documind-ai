/**
 * Reads a newline-delimited JSON stream, yielding one parsed value per line.
 * Handles lines split across chunks and multi-byte characters split across
 * chunk boundaries.
 */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  // stream: true holds back a character split across chunks until the rest arrives
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line);
      }
    }
    // A final line without a trailing newline
    buffer += decoder.decode();
    if (buffer.trim()) yield JSON.parse(buffer);
  } finally {
    // Stops the download if the caller bails out early
    await reader.cancel().catch(() => {});
  }
}

/** Encodes one value as a line of newline-delimited JSON. */
export function ndjsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
