import { NextRequest, NextResponse } from "next/server";
import { createResetToken, isAllowedEmail, normalizeEmail, sendResetEmail } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(String(body.email ?? ""));

    // Altijd generieke success-response om account-enumeratie te beperken.
    if (!isAllowedEmail(email)) {
      return NextResponse.json({
        ok: true,
        message: "Als dit adres bestaat, is een resetmail verzonden.",
      });
    }

    const token = createResetToken(email);
    await sendResetEmail(email, token);

    return NextResponse.json({
      ok: true,
      message: "Als dit adres bestaat, is een resetmail verzonden.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

