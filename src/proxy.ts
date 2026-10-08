import { withAuth } from "next-auth/middleware";

// Redirects signed-out visitors to /login?callbackUrl=<where they were going>.
// This is only a first gate: it checks that a valid session JWT exists, nothing
// more. Every page and API route must still call getSession() and verify the
// user owns whatever it reads or writes.
export const proxy = withAuth({
  // withAuth doesn't read authOptions, so the sign-in page is repeated here
  pages: { signIn: "/login" },
});

export const config = {
  matcher: ["/dashboard/:path*", "/chat/:path*", "/documents/:path*"],
};
