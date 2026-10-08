import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Dashboard · DocuMind AI",
};

// Placeholder until Phase 4 (document list) and Phase 8 (dashboard layout)
export default async function DashboardPage() {
  // The proxy already redirects signed-out users; checking again here means the
  // page stays protected even if the proxy matcher changes.
  const session = await getSession();
  if (!session) {
    redirect("/login?callbackUrl=/dashboard");
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {session.user.name ?? session.user.email ?? "unknown user"}
          </p>
        </div>
        <SignOutButton />
      </div>
      <p className="text-muted-foreground">Your documents will appear here.</p>
    </main>
  );
}
