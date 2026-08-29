import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeOutputImageTextRequirementsStructured } from "@/lib/calendar-post-utils";
import { getBrandCalendarAccess } from "@/lib/auth";

export async function PATCH(request, { params }) {
  const { id } = await params;

  const post = await prisma.calendarPost.findUnique({
    where: { id },
    select: { id: true, postData: true, calendar: { select: { brandId: true, status: true } } },
  });
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const access = await getBrandCalendarAccess(post.calendar.brandId);
  if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status });

  if (!access.isAdmin && post.calendar.status !== "draft") {
    return NextResponse.json({ error: "Only draft calendars can be edited" }, { status: 403 });
  }

  let body;
  try { body = await request.json(); }
  catch (e) {
    return NextResponse.json({ success: false, error: "Invalid request body.", details: e.message }, { status: 400 });
  }

  // Normalize hashtags: accept array or space-separated string
  const hashtags = (() => {
    const v = body.hashtags;
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim()) return v.split(/[\s,]+/).filter(Boolean);
    return [];
  })();

  // Manual edits from the (legacy) hashtags/caption UI fields don't know about
  // the merged-caption format — preserve whatever flag value already existed
  // on the record unless the caller explicitly sends one, so a plain metadata
  // edit (e.g. just changing the date) can't silently reset it.
  let existingMeta = {};
  if (post.postData) {
    try { existingMeta = typeof post.postData === "string" ? JSON.parse(post.postData) : post.postData; }
    catch { /* ignore malformed JSON */ }
  }

  // Build postData object (Prisma Json field) with all camelCase fields
  const meta = {
    mainAngle:   body.mainAngle   ?? null,
    coreMessage: body.coreMessage ?? null,
    hookTitle:   body.hookTitle   ?? null,
    caption:     body.caption     ?? null,
    hashtags,
    hashtagsMergedIntoCaption: body.hashtagsMergedIntoCaption ?? existingMeta.hashtagsMergedIntoCaption ?? false,
    imageText:   body.imageText   ?? null,
    outputImageTextRequirements: body.outputImageTextRequirements ?? null,
    // If the edit form supplies a structured object directly, use it; otherwise
    // re-derive it from whatever string the user just saved — this keeps the
    // two fields from ever drifting apart, and means a manual edit to the
    // clean text "wins" and propagates into the structured source too.
    outputImageTextRequirementsStructured: body.outputImageTextRequirementsStructured !== undefined
      ? normalizeOutputImageTextRequirementsStructured(body.outputImageTextRequirementsStructured)
      : normalizeOutputImageTextRequirementsStructured(body.outputImageTextRequirements),
    structure:   body.structure   ?? null,
    inspiration: body.inspiration ?? null,
    videoConceptTitleAndThumbnailTitleIdea: body.videoConceptTitleAndThumbnailTitleIdea ?? null,
    videoRawIdea:           body.videoRawIdea           ?? null,
    mainIntegratedScenario: body.mainIntegratedScenario ?? null,
    thumbnailIdeaForReel:   body.thumbnailIdeaForReel   ?? null,
    narrationOrDialogueOfCharacterOrCharacters: body.narrationOrDialogueOfCharacterOrCharacters ?? null,
    rawImageIdeaForFirstFrame: body.rawImageIdeaForFirstFrame ?? null,
    whatHappens:               body.whatHappens               ?? null,
    characterObjectOrEnvironmentAction: body.characterObjectOrEnvironmentAction ?? null,
    cameraMovement: body.cameraMovement ?? null,
    speedRamp:      body.speedRamp      ?? null,
    camera:         body.camera         ?? null,
    lens:           body.lens           ?? null,
    focalLength:    body.focalLength    ?? null,
    aperture:       body.aperture       ?? null,
    visualMood:     body.visualMood     ?? null,
    textOnVideo:    body.textOnVideo    ?? null,
  };

  try {
    const post = await prisma.calendarPost.update({
      where: { id },
      data: {
        postNumber: body.postNumber != null ? Number(body.postNumber) : undefined,
        date:       body.date ? new Date(body.date) : null,
        platform:   body.platform   ?? undefined,
        format:     body.format     ?? undefined,
        // Keep backward-compat columns updated so old code still reads them
        suggestedHook:           (body.hookTitle ?? body.suggestedHook)     ?? undefined,
        mainAngleAndCoreMessage: ([body.mainAngle, body.coreMessage].filter(Boolean).join(". ") || body.mainAngleAndCoreMessage) || undefined,
        suggestedCaption:        (body.caption ?? body.suggestedCaption)    ?? undefined,
        hashtags:                hashtags.join(" ") || body.hashtags || undefined,
        visualDirection:         body.visualDirection         ?? undefined,
        contentStructure:        body.contentStructure        ?? undefined,
        // Save outputImageTextRequirements to its own dedicated DB column
        outputImageTextRequirements: body.outputImageTextRequirements ?? body.imageText ?? undefined,
        inspirationSource:       (body.inspiration ?? body.inspirationSource) ?? undefined,
        contentOrigin:           body.contentOrigin            ?? undefined,
        referenceLink:           body.referenceLink            ?? undefined,
        status:                  body.status ? body.status.toLowerCase() : undefined,
        postData:                JSON.stringify(meta),
      },
    });

    return NextResponse.json({ success: true, post });
  } catch (err) {
    console.error("[CalendarPost PATCH] Error:", err.message);
    return NextResponse.json(
      { success: false, error: "Failed to update post.", details: err.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  try {
    const post = await prisma.calendarPost.findUnique({
      where: { id },
      select: { id: true, calendar: { select: { brandId: true, status: true } } },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const access = await getBrandCalendarAccess(post.calendar.brandId);
    if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status });

    if (!access.isAdmin && post.calendar.status !== "draft") {
      return NextResponse.json({ error: "Only draft calendars can be edited" }, { status: 403 });
    }

    await prisma.calendarPost.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[CalendarPost DELETE] Error:", err.message);
    return NextResponse.json(
      { success: false, error: "Failed to delete post.", details: err.message },
      { status: 500 }
    );
  }
}
