import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, JUDGE_COOKIE, verifyToken } from "@/lib/token";

/**
 * The Content Security Policy for a page, with this request's nonce. Scripts run only when they carry the nonce (Next.js
 * puts it on its own) or were loaded by one that does ('strict-dynamic'): a script slipped into a page any other way
 * doesn't run. A page talks only to this site and the Supabase project (change checks, realtime, photos), so even a
 * script that did run couldn't send anything elsewhere. Styles stay open to inline style attributes, which the app uses
 * throughout; a style can't run code.
 */
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV !== "production";
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
  const realtime = supabase.replace(/^http/, "ws");
  return [
    "default-src 'self'",
    // React's development build reads error stacks with eval; production never does.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Photos are in Supabase Storage; a photo being cropped is a blob, and QR codes and icons can be data.
    `img-src 'self' data: blob: ${supabase}`,
    "font-src 'self' data:",
    // The dev server reloads over its own websocket, which may be on the laptop's Wi-Fi address.
    `connect-src 'self' ${supabase} ${realtime}${dev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Every page: its Content Security Policy, with a nonce of its own. And optimistic sign-in redirects for the admin
 * panel and the judge's screen; pages and actions check the session again themselves, against the database. The login
 * page is not redirected from here: a signed cookie can belong to a deleted organizer, and sending those visitors back
 * to /admin would loop. The login page checks the account itself.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    if (!verifyToken(request.cookies.get(ADMIN_COOKIE)?.value, "admin")) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  if (pathname === "/judge/score" && !verifyToken(request.cookies.get(JUDGE_COOKIE)?.value, "judge")) {
    return NextResponse.redirect(new URL("/judge", request.url));
  }

  // Next.js reads the nonce from the policy on the request and puts it on the page's scripts.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Pages, not the files they load (which need no policy) or link prefetches (which aren't pages a nonce is read from).
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
