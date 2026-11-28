import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { validateTrialDestination } from "@/lib/n8n-trial-webhook";
import { readTrialReadiness, trialUploadToken } from "@/lib/n8n-trial-runner";
import { TRIAL_UPLOAD_WARNING, PUBLISHING_MODE_TRIAL } from "@/lib/publishing-mode";

// Trial publishing mode for a NEW post (upload / adaptation forms).
//   GET   is a trial webhook configured and usable? (drives the mode selector)
//   POST  { binding } → an opaque confirmation token bound to the current trial
//         configuration and to that exact form state. The create / adapt
//         route rebuilds the binding from the real request and re-checks it.
// Nothing is saved or sent here. The trial URL, header name and secret are
// never returned.

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

function publicStatus(status) {
  return status.ready
    ? { configured: true, ready: true, destinationType: status.destinationType }
    : { configured: status.configured, ready: false, code: status.code, message: status.message };
}

export async function GET(request, { params }) {
  const { id } = await params;
  const access = await requireBrandAccess(id);
  if (!access.ok) return json({ error: access.error }, access.status);
  const { status } = await readTrialReadiness();
  return json(publicStatus(status));
}

export async function POST(request, { params }) {
  const { id } = await params;
  const access = await requireBrandAccess(id);
  if (!access.ok) return json({ error: access.error }, access.status);

  let binding;
  try {
    binding = (await request.json())?.binding;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!binding || typeof binding !== "object" || binding.mode !== PUBLISHING_MODE_TRIAL || binding.brandId !== id) {
    return json({ error: "Invalid trial confirmation request.", code: "INVALID_TRIAL_BINDING" }, 400);
  }

  const { config, status, configVersion } = await readTrialReadiness();
  if (!status.ready) return json(publicStatus(status), 409);
  const dest = await validateTrialDestination(config.url);
  if (!dest.ok) return json({ ready: false, code: dest.code, message: dest.error }, 409);

  const brand = await prisma.brand.findUnique({ where: { id }, select: { name: true } });
  return json({
    ready: true,
    brandName: brand?.name ?? null,
    destinationType: dest.destinationType,
    warning: TRIAL_UPLOAD_WARNING,
    token: trialUploadToken(configVersion, binding),
  });
}
