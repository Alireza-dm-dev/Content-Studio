import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWithPromptTemplate } from "@/lib/ai";

// The video-prompt-revision template always starts its revised prompt with
// this exact sentence. If the model instead returns a clarifying question or
// commentary, the response won't start with this prefix, so it must not be
// treated as a successful, saveable revision.
const EXPECTED_PROMPT_PREFIX = "Generate a video with the following prompt";

// ── POST /api/prompts/[id]/revise ─────────────────────────────────────────────

export async function POST(request, { params }) {
  const { id } = await params;
  console.log("[PromptRevise] POST id:", id);

  try {
    let body;
    try { body = await request.json(); }
    catch (e) {
      return NextResponse.json(
        { success: false, error: "Invalid request body.", details: e.message },
        { status: 400 }
      );
    }

    const { feedback } = body;

    if (!feedback?.trim()) {
      return NextResponse.json(
        { success: false, error: "Feedback is required." },
        { status: 400 }
      );
    }

    // ── 1. Load the existing prompt ────────────────────────────────────────
    const generatedPrompt = await prisma.generatedPrompt.findUnique({ where: { id } });

    if (!generatedPrompt) {
      return NextResponse.json(
        { success: false, error: "Generated prompt not found." },
        { status: 404 }
      );
    }

    if (generatedPrompt.type && generatedPrompt.type !== "video") {
      return NextResponse.json(
        { success: false, error: "Only video prompts can be revised with this endpoint." },
        { status: 400 }
      );
    }

    const currentPrompt = generatedPrompt.finalPrompt?.trim();
    if (!currentPrompt) {
      return NextResponse.json(
        { success: false, error: "This prompt has no existing final prompt text to revise." },
        { status: 400 }
      );
    }

    // ── 2. Call AI to revise the prompt ─────────────────────────────────────
    let revisedPrompt;
    try {
      const result = await generateWithPromptTemplate({
        templateSlug: "video-prompt-revision",
        variables: { currentPrompt, feedback: feedback.trim() },
      });

      revisedPrompt = typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content, null, 2);

      if (!revisedPrompt?.trim()) throw new Error("AI returned empty prompt.");
    } catch (aiErr) {
      console.error("[PromptRevise] AI error:", aiErr.message);
      if (aiErr.message?.includes("not found") || aiErr.message?.includes("placeholder")) {
        return NextResponse.json({
          success: false,
          error: "Video prompt revision template is missing. Please add video-prompt-revision to the prompt library.",
          details: aiErr.message,
        }, { status: 500 });
      }
      return NextResponse.json({
        success: false,
        error: "Prompt revision failed. Please try again.",
        details: aiErr.message,
      }, { status: 500 });
    }

    revisedPrompt = revisedPrompt.trim();

    // ── 3. Guard against clarification / malformed responses ────────────────
    // A valid revision always starts with EXPECTED_PROMPT_PREFIX. If it
    // doesn't, the model likely returned a clarifying question or commentary
    // instead of a usable video prompt — do not save or report that as success.
    if (!revisedPrompt.startsWith(EXPECTED_PROMPT_PREFIX)) {
      console.error("[PromptRevise] AI returned a malformed response (likely a clarification request):", revisedPrompt.slice(0, 500));
      return NextResponse.json({
        success: false,
        error: "The AI needs clarification before it can revise this video prompt. Please review its response and adjust your feedback.",
        details: revisedPrompt,
      }, { status: 422 });
    }

    // ── 4. Save the revision ─────────────────────────────────────────────────
    // Preserve the pre-revision prompt in referenceData, but only when that
    // field isn't already holding something else for this row — this endpoint
    // must not clobber data written by other flows.
    let updated;
    try {
      updated = await prisma.generatedPrompt.update({
        where: { id },
        data: {
          finalPrompt: revisedPrompt,
          ...(generatedPrompt.referenceData ? {} : { referenceData: currentPrompt }),
        },
      });
      console.log("[PromptRevise] Updated GeneratedPrompt id:", updated.id);
    } catch (dbErr) {
      console.error("[PromptRevise] DB update error:", dbErr.message);
      return NextResponse.json({
        success: false,
        error: "Prompt revised but could not be saved. Please try again.",
        details: dbErr.message,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      generatedPrompt: updated,
    });

  } catch (err) {
    console.error("[PromptRevise] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Prompt revision failed. Please try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
