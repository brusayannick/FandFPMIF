/**
 * Typed-fetch wrapper that auto-attaches the Keycloak access token.
 *
 * - The browser hits the FastAPI backend directly via `NEXT_PUBLIC_API_URL`
 *   (CORS is configured on the API side). It reads the token through Auth.js's
 *   `getSession()` (works in client components and event handlers).
 * - Server-side callers (RSCs, route handlers) should use `apiServer()` from
 *   `./api-server` so the token comes from the cookie-backed `auth()` helper.
 *
 * If the session is missing or `session.error === "RefreshAccessTokenError"`,
 * there is no usable bearer token, so we don't fire an unauthenticated request
 * that would just 401. Instead we sign the user out and send them to `/login`.
 * Signing out (rather than a plain redirect) is required: a refresh-failed
 * session still has a valid JWT cookie, so `auth()` keeps returning it and the
 * login page would bounce the user straight back. `signOut()` clears that
 * cookie and ends the Keycloak SSO session, breaking the loop.
 */

import type { Session } from "next-auth";

const SERVER_BASE = process.env.INTERNAL_API_URL ?? "http://localhost:8000";
const PUBLIC_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function apiBase() {
  if (typeof window === "undefined") return SERVER_BASE;
  return PUBLIC_BASE;
}

// ── Ambient request headers ────────────────────────────────────────────────
// A browser-only registry of headers attached to every `api()` / `rawFetch()`
// call. The dashboard uses it to push its ephemeral `X-FF-Event-Filter` onto
// all module-widget requests without touching any widget's fetch code (the
// backend only reads the header in its module-route dispatch, so it's a no-op
// elsewhere). Set/clear it from a provider's mount/unmount lifecycle.
const _ambientHeaders = new Map<string, string>();

export function setAmbientHeaders(headers: Record<string, string | null | undefined>): void {
  for (const [k, v] of Object.entries(headers)) {
    if (v == null) _ambientHeaders.delete(k);
    else _ambientHeaders.set(k, v);
  }
}

export function clearAmbientHeaders(...keys: string[]): void {
  if (keys.length === 0) _ambientHeaders.clear();
  else for (const k of keys) _ambientHeaders.delete(k);
}

