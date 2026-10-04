import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, JUDGE_COOKIE, verifyToken } from "@/lib/token";

// Optimistic redirects only. Pages and actions check the session again themselves, against the database.
// The login page is not redirected from here: a signed cookie can belong to a deleted organizer, and
// sending those visitors back to /admin would loop. The login page checks the account itself.
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/judge/score"],
};
