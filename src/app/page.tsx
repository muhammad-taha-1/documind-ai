import { redirect } from "next/navigation";

// There's no landing page — the dashboard is the home screen. Signed-out
// visitors get bounced from /dashboard to /login by the proxy.
export default function Home() {
  redirect("/dashboard");
}
