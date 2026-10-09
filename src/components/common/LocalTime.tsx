"use client";

import { useSyncExternalStore } from "react";
import { formatDate, formatDateTime, formatShortDate } from "@/lib/format";

const FORMATS = { short: formatShortDate, date: formatDate, full: formatDateTime } as const;

const subscribe = () => () => {};

/**
 * Renders a timestamp in the viewer's timezone. The server doesn't know that
 * timezone, so it renders nothing and the browser fills the text in after
 * hydration — formatting on the server would show the wrong time, then make
 * React complain that server and client HTML differ.
 */
export function LocalTime({
  iso,
  variant,
  className,
}: {
  iso: string;
  variant: keyof typeof FORMATS;
  className?: string;
}) {
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return (
    <time dateTime={iso} className={className}>
      {isClient ? FORMATS[variant](new Date(iso)) : null}
    </time>
  );
}
