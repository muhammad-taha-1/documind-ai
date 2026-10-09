import { LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DocumentStatus, DocumentSummary } from "@/types";

const STATUS_BADGES: Record<
  DocumentStatus,
  { label: string; variant: "secondary" | "destructive" | "outline"; busy: boolean; className?: string }
> = {
  // A card only exists once the upload request has succeeded, so UPLOADING
  // means "file stored, waiting for processing" — nothing is in flight.
  UPLOADING: { label: "Uploaded", variant: "secondary", busy: false },
  PROCESSING: { label: "Processing", variant: "secondary", busy: true },
  EMBEDDING: { label: "Embedding", variant: "secondary", busy: true },
  READY: {
    label: "Ready",
    variant: "outline",
    busy: false,
    className:
      "border-transparent bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
  },
  ERROR: { label: "Error", variant: "destructive", busy: false },
};

export function DocumentStatusBadge({
  document,
}: {
  document: Pick<DocumentSummary, "status" | "totalChunks" | "embeddedChunks">;
}) {
  const { label, variant, busy, className } = STATUS_BADGES[document.status];
  const showProgress = document.status === "EMBEDDING" && document.totalChunks > 0;
  return (
    <Badge variant={variant} className={className}>
      {busy && <LoaderCircle className="animate-spin" />}
      {label}
      {showProgress && ` ${document.embeddedChunks}/${document.totalChunks}`}
    </Badge>
  );
}
