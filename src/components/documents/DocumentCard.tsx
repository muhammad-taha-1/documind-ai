import { FileText } from "lucide-react";
import { LocalTime } from "@/components/common/LocalTime";
import { Card, CardContent } from "@/components/ui/card";
import { formatBytes } from "@/lib/format";
import type { DocumentSummary } from "@/types";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { RetryButton } from "./RetryButton";

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
            <DocumentStatusBadge document={document} />
          </div>
          <p className="text-xs text-muted-foreground">
            <LocalTime iso={document.createdAt} variant="date" />
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
