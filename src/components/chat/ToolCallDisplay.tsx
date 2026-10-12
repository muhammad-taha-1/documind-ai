import { ChevronRight, CircleAlert, FileText, Info, LoaderCircle, Search, Wrench } from "lucide-react";
import type { ToolCall } from "@/types";

const TOOL_ICONS: Record<string, typeof Search> = {
  search_documents: Search,
  get_page_content: FileText,
  get_document_info: Info,
};

/**
 * One tool Claude used while answering: what it did, and (opened) exactly
 * what it sent and got back. Styled apart from the reply, with a dashed
 * border, because it's Claude's working rather than its answer.
 */
export function ToolCallDisplay({ call }: { call: ToolCall }) {
  const Icon = TOOL_ICONS[call.name] ?? Wrench;

  return (
    <details className="group/tool w-full rounded-md border border-dashed bg-muted/20 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open/tool:rotate-90" />
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={call.label}>
          {call.label}
        </span>
        {call.status === "running" && (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-label="Running" />
        )}
        {call.status === "failed" && (
          <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-label="Failed" />
        )}
      </summary>
      <div className="grid gap-2 border-t border-dashed px-3 py-2.5">
        <section className="grid gap-1">
          <h4 className="font-medium">Input · {call.name}</h4>
          <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[11px]">
            {JSON.stringify(call.input, null, 2)}
          </pre>
        </section>
        <section className="grid gap-1">
          <h4 className="font-medium">{call.status === "failed" ? "Error" : "Result"}</h4>
          <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap">
            {call.output ?? "Waiting for the result…"}
          </pre>
        </section>
      </div>
    </details>
  );
}
