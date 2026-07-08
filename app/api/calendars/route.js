import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeOutputImageTextRequirementsStructured, formatOutputImageTextRequirementsForDisplay } from "@/lib/calendar-post-utils";

// ── Date helper ────────────────────────────────────────────────────────────────
function parseDate(d) {
  if (!d || typeof d !== "string" || !d.trim()) return null;
  const dt = new Date(d.trim().slice(0, 10));
  return isNaN(dt.getTime()) ? null : dt;
}

// ── Build postData object (Prisma Json field — pass as plain object, no stringify) ──
function buildPostData(p) {
  const hashtags = (() => {
    const v = p.hashtags;
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim()) return v.split(/[\s,]+/).filter(Boolean);
    return [];
  })();

  return {
    mainAngle:   p.mainAngle   || null,
    coreMessage: p.coreMessage || null,
    hookTitle:   p.hookTitle   || p.suggestedHook || null,
    caption:     p.caption     || p.suggestedCaption || null,
    hashtags,
    imageText:   p.imageText   || null,
    outputImageTextRequirements: p.outputImageTextRequirements || null,
    outputImageTextRequirementsStructured: normalizeOutputImageTextRequirementsStructured(
      p.outputImageTextRequirementsStructured ?? p.outputImageTextRequirements ?? null
    ),
    structure:   p.structure   || null,
    inspiration: p.inspiration || p.inspirationSource || null,
    videoConceptTitleAndThumbnailTitleIdea: p.videoConceptTitleAndThumbnailTitleIdea || null,
    videoRawIdea:           p.videoRawIdea           || null,
    mainIntegratedScenario: p.mainIntegratedScenario  || null,
    thumbnailIdeaForReel:   p.thumbnailIdeaForReel    || null,
    narrationOrDialogueOfCharacterOrCharacters: p.narrationOrDialogueOfCharacterOrCharacters || null,
    rawImageIdeaForFirstFrame: p.rawImageIdeaForFirstFrame || null,
    whatHappens:               p.whatHappens               || null,
    characterObjectOrEnvironmentAction: p.characterObjectOrEnvironmentAction || null,
    cameraMovement: p.cameraMovement || null,
    speedRamp:      p.speedRamp      || null,
    camera:         p.camera         || null,
    lens:           p.lens           || null,
    focalLength:    p.focalLength    || null,
    aperture:       p.aperture       || null,
    visualMood:     p.visualMood     || null,
    textOnVideo:    p.textOnVideo    || null,
  };
}

// ── Map a single post payload → CalendarPost create data ──────────────────────
function mapPost(p, i, calendarPlatform) {
  const hashtags = (() => {
    const v = p.hashtags;
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim()) return v.split(/[\s,]+/).filter(Boolean);
    return [];
  })();

  // Prefer pre-built postData if it's already a JSON string (from serializePostForSave).
  // Otherwise build it from individual camelCase fields (raw AI output format).
  let postData;
  if (typeof p.postData === "string" && p.postData.trim().startsWith("{")) {
    postData = p.postData; // already serialized
  } else if (p.postData && typeof p.postData === "object") {
    postData = JSON.stringify(p.postData); // object from HTTP body
  } else {
    postData = JSON.stringify(buildPostData(p));
  }

  return {
    postNumber: p.postNumber != null ? Number(p.postNumber) : i + 1,
    date:       parseDate(p.date),
    platform:   p.platform || calendarPlatform || null,
    format:     p.format   || null,
    suggestedHook:            p.hookTitle || p.suggestedHook                                                 || null,
    mainAngleAndCoreMessage:  [p.mainAngle, p.coreMessage].filter(Boolean).join(". ") || p.mainAngleAndCoreMessage || null,
    suggestedCaption:         p.caption   || p.suggestedCaption                                              || null,
    hashtags:                 hashtags.join(" ") || null,
    visualDirection:          p.visualDirection  || null,
    contentStructure:         p.contentStructure || null,
    // Save the dedicated field directly; if only the structured object is present
    // (e.g. fresh AI output before round-tripping through serializePostForSave),
    // derive the clean string from it so the column is never out of sync; fall
    // back to imageText for old-format posts only.
    outputImageTextRequirements:
      p.outputImageTextRequirements ||
      formatOutputImageTextRequirementsForDisplay(p.outputImageTextRequirementsStructured) ||
      p.imageText || null,
    inspirationSource:        p.inspiration || p.inspirationSource            || null,
    referenceLink:            p.referenceLink                                 || null,
    contentOrigin:            p.contentOrigin                                 || "original",
    status:                   "draft",
    postData,
  };
}

// ── GET /api/calendars ─────────────────────────────────────────────────────────
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get("brandId");
    const calendars = await prisma.contentCalendar.findMany({
      where: brandId ? { brandId } : undefined,
      include: { brand: true, _count: { select: { posts: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(calendars);
  } catch (err) {
    console.error("[Calendars GET] Error:", err.message);
    return NextResponse.json(
      { success: false, error: "Failed to load calendars.", details: err.message },
      { status: 500 }
    );
  }
}

// ── POST /api/calendars ────────────────────────────────────────────────────────
export async function POST(request) {
  console.log("[SaveCalendar] POST /api/calendars");
  try {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json(
        { success: false, error: "Invalid request body.", details: e.message },
        { status: 400 }
      );
    }

    const {
      title, platform, brandId, timePeriod,
      mainMonthlySubject, mainGoal, mainOfferOrMessage, sourceMaterial,
      status: rawStatus,
      posts,
    } = body;

    const VALID_STATUSES = ["draft", "approved", "active", "completed"];
    const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : "draft";

    console.log("[SaveCalendar] brandId:", brandId, "| posts count:", posts?.length);
    if (posts?.[0]) console.log("[SaveCalendar] first post sample:", JSON.stringify(posts[0]).slice(0, 300));

    if (!title?.trim()) {
      return NextResponse.json(
        { success: false, error: "Calendar title is required." },
        { status: 400 }
      );
    }
    if (!brandId) {
      return NextResponse.json(
        { success: false, error: "Please choose a brand before saving the content calendar." },
        { status: 400 }
      );
    }
    if (!Array.isArray(posts) || posts.length === 0) {
      return NextResponse.json(
        { success: false, error: "There are no posts to save." },
        { status: 400 }
      );
    }

    const postCreateData = posts.map((p, i) => mapPost(p, i, platform));
    console.log("[SaveCalendar] First Prisma post create data keys:", Object.keys(postCreateData[0]));

    const calendar = await prisma.contentCalendar.create({
      data: {
        title: title.trim(),
        platform: platform || null,
        brandId: brandId || null,
        timePeriod: timePeriod || null,
        mainMonthlySubject: mainMonthlySubject || null,
        mainGoal: mainGoal || null,
        mainOfferOrMessage: mainOfferOrMessage || null,
        sourceMaterial: sourceMaterial || null,
        status,
        posts: {
          create: postCreateData,
        },
      },
      include: { _count: { select: { posts: true } } },
    });

    console.log("[SaveCalendar] Saved id:", calendar.id, "| posts:", calendar._count.posts);

    return NextResponse.json(
      { success: true, id: calendar.id, ...calendar, message: "Content calendar saved successfully." },
      { status: 201 }
    );

  } catch (err) {
    console.error("[SaveCalendar] Error:", err.message);
    return NextResponse.json(
      {
        success: false,
        error: "Content calendar could not be saved. Please try again.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
