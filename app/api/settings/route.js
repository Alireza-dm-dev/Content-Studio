import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess } from "@/lib/auth";
import { TRIAL_SETTING_KEYS } from "@/lib/n8n-trial-webhook";

// Trial webhook keys are managed ONLY by /api/settings/n8n (validated, secret
// write-only): never returned here and never writable through this generic route.
const TRIAL_KEYS = new Set(TRIAL_SETTING_KEYS);

export async function GET() {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const settings = (await prisma.settings.findMany()).filter((s) => !TRIAL_KEYS.has(s.key));
  const result = Object.fromEntries(
    settings.map((s) => {
      if (s.key === "N8N_PUBLISHED_POST_WEBHOOK_URL") {
        return [s.key, s.value ? "configured" : ""];
      }
      return [s.key, s.value];
    })
  );
  return NextResponse.json(result);
}

export async function POST(request) {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { key, value } = await request.json();
  if (!key) return NextResponse.json({ error: "Key is required" }, { status: 400 });
  if (TRIAL_KEYS.has(key)) {
    return NextResponse.json(
      { error: "Trial webhook settings can only be changed in Settings → n8n Webhooks.", code: "USE_N8N_SETTINGS_ENDPOINT" },
      { status: 400 },
    );
  }
  const setting = await prisma.settings.upsert({
    where: { key },
    update: { value, updatedAt: new Date() },
    create: { key, value, updatedAt: new Date() },
  });
  return NextResponse.json(setting);
}
