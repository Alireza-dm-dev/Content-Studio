import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getTodayData } from "@/lib/today";

export const dynamic = "force-dynamic";

// GET /api/today — read-only Today dashboard data for the signed-in user:
// Instagram + LinkedIn posts and Story Contents due on each accessible Brand's
// local today. Never mutates anything.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  try {
    const data = await getTodayData(user);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[Today] load failed:", err?.message);
    return NextResponse.json({ error: "Could not load today's schedule. Please try again." }, { status: 500 });
  }
}
