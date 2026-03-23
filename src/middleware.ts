import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, isAllowedEmail, normalizeEmail } from "@/lib/auth-shared";

const PUBLIC_PATHS = ["/login", "/reset-wachtwoord"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static assets and internal Next.js paths.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/api")
  ) {
    return NextResponse.next();
  }

  const cookieValue = request.cookies.get(AUTH_COOKIE)?.value ?? "";
  const email = normalizeEmail(cookieValue);
  const loggedIn = Boolean(email) && isAllowedEmail(email);
  const publicPath = isPublicPath(pathname);

  if (!loggedIn && !publicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (loggedIn && publicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (cookieValue && !loggedIn) {
    const res = NextResponse.next();
    res.cookies.set(AUTH_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