/** Merge ambient headers in, without clobbering anything the caller set. */
function applyAmbientHeaders(headers: Headers): void {
  for (const [k, v] of _ambientHeaders) {
    if (!headers.has(k)) headers.set(k, v);
  }
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(`API ${status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    this.status = status;
    this.detail = detail;
  }
}

// ── Cached session ─────────────────────────────────────────────────────────
// `getSession()` always does a network roundtrip to `/api/auth/session`, and
// `attachAuth` awaited it before EVERY api() call – a page mounting six
// queries paid six extra serial roundtrips before the first real byte left
// the browser. Cache the session until shortly before its access token
// expires (`session.expiresAt`), clamped to [5s, 60s] and single-flighted so
// a burst of concurrent calls shares one fetch. A 401 from the backend
// invalidates the cache so the next call re-reads (and, server-side, rotates).
const SESSION_TTL_MIN_MS = 5_000;
const SESSION_TTL_MAX_MS = 60_000;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

// Sentinel: the `/api/auth/session` fetch itself failed (network error, or a
// browser content blocker refusing the request — seen in Safari with an ad/
// privacy blocker active). This is NOT the same as "logged out" (a reachable
// endpoint returning null). Collapsing the two used to force logoutToLogin() →
// /login → (cookie still valid server-side) → back → an infinite redirect loop,
// which `signOut()` couldn't even break because its own /api/auth/signout fetch
// was blocked by the same thing. Callers must treat this as "auth unknown".
const SESSION_FETCH_FAILED = Symbol("session-fetch-failed");
type SessionResult = Session | null | typeof SESSION_FETCH_FAILED;

let sessionCache: { session: SessionResult; validUntil: number } | null = null;
let sessionInflight: Promise<SessionResult> | null = null;

export function invalidateSessionCache(): void {
  sessionCache = null;
}

async function fetchSession(): Promise<SessionResult> {
  try {
    const { getSession } = await import("next-auth/react");
    return (await getSession()) as Session | null;
  } catch {
    return SESSION_FETCH_FAILED;
  }
}

async function cachedSession(): Promise<SessionResult> {
  if (sessionCache && Date.now() < sessionCache.validUntil) return sessionCache.session;
  if (sessionInflight) return sessionInflight;
  sessionInflight = fetchSession()
    .then((session) => {
      let ttl = SESSION_TTL_MAX_MS;
      if (session !== SESSION_FETCH_FAILED && session?.expiresAt) {
        // Never serve a token past (expiry − margin); near expiry this degrades
        // to 5s re-checks until the jwt callback rotates it server-side.
        ttl = Math.min(ttl, session.expiresAt * 1000 - TOKEN_EXPIRY_MARGIN_MS - Date.now());
      }
      // Missing/broken sessions, and a failed fetch, get the short TTL: don't
      // hammer during a burst, but recover quickly after sign-in / once the
      // endpoint is reachable again.
      if (session === SESSION_FETCH_FAILED || !session || session.error) ttl = SESSION_TTL_MIN_MS;
      sessionCache = { session, validUntil: Date.now() + Math.max(ttl, SESSION_TTL_MIN_MS) };
      return session;
    })
    .finally(() => {
      sessionInflight = null;
    });
  return sessionInflight;
}

/** Current access token from the cached session (no per-call roundtrip).
 * `undefined` = no usable token (signed out, or refresh failed). */
export async function sessionAccessToken(): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  const session = await cachedSession();
  if (!session || session === SESSION_FETCH_FAILED || session.error === "RefreshAccessTokenError") {
    return undefined;
  }
  return session.accessToken;
}

async function browserToken(): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  return sessionAccessToken();
}

// Module-level guard so a burst of concurrent calls that all hit a missing
// token triggers exactly one sign-out, not one per in-flight request.
let signingOut = false;

/** No usable token in the browser → end the session and go to /login. Exported
 * so the session guard (`components/session-guard.tsx`) reuses the same
 * single-flight sign-out + on-/login no-op guard instead of racing its own. */
export async function logoutToLogin(): Promise<void> {
  if (typeof window === "undefined") return;
  if (signingOut) return;
  // Already on the login surface – nothing to do (and avoids a redirect loop).
  if (window.location.pathname.startsWith("/login")) return;
  signingOut = true;
  const callbackUrl = `${window.location.pathname}${window.location.search}`;
  const loginUrl = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  try {
    const { signOut } = await import("next-auth/react");
    await signOut({ redirectTo: loginUrl });
  } catch {
    // Fallback: hard-navigate to login if sign-out couldn't run.
    window.location.assign(loginUrl);
  }
}

async function attachAuth(headers: Headers): Promise<void> {
  if (typeof window === "undefined") return;
  const session = await cachedSession();
  if (session === SESSION_FETCH_FAILED) {
    // Couldn't reach /api/auth/session (network error, or a browser content
    // blocker). Fire the request untokenized rather than forcing a logout: the
    // old code collapsed this into "logged out" → logoutToLogin() → /login →
    // (cookie still valid server-side) → back → an infinite redirect loop
    // (reproduced in Safari with a content blocker active). A genuine 401 will
    // surface as an ApiError the caller handles; a real logout still returns a
    // null session below and redirects normally.
    return;
  }
  const token =
    session && session.error !== "RefreshAccessTokenError" ? session.accessToken : undefined;
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    return;
  }
  // Confirmed no usable token (endpoint reachable, session gone or refresh
  // failed). Sign out and redirect rather than firing a guaranteed-401 request.
  await logoutToLogin();
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(init.json);
  }
  applyAmbientHeaders(headers);
  await attachAuth(headers);
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    // Stale/revoked token – drop the cached session so the next call re-reads.
    if (res.status === 401) invalidateSessionCache();
    let detail: unknown = await res.text();
    try {
      detail = JSON.parse(detail as string);
    } catch {
      /* keep as text */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

/**
 * Multipart upload with progress reporting. `fetch` can't surface upload-byte
 * progress, so large files (e.g. a ~0.5 GB CV4CDD model archive) look frozen.
 * This uses `XMLHttpRequest` purely for its `upload.onprogress` events; auth +
 * error handling mirror `api()`. `onProgress` receives 0–100 for the bytes sent
 * to the server. Note the request stays pending after 100% while the server
 * processes the body (the model upload extracts the archive) – callers should
 * show an indeterminate "installing" state once progress reaches 100.
 */
export async function apiUpload<T = unknown>(
  path: string,
  file: File,
  opts: { fieldName?: string; onProgress?: (pct: number) => void } = {},
): Promise<T> {
  const token = await browserToken();
  if (!token) {
    // No usable bearer token: sign out + redirect rather than a guaranteed 401.
    await logoutToLogin();
    throw new ApiError(401, "Not authenticated");
  }
  const body = new FormData();
  body.append(opts.fieldName ?? "file", file);
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase()}${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts.onProgress) {
        opts.onProgress((e.loaded / e.total) * 100);
      }
    };
    xhr.onload = () => {
      let detail: unknown = xhr.responseText;
      try {
        detail = JSON.parse(xhr.responseText);
      } catch {
        /* keep as text */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((xhr.status === 204 ? undefined : detail) as T);
      } else {
        if (xhr.status === 401) invalidateSessionCache();
        reject(new ApiError(xhr.status, detail));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload"));
    xhr.send(body);
  });
}

/** Raw fetch that returns the Response without JSON-parsing – use for SSE / streaming endpoints. */
export async function rawFetch(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(init.json);
  }
  applyAmbientHeaders(headers);
  await attachAuth(headers);
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
  if (res.status === 401) invalidateSessionCache();
  return res;
}

/** Build an absolute URL pointing at the backend. Use for `<img src>`, `<a href>`,
 * and any other browser-side reference that bypasses the `api()` helper.
 *
 * Static module assets are served from this URL – the API doesn't require a
 * token for `/api/v1/modules/{id}/assets/*` (they're public bundles).
 */
export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}
