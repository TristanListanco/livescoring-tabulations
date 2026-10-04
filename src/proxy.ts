import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, JUDGE_COOKIE, verifyToken } from "@/lib/token";

// Optimistic redirects only. Pages and actions check the session again themselves.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin")) {
    const signedIn = verifyToken(request.cookies.get(ADMIN_COOKIE)?.value, "admin") !== null;
    const onLogin = pathname === "/admin/login";
    if (!signedIn && !onLogin) return NextResponse.redirect(new URL("/admin/login", request.url));
    if (signedIn && onLogin) return NextResponse.redirect(new URL("/admin", request.url));
  }

  if (pathname === "/judge/score" && !verifyToken(request.cookies.get(JUDGE_COOKIE)?.value, "judge")) {
    return NextResponse.redirect(new URL("/judge", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/judge/score"],
};
