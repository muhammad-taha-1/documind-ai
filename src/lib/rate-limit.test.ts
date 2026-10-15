import { beforeEach, describe, expect, it } from "vitest";
import { enforceRateLimit, RATE_LIMITS, RateLimiter, resetRateLimits } from "./rate-limit";

const limit = { limit: 3, windowMs: 60_000 };

describe("RateLimiter", () => {
  let now: number;
  let limiter: RateLimiter;

  beforeEach(() => {
    now = 1_000_000;
    limiter = new RateLimiter(() => now);
  });

  it("allows up to the limit within the window, then says when the next one is allowed", () => {
    expect(limiter.check("u", limit)).toEqual({ allowed: true });
    now += 10_000;
    expect(limiter.check("u", limit)).toEqual({ allowed: true });
    expect(limiter.check("u", limit)).toEqual({ allowed: true });

    // The first request leaves the window 60 s after it was made, 50 s from now
    expect(limiter.check("u", limit)).toEqual({ allowed: false, retryAfterMs: 50_000 });
  });

  it("slides: each request frees its slot a window after it was made", () => {
    for (let i = 0; i < 3; i++) limiter.check("u", limit);
    now += 60_001;
    expect(limiter.check("u", limit)).toEqual({ allowed: true });
  });

  it("doesn't count refused requests, so hammering doesn't extend the wait", () => {
    for (let i = 0; i < 3; i++) limiter.check("u", limit);
    for (let i = 0; i < 10; i++) limiter.check("u", limit);
    now += 60_001;
    expect(limiter.check("u", limit)).toEqual({ allowed: true });
  });

  it("counts each key separately", () => {
    for (let i = 0; i < 3; i++) limiter.check("a", limit);
    expect(limiter.check("b", limit)).toEqual({ allowed: true });
  });
});

describe("enforceRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("lets requests through until the limit, then answers 429 with when to retry", async () => {
    for (let i = 0; i < RATE_LIMITS.chat.limit; i++) {
      expect(enforceRateLimit("user-1", "chat")).toBeNull();
    }

    const response = enforceRateLimit("user-1", "chat");

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(await response?.json()).toEqual({ error: "You're sending messages too quickly. Please wait 60 seconds." });
  });

  it("keeps users and actions apart", () => {
    for (let i = 0; i < RATE_LIMITS.chat.limit; i++) enforceRateLimit("user-1", "chat");
    expect(enforceRateLimit("user-2", "chat")).toBeNull();
    expect(enforceRateLimit("user-1", "upload")).toBeNull();
  });
});
