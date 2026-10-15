import { FileQuestion } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found · DocuMind AI",
};

/** Any URL the app doesn't have */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <FileQuestion className="size-8 text-muted-foreground" />
      <div className="grid gap-1">
        <h1 className="font-medium">Page not found</h1>
        <p className="text-sm text-muted-foreground">There&apos;s nothing at this address.</p>
      </div>
      <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
        Go to your documents
      </Link>
    </main>
  );
}
