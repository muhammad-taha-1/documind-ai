import type { Metadata } from "next";
import { NewChatForm } from "@/components/chat/NewChatForm";

export const metadata: Metadata = {
  title: "New chat · DocuMind AI",
};

export default function NewChatPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">New chat</h1>
          <p className="text-sm text-muted-foreground">
            Pick one or more documents. Your questions will be answered from them.
          </p>
        </header>
        <NewChatForm />
      </div>
    </div>
  );
}
