import { format } from "date-fns";
import { FileText, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatBytes } from "@/lib/format";
import type { DocumentStatus, DocumentSummary } from "@/types";
import { RetryButton } from "./RetryButton";

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

function StatusBadge({ document }: { document: DocumentSummary }) {
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

export function DocumentCard({
  document,
  onRetry,
}: {
  document: DocumentSummary;
  onRetry: (documentId: string) => Promise<void>;
}) {
  const details = [
    document.pageCount !== null &&
      `${document.pageCount} ${document.pageCount === 1 ? "page" : "pages"}`,
    formatBytes(document.fileSize),
  ].filter(Boolean);

  return (
    <Card size="sm">
      <CardContent className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileText className="size-4.5" />
        </div>
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-medium" title={document.title}>
              {document.title}
            </h3>
            <StatusBadge document={document} />
          </div>
          <p className="text-xs text-muted-foreground">
            {/* Formatted in the viewer's timezone, which can differ from the
                server's during SSR — suppressHydrationWarning accepts that */}
            <time dateTime={document.createdAt} suppressHydrationWarning>
              {format(new Date(document.createdAt), "MMM d, yyyy")}
            </time>
            {details.map((detail) => ` · ${detail}`).join("")}
          </p>
          {document.status === "ERROR" && (
            <div className="mt-1 grid gap-2">
              {document.errorMessage && (
                <p className="text-xs text-destructive">{document.errorMessage}</p>
              )}
              <RetryButton onRetry={() => onRetry(document.id)} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
