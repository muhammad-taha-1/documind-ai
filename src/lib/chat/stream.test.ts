import { describe, expect, it } from "vitest";
import { ndjsonLine, readNdjson } from "./stream";

/** A byte stream delivering the given chunks one by one. */
function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const values: unknown[] = [];
  for await (const value of readNdjson(stream)) values.push(value);
  return values;
}

describe("readNdjson", () => {
  it("parses one value per line", async () => {
    expect(await collect(streamOf(['{"a":1}\n{"b":2}\n']))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("reassembles lines split across chunks", async () => {
    expect(await collect(streamOf(['{"type":"de', 'lta","text":"Hi"}\n{"ty', 'pe":"x"}\n']))).toEqual([
      { type: "delta", text: "Hi" },
      { type: "x" },
    ]);
  });

  it("reassembles a multi-byte character split across chunks", async () => {
    const bytes = new TextEncoder().encode(ndjsonLine({ text: "héllo 👋" }));
    const split = bytes.indexOf(0xf0) + 2; // inside the 4-byte emoji
    expect(await collect(streamOf([bytes.slice(0, split), bytes.slice(split)]))).toEqual([
      { text: "héllo 👋" },
    ]);
  });

  it("reads a final line without a trailing newline and skips blank lines", async () => {
    expect(await collect(streamOf(['{"a":1}\n\n', '{"b":2}']))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("keeps text containing newlines on one line", async () => {
    const line = ndjsonLine({ text: "line one\nline two" });
    expect(line.trimEnd()).not.toContain("\n");
    expect(await collect(streamOf([line]))).toEqual([{ text: "line one\nline two" }]);
  });
});
