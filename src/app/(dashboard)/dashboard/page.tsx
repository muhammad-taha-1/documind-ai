import type { Metadata } from "next";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";

export const metadata: Metadata = {
  title: "Documents · DocuMind AI",
};

// The layout handles sign-in and loads the documents
export default function DashboardPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Upload PDFs here, then start a chat to ask questions about them.
          </p>
        </header>
        <DocumentsPanel />
      </div>
    </div>
  );
}
