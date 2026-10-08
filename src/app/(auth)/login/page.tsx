import { CircleAlert, FileText } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInButton } from "@/components/auth/SignInButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSession } from "@/lib/auth";
import { getSafeRedirect } from "@/lib/safe-redirect";

export const metadata: Metadata = {
  title: "Sign in · DocuMind AI",
};

// NextAuth sends sign-in failures here as ?error=<code> (pages.error in src/lib/auth.ts)
const ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked:
    "That email is already linked to a different sign-in method.",
  AccessDenied: "Access was denied. Please try again.",
  Configuration: "Sign-in is misconfigured on the server. Check the auth environment variables.",
};
const DEFAULT_ERROR = "Something went wrong signing in with GitHub. Please try again.";

export default async function LoginPage(props: PageProps<"/login">) {
  const { callbackUrl, error } = await props.searchParams;
  const redirectTo = getSafeRedirect(callbackUrl);

  // Already signed in — skip the login screen
  if (await getSession()) {
    redirect(redirectTo);
  }

  const errorMessage =
    typeof error === "string" ? (ERROR_MESSAGES[error] ?? DEFAULT_ERROR) : null;

  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 px-4 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader className="justify-items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FileText className="size-5" />
          </div>
          <CardTitle className="text-xl">Welcome to DocuMind</CardTitle>
          <CardDescription>
            Chat with your documents. Sign in to get started.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {errorMessage && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
          <SignInButton callbackUrl={redirectTo} />
        </CardContent>
      </Card>
    </main>
  );
}
