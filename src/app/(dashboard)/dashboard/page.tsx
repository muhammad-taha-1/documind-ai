import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { getSession } from "@/lib/auth";
import { listDocuments } from "@/lib/documents/queries";

export const metadata: Metadata = {
  title: "Dashboard · DocuMind AI",
};

// The full sidebar layout arrives in Phase 8
export default async function DashboardPage() {
  // The proxy already redirects signed-out users; checking again here means the
  // page stays protected even if the proxy matcher changes.
  const session = await getSession();
  if (!session) {
    redirect("/login?callbackUrl=/dashboard");
  }

  // Query the DB directly rather than calling our own API — this is a Server
  // Component, so it can skip the HTTP round trip
  const documents = await listDocuments(session.user.id);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {session.user.name ?? session.user.email ?? "unknown user"}
          </p>
        </div>
        <SignOutButton />
      </header>
      <DocumentsPanel initialDocuments={documents} />
    </main>
  );
}
