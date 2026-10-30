import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "factory_session";

function tokenForPassword(password: string): string {
  return createHmac("sha256", process.env.FACTORY_SECRET ?? "dev")
    .update(`admin:${password}`)
    .digest("hex");
}

export function expectedSession(): string {
  return tokenForPassword(process.env.ADMIN_PASSWORD ?? "admin");
}

export function isAuthed(c: Context): boolean {
  const cookie = getCookie(c, COOKIE);
  const expected = expectedSession();
  if (!cookie || cookie.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(cookie), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function requireAuth(c: Context, next: Next) {
  if (c.req.path === "/api/login" || c.req.path === "/api/health" || c.req.path === "/api/me") {
    return next();
  }
  if (c.req.path.startsWith("/api/") && !isAuthed(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
}

export function setSessionCookie(c: Context, password: string) {
  setCookie(c, COOKIE, tokenForPassword(password), {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 30,
  });
}
