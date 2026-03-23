import { NextRequest, NextResponse } from "next/server";
import { setPassword, verifyResetToken } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token ?? "");
    const newPassword = String(body.newPassword ?? "");

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "Nieuw wachtwoord moet minimaal 6 tekens zijn." },
        { status: 400 }
      );
    }

    const valid = verifyResetToken(token);
    if (!valid.ok || !valid.email) {
      return NextResponse.json({ error: valid.error ?? "Ongeldige token." }, { status: 400 });
    }

    await setPassword(valid.email, newPassword);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

