"use client";

import { LoaderCircle, RotateCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RetryButton({ onRetry }: { onRetry: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      await onRetry();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Couldn't retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="xs" onClick={handleClick} disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <RotateCw />}
        Retry
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
