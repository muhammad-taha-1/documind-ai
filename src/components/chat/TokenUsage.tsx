import { formatTokenCount } from "@/lib/format";
import type { TokenUsage } from "@/types";

/** Every prompt token, whichever rate it was billed at */
function promptTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

function sumUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      cacheReadTokens: total.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
}

/** The full breakdown, for a tooltip and screen readers */
function describeUsage(usage: TokenUsage): string {
  const exact = (tokens: number) => tokens.toLocaleString("en-US");
  return [
    `${exact(promptTokens(usage))} tokens read`,
    `(${exact(usage.cacheReadTokens)} from cache, ${exact(usage.cacheWriteTokens)} written to cache,`,
    `${exact(usage.inputTokens)} uncached),`,
    `${exact(usage.outputTokens)} tokens written, thinking included`,
  ].join(" ");
}

/** One reply's usage, e.g. "12k in (11k cached) · 450 out" */
export function MessageTokenUsage({ usage, className }: { usage: TokenUsage; className?: string }) {
  return (
    <span className={className} title={describeUsage(usage)}>
      {formatTokenCount(promptTokens(usage))} in
      {usage.cacheReadTokens > 0 && ` (${formatTokenCount(usage.cacheReadTokens)} cached)`}
      {" · "}
      {formatTokenCount(usage.outputTokens)} out
    </span>
  );
}

/** The conversation's total, from every reply that recorded its usage */
export function ConversationTokenUsage({ usages }: { usages: TokenUsage[] }) {
  if (usages.length === 0) {
    return null;
  }
  const total = sumUsage(usages);
  const description = describeUsage(total);
  return (
    <p className="shrink-0 text-xs text-muted-foreground tabular-nums" title={description}>
      <span aria-hidden>{formatTokenCount(promptTokens(total) + total.outputTokens)} tokens</span>
      <span className="sr-only">This chat has used {description}</span>
    </p>
  );
}
