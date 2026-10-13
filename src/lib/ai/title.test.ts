import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./anthropic", () => ({
  anthropic: { messages: { create } },
  TITLE_MODEL: "title-model",
}));

const { generateTitle } = await import("./title");

function respond(text: string, stopReason = "end_turn") {
  create.mockResolvedValueOnce({
    stop_reason: stopReason,
    // A thinking block can come first; only text counts
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text },
    ],
  });
}

beforeEach(() => {
  create.mockReset();
});

describe("generateTitle", () => {
  it("asks the title model for a title, and tidies what it returns", async () => {
    respond('"AWS Load Balancer Types."');
    const signal = new AbortController().signal;

    const title = await generateTitle("What load balancers does AWS offer?", { signal });

    expect(title).toBe("AWS Load Balancer Types");
    const [params, options] = create.mock.calls[0];
    expect(params).toMatchObject({ model: "title-model", output_config: { effort: "low" } });
    // The message is material to name, not a request to answer
    expect(params.messages).toEqual([
      { role: "user", content: "<message>\nWhat load balancers does AWS offer?\n</message>" },
    ]);
    expect(options).toMatchObject({ signal });
  });

  it("returns null when the model doesn't finish normally", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    respond("", "refusal");
    expect(await generateTitle("…")).toBeNull();
    consoleWarn.mockRestore();
  });

  it("returns null instead of rejecting when the request fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValueOnce(new Anthropic.InternalServerError(529, undefined, "overloaded", new Headers()));
    expect(await generateTitle("Hello")).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("stays quiet when the reply was abandoned", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValueOnce(new Anthropic.APIUserAbortError());
    expect(await generateTitle("Hello")).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
