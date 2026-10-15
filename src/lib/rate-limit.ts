import { jsonError } from "@/lib/api";

// Per-user limits on the requests that cost money (Claude and OpenAI calls)
// or real work (parsing PDFs), so one user, or a script running as them,
// can't run up the bill or hog the server.
//
// Counts are kept in this process's memory. That fits how the app runs: a
// single server, whose local disk also holds the uploads. Several instances
// would each count separately and need a shared store (Redis, or a Postgres
// table) instead. Counts reset when the server restarts, which is fine for
// limits measured in minutes.

export interface RateLimit {
  /** Requests allowed per window */
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;

export const RATE_LIMITS = {
  /** Every message is at least one Claude request (more with tools), plus an embedding */
  chat: { limit: 20, windowMs: MINUTE },
  /** Every upload is parsed and embedded */
  upload: { limit: 10, windowMs: MINUTE },
  /** Reprocessing parses and embeds the document again */
  reprocess: { limit: 10, windowMs: MINUTE },
} as const satisfies Record<string, RateLimit>;

export type RateLimitedAction = keyof typeof RATE_LIMITS;

const LIMIT_MESSAGES: Record<RateLimitedAction, string> = {
  chat: "You're sending messages too quickly.",
  upload: "You're uploading too quickly.",
  reprocess: "You're retrying too quickly.",
};

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

/** Above this many keys, entries with no recent requests are swept out */
const SWEEP_THRESHOLD = 10_000;

/**
 * A sliding-window log: for each key, the times of its requests within the
 * window. Exact (no burst at window edges, unlike fixed windows), and cheap
 * at these limits: at most `limit` timestamps per user and action.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Records a request for `key` if it's within the limit. Refused requests aren't counted. */
  check(key: string, { limit, windowMs }: RateLimit): RateLimitResult {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((time) => time > now - windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      // The oldest request in the window is the next to expire
      return { allowed: false, retryAfterMs: recent[0] + windowMs - now };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > SWEEP_THRESHOLD) {
      this.sweep(now);
    }
    return { allowed: true };
  }

  /** Forgets keys whose requests have all left the longest window */
  private sweep(now: number) {
    const longest = Math.max(...Object.values(RATE_LIMITS).map((limit) => limit.windowMs));
    for (const [key, times] of this.hits) {
      if (times.every((time) => time <= now - longest)) {
        this.hits.delete(key);
      }
    }
  }

  clear() {
    this.hits.clear();
  }
}

const limiter = new RateLimiter();

/**
 * Counts a request by `userId` towards `action`'s limit. Returns the 429
 * response to send if they're over it (with Retry-After), or null to go ahead.
 */
export function enforceRateLimit(userId: string, action: RateLimitedAction): Response | null {
  const result = limiter.check(`${action}:${userId}`, RATE_LIMITS[action]);
  if (result.allowed) {
    return null;
  }
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return jsonError(429, `${LIMIT_MESSAGES[action]} Please wait ${seconds} ${seconds === 1 ? "second" : "seconds"}.`, {
    "retry-after": String(seconds),
  });
}

/** Forgets every count. For tests, which send more requests than a real user would. */
export function resetRateLimits() {
  limiter.clear();
}
