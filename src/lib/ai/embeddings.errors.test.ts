import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { describeEmbeddingError } from "./embeddings";

// Separate from embeddings.test.ts, which replaces the whole SDK with a fake

const headers = new Headers();

describe("describeEmbeddingError", () => {
  it.each([
    [new OpenAI.RateLimitError(429, { code: "insufficient_quota" }, "quota", headers), /quota has run out/],
    [new OpenAI.RateLimitError(429, { code: "rate_limit_exceeded" }, "slow down", headers), /busy right now/],
    [new OpenAI.AuthenticationError(401, undefined, "bad key", headers), /isn't configured correctly/],
    [new OpenAI.PermissionDeniedError(403, undefined, "nope", headers), /isn't configured correctly/],
    [new OpenAI.InternalServerError(503, undefined, "down", headers), /having problems/],
    [new OpenAI.APIConnectionTimeoutError(), /Couldn't reach the embedding service/],
  ])("explains %s", (error, message) => {
    expect(describeEmbeddingError(error)).toMatch(message);
  });

  it("leaves anything unexpected to the caller's generic message", () => {
    expect(describeEmbeddingError(new OpenAI.BadRequestError(400, undefined, "bad", headers))).toBeNull();
    expect(describeEmbeddingError(new Error("database down"))).toBeNull();
  });
});
