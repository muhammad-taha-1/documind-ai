import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ChatView } from "@/components/chat/ChatView";
import { getSession } from "@/lib/auth";
import { getConversation } from "@/lib/chat/queries";

export const metadata: Metadata = {
  title: "Chat · DocuMind AI",
};

export default async function ChatPage({ params }: PageProps<"/chat/[id]">) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;

  const conversation = await getConversation(session.user.id, id);
  if (!conversation) {
    // Also shown for other users' conversations
    notFound();
  }

  // key: switching chats remounts the view, so no state carries over
  return <ChatView key={conversation.id} conversation={conversation} />;
}
