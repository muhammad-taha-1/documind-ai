import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardProviders } from "@/components/layout/DashboardProviders";
import { getSession } from "@/lib/auth";
import { listConversations } from "@/lib/chat/queries";
import { listDocuments } from "@/lib/documents/queries";

/**
 * The signed-in app: sidebar + page. Loads the sidebar's lists once on the
 * server; client state keeps them current from there (layouts don't
 * re-render when navigating between dashboard pages).
 */
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  // The proxy already redirects signed-out users; checking again here keeps
  // every dashboard page protected even if the proxy matcher changes
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const userId = session.user.id;

  const [documents, conversations] = await Promise.all([
    listDocuments(userId),
    listConversations(userId),
  ]);
  const user = {
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    image: session.user.image ?? null,
  };

  return (
    <DashboardProviders initialDocuments={documents} initialConversations={conversations}>
      <AppShell user={user}>{children}</AppShell>
    </DashboardProviders>
  );
}
