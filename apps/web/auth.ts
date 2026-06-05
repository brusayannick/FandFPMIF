/**
 * Auth.js v5 configuration.
 *
 * - Sessions use the JWT strategy. By default the encrypted cookie holds
 *   Keycloak's access + refresh tokens. When SESSION_STORE_DIR is set
 *   (production), a custom jwt.encode/decode keeps that payload server-side
 *   (see lib/session-store) and the cookie carries only an opaque session id —
 *   so the cookie stays tiny and can't overflow the upstream proxy's buffer.
 * - The `jwt` callback rotates the access token via Keycloak's `/token`
 *   endpoint when it's within 30 s of expiry. On refresh failure we set
 *   `token.error = "RefreshAccessTokenError"`; the api wrapper picks that up
 *   and triggers a fresh sign-in.
 * - Logout is local-only (clears our cookie). We deliberately do NOT store the
 *   id_token in the session — it would bloat the cookie past the upstream
 *   reverse proxy's header buffer (502 on the callback). The trade-off: the
 *   Keycloak SSO session is not killed on logout, so re-login is silent until
 *   the IdP session times out.
 */

import { randomBytes } from "node:crypto";
import NextAuth, { type DefaultSession } from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";
import type { JWT, JWTEncodeParams, JWTDecodeParams } from "next-auth/jwt";
import * as sessionStore from "@/lib/session-store";

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
    expiresAt?: number;
    provider?: string;
    error?: "RefreshAccessTokenError";
    /** Server-side store key — present only when SESSION_STORE_DIR is set. */
    sid?: string;
  }
}

const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER ?? "http://localhost:8080/realms/flows-funds";
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "flows-funds-web";
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? "";

// Single-flight guard: several modules (`lib/api`, `lib/ws`, the analytics
// client) each call `getSession()` independently, so after the access token
// expires a burst of activity can fire multiple `jwt` callbacks at once — all
// trying to redeem the *same* refresh token. With Keycloak rotation on, only
// the first redemption is valid; the rest race into `invalid_grant`. We dedupe
// concurrent refreshes per refresh token so one Keycloak call serves them all.
// (In-process only — a multi-instance deployment still relies on Keycloak's
// `refreshTokenMaxReuse` window to absorb cross-instance races.)
const inflightRefreshes = new Map<string, Promise<JWT>>();

async function refreshAccessToken(token: JWT): Promise<JWT> {
  if (!token.refreshToken) return { ...token, error: "RefreshAccessTokenError" };
  const key = token.refreshToken;
  const existing = inflightRefreshes.get(key);
  if (existing) return existing;
  const pending = doRefreshAccessToken(token).finally(() => {
    inflightRefreshes.delete(key);
  });
  inflightRefreshes.set(key, pending);
  return pending;
}

async function doRefreshAccessToken(token: JWT): Promise<JWT> {
  const refreshToken = token.refreshToken;
  if (!refreshToken) return { ...token, error: "RefreshAccessTokenError" };
  try {
    const resp = await fetch(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: KEYCLOAK_CLIENT_ID,
        client_secret: KEYCLOAK_CLIENT_SECRET,
        refresh_token: refreshToken,
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
      // Auth.js v5 expects seconds — not ms. Don't multiply by 1000.
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

// Option 3: when a server-side store is configured, override how the session
// JWT is (de)serialized — persist the full token to disk under a random id and
// hand the browser only that id. Without the store, Auth.js's default
// cookie-based JWT encoding is used unchanged (local dev).
const jwtOverride = sessionStore.sessionStoreEnabled
  ? {
      async encode(params: JWTEncodeParams<JWT>): Promise<string> {
        const token = params.token;
        if (!token) return "";
        const sid = token.sid ?? randomBytes(32).toString("hex");
        token.sid = sid;
        await sessionStore.putSession(sid, token, params.maxAge ?? SESSION_MAX_AGE);
        return sid;
      },
      async decode(params: JWTDecodeParams): Promise<JWT | null> {
        if (!params.token) return null;
        return sessionStore.readSession(params.token);
      },
    }
  : undefined;

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    KeycloakProvider({
      clientId: KEYCLOAK_CLIENT_ID,
      clientSecret: KEYCLOAK_CLIENT_SECRET,
      issuer: KEYCLOAK_ISSUER,
    }),
  ],
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  ...(jwtOverride ? { jwt: jwtOverride } : {}),
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
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
});
