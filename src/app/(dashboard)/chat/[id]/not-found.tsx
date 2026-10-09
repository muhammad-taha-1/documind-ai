import { MessageSquareOff } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function ChatNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <MessageSquareOff className="size-8 text-muted-foreground" />
      <div className="grid gap-1">
        <h1 className="font-medium">Chat not found</h1>
        <p className="text-sm text-muted-foreground">It may have been deleted.</p>
      </div>
      <Link href="/chat" className={buttonVariants({ variant: "outline" })}>
        Start a new chat
      </Link>
    </div>
  );
}
