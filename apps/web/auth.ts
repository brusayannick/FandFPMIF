/**
 * Auth.js v5 configuration.
 *
 * - JWT-only sessions (no DB adapter) — the encrypted cookie holds Keycloak's
 *   access + refresh tokens.
 * - The `jwt` callback rotates the access token via Keycloak's `/token`
 *   endpoint when it's within 30 s of expiry. On refresh failure we set
 *   `token.error = "RefreshAccessTokenError"`; the api wrapper picks that up
 *   and triggers a fresh sign-in.
 * - `events.signOut` hits Keycloak's end-session endpoint so the SSO session
 *   on the IdP is killed too, not just our cookie.
 */

import NextAuth, { type DefaultSession } from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";
import type { JWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshAccessTokenError";
    provider?: string;
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt?: number;
    provider?: string;
    error?: "RefreshAccessTokenError";
  }
}

const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER ?? "http://localhost:8080/realms/flows-funds";
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "flows-funds-web";
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? "";

async function refreshAccessToken(token: JWT): Promise<JWT> {
  if (!token.refreshToken) return { ...token, error: "RefreshAccessTokenError" };
  try {
    const resp = await fetch(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: KEYCLOAK_CLIENT_ID,
        client_secret: KEYCLOAK_CLIENT_SECRET,
        refresh_token: token.refreshToken,
      }),
    });
    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!resp.ok || !data.access_token || !data.expires_in) {
      return { ...token, error: "RefreshAccessTokenError" };
    }
    return {
      ...token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      idToken: data.id_token ?? token.idToken,
      // Auth.js v5 expects seconds — not ms. Don't multiply by 1000.
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    KeycloakProvider({
      clientId: KEYCLOAK_CLIENT_ID,
      clientSecret: KEYCLOAK_CLIENT_SECRET,
      issuer: KEYCLOAK_ISSUER,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.idToken = account.id_token;
        token.expiresAt = account.expires_at;
        token.provider = account.provider;
        return token;
      }
      const now = Math.floor(Date.now() / 1000);
      if (token.expiresAt && now < token.expiresAt - 30) {
        return token;
      }
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      session.provider = token.provider;
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  events: {
    async signOut(message) {
      const idToken =
        "token" in message && message.token
          ? (message.token as JWT).idToken
          : undefined;
      if (!idToken) return;
      const url = new URL(`${KEYCLOAK_ISSUER}/protocol/openid-connect/logout`);
      url.searchParams.set("id_token_hint", idToken);
      try {
        await fetch(url.toString(), { method: "GET" });
      } catch {
        // Best-effort; ignore.
      }
    },
  },
});
