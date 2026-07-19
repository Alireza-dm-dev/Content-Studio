import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export async function POST() {
  try {
    await clearSession();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Logout] Error:", err);
    return NextResponse.json(
      { error: "Logout failed." },
      { status: 500 }
    );
  }
}
