import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, normalizeEmail, verifyCredentials } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(String(body.email ?? ""));
    const password = String(body.password ?? "");

    const ok = await verifyCredentials(email, password);
    if (!ok) {
      return NextResponse.json({ error: "Ongeldige inloggegevens." }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(AUTH_COOKIE, email, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

