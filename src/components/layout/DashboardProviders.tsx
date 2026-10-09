"use client";

import type { ReactNode } from "react";
import { ConversationsProvider } from "@/components/chat/ConversationsProvider";
import { DocumentsProvider } from "@/components/documents/DocumentsProvider";
import type { ConversationSummary, DocumentSummary } from "@/types";

/** Client state shared by every dashboard page, seeded from the server render. */
export function DashboardProviders({
  initialDocuments,
  initialConversations,
  children,
}: {
  initialDocuments: DocumentSummary[];
  initialConversations: ConversationSummary[];
  children: ReactNode;
}) {
  return (
    <DocumentsProvider initialDocuments={initialDocuments}>
      <ConversationsProvider initialConversations={initialConversations}>
        {children}
      </ConversationsProvider>
    </DocumentsProvider>
  );
}
