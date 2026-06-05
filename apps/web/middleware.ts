import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Cheap, Edge-safe auth gate: only checks that a session cookie is *present*.
// We can't decode the session here — with the server-side store (Option 3) the
// token lives on disk, unreachable from the Edge runtime. Real validation
// happens server-side: RSCs via `auth()` (Node runtime) and the API via JWKS.
const PUBLIC_PATHS = ["/login", "/api/auth"];
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return NextResponse.next();

  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next.js static assets, the favicon, and the icon SVG; everything else
  // goes through the gate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
