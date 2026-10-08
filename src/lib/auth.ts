import { PrismaAdapter } from "@auth/prisma-adapter";
import { getServerSession, type NextAuthOptions, type Session } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { prisma } from "@/lib/db/prisma";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — copy it from .env.example into .env`);
  }
  return value;
}

export const authOptions: NextAuthOptions = {
  // The adapter persists users and their linked GitHub accounts in Postgres,
  // so every Document/Conversation can reference a stable User.id.
  adapter: PrismaAdapter(prisma),
  // With an adapter, NextAuth defaults to database sessions. The proxy can only
  // read the session cookie (it can't query the DB per request), so we use
  // signed JWTs instead. NEXTAUTH_SECRET signs them.
  session: { strategy: "jwt" },
  providers: [
    GitHubProvider({
      clientId: requireEnv("GITHUB_ID"),
      clientSecret: requireEnv("GITHUB_SECRET"),
    }),
  ],
  pages: {
    signIn: "/login",
    // Send OAuth errors back to the login page (as ?error=...) instead of
    // NextAuth's unstyled default error page.
    error: "/login",
  },
  callbacks: {
    // NextAuth puts the database User.id in the JWT's `sub` claim on sign-in.
    // Copy it onto the session so server code can scope queries by user.
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};

/** The current user's session in Server Components and Route Handlers, or null. */
export function getSession(): Promise<Session | null> {
  return getServerSession(authOptions);
}
