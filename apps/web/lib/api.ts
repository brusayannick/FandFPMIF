/**
 * Tiny typed-fetch wrapper.
 *
 * The browser hits the FastAPI backend directly via `NEXT_PUBLIC_API_URL`
 * (CORS is configured on the API side). Server-side code (RSC, route
 * handlers) uses `INTERNAL_API_URL` so it can talk to the api service over
 * the docker-compose network without going through the host.
 */

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

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(init.json);
  }
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

/** Build a WS URL pointing at the backend for both dev and prod. */
export function wsUrl(path: string): string {
  const base = typeof window === "undefined" ? SERVER_BASE : PUBLIC_BASE;
  return `${base.replace(/^http/, "ws")}${path}`;
}
