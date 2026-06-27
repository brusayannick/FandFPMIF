/**
 * Delete any Auth.js session cookie (base name + numbered chunks, http + secure
 * variants). Server Action / Route Handler only – a Server Component render
 * cannot mutate cookies, which is exactly why a refresh-failed session can get
 * wedged.
 *
 * Background: when the Keycloak refresh token dies, the `jwt` callback flags the
 * session `error: "RefreshAccessTokenError"`. The cookie still looks valid, so
 * `auth()` keeps returning it; the platform layout and login page treat that as
 * logged-out and `redirect("/login")` – but a server `redirect()` can't clear a
 * cookie, so the dead cookie survives and the user loops on /login forever. The
 * login action calls this first to wipe the stale cookie before starting a fresh
 * OAuth round-trip.
 */
import { cookies } from "next/headers";

// Auth.js names the JWT session cookie `authjs.session-token`, prefixed
// `__Secure-` under HTTPS (prod). A cookie larger than ~4KB is split into
// numbered chunks (`<name>.0`, `.1`, …) – clear those too.
const SESSION_COOKIE_BASES = ["authjs.session-token", "__Secure-authjs.session-token"];

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  for (const cookie of jar.getAll()) {
    const isSession = SESSION_COOKIE_BASES.some(
      (base) => cookie.name === base || cookie.name.startsWith(`${base}.`),
    );
    if (!isSession) continue;
    // Overwrite-and-expire with the same attributes Auth.js sets, so the browser
    // actually drops it (a `__Secure-` cookie is only deleted by a Secure
    // Set-Cookie on a matching path).
    jar.set(cookie.name, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
      secure: cookie.name.startsWith("__Secure-"),
    });
  }
}
