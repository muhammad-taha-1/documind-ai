"use client";

import { CircleAlert, CircleCheck, CloudUpload, FileText } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { uploadDocument } from "@/lib/documents/client";
import { PDF_MIME_TYPE, validateSelectedFile } from "@/lib/documents/validation";
import type { DocumentSummary } from "@/types";

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string; progress: number }
  | { kind: "success"; fileName: string }
  | { kind: "error"; message: string };

export function DocumentUpload({ onUploaded }: { onUploaded: (document: DocumentSummary) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const isUploading = state.kind === "uploading";

  async function upload(files: File[]) {
    if (files.length === 0 || isUploading) {
      return;
    }
    if (files.length > 1) {
      setState({ kind: "error", message: "Please upload one file at a time." });
      return;
    }
    const [file] = files;
    const validationError = validateSelectedFile(file);
    if (validationError) {
      setState({ kind: "error", message: validationError });
      return;
    }

    setState({ kind: "uploading", fileName: file.name, progress: 0 });
    try {
      const document = await uploadDocument(file, (progress) =>
        setState({ kind: "uploading", fileName: file.name, progress }),
      );
      onUploaded(document);
      setState({ kind: "success", fileName: file.name });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Upload failed. Please try again.",
      });
    }
  }

  function handleDragOver(event: DragEvent<HTMLButtonElement>) {
    // preventDefault marks this element as a drop target (otherwise the browser opens the file)
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLButtonElement>) {
    // dragleave also fires when moving over child elements — ignore those
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragging(false);
    void upload(Array.from(event.dataTransfer.files));
  }

  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={() => {
          if (!isUploading) inputRef.current?.click();
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        // aria-disabled, not disabled: a disabled button ignores drop events,
        // and the browser would then navigate away to open the dropped PDF
        aria-disabled={isUploading}
        data-dragging={isDragging || undefined}
        className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card px-6 py-8 text-center transition-colors outline-none hover:border-primary/50 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:cursor-default aria-disabled:hover:border-border aria-disabled:hover:bg-card data-dragging:border-primary data-dragging:bg-primary/5"
      >
        {state.kind === "uploading" ? (
          <div className="grid w-full max-w-sm gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{state.fileName}</span>
            </div>
            <Progress value={state.progress} aria-label="Upload progress" />
            <p className="text-xs text-muted-foreground">
              {state.progress < 100 ? `Uploading… ${state.progress}%` : "Saving…"}
            </p>
          </div>
        ) : (
          <>
            <CloudUpload
              className={`size-8 ${isDragging ? "text-primary" : "text-muted-foreground"}`}
            />
            <p className="text-sm font-medium">
              {isDragging ? "Drop to upload" : "Drag & drop a PDF here, or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground">PDF up to 10 MB</p>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={`${PDF_MIME_TYPE},.pdf`}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Reset so choosing the same file again still fires onChange
          event.target.value = "";
          void upload(files);
        }}
      />

      {state.kind === "success" && (
        <p role="status" className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CircleCheck className="size-4 shrink-0" />
          <span className="truncate">Uploaded {state.fileName}</span>
        </p>
      )}
      {state.kind === "error" && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
