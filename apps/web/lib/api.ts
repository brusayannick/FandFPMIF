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
 * the request still goes out *without* a bearer header. The API will return
 * 401 and the middleware redirect on the next navigation will sign the user
 * back in.
 */

import type { Session } from "next-auth";

const SERVER_BASE = process.env.INTERNAL_API_URL ?? "http://localhost:8000";
const PUBLIC_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function apiBase() {
  if (typeof window === "undefined") return SERVER_BASE;
  return PUBLIC_BASE;
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

async function browserToken(): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  try {
    const { getSession } = await import("next-auth/react");
    const session = (await getSession()) as Session | null;
    if (session?.error === "RefreshAccessTokenError") return undefined;
    return session?.accessToken;
  } catch {
    return undefined;
  }
}

async function attachAuth(headers: Headers): Promise<void> {
  const token = await browserToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
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
  await attachAuth(headers);
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
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

/** Raw fetch that returns the Response without JSON-parsing — use for SSE / streaming endpoints. */
export async function rawFetch(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(init.json);
  }
  await attachAuth(headers);
  return fetch(`${apiBase()}${path}`, { ...init, headers });
}

/** Build a WS URL pointing at the backend for both dev and prod. */
export function wsUrl(path: string): string {
  const base = typeof window === "undefined" ? SERVER_BASE : PUBLIC_BASE;
  return `${base.replace(/^http/, "ws")}${path}`;
}

/** Build an absolute URL pointing at the backend. Use for `<img src>`, `<a href>`,
 * and any other browser-side reference that bypasses the `api()` helper.
 *
 * Static module assets are served from this URL — the API doesn't require a
 * token for `/api/v1/modules/{id}/assets/*` (they're public bundles).
 */
export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}
