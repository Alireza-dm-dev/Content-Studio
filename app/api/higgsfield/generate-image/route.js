import { NextResponse } from "next/server";
import { spendTokens, refundTokens, completeGeneratedMedia, generateImage } from "@/lib/higgsfield";
import { prisma } from "@/lib/prisma";

// Matches Higgsfield's "not enough real credits" failures (NotEnoughCreditsError
// and similar wording), as opposed to other generation errors.
const CREDIT_ERROR_PATTERN = /not enough credits|notenoughcredits|insufficient credits/i;

// ── POST /api/higgsfield/generate-image ───────────────────────────────────

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const {
    higgsfieldModelId,
    prompt,
    aspectRatio,
    safetyTolerance,
    seed,
    brandId,
    calendarPostId,
    generatedPromptId,
  } = body ?? {};

  // ── Validation ────────────────────────────────────────────────────────
  if (!higgsfieldModelId || typeof higgsfieldModelId !== "string") {
    return NextResponse.json({ error: "higgsfieldModelId is required." }, { status: 400 });
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "prompt is required." }, { status: 400 });
  }

  const trimmedPrompt = prompt.trim();
  const effectiveAspectRatio = aspectRatio ?? "9:16";
  const effectiveSafetyTolerance = safetyTolerance ?? 2;

  try {
    // ── 1. Spend local tokens + create pending GeneratedMedia ─────────────
    let spendResult;
    try {
      spendResult = await spendTokens({
        higgsfieldModelId,
        mediaType: "image",
        sourcePrompt: trimmedPrompt,
        brandId,
        calendarPostId,
        generatedPromptId,
      });
    } catch (spendErr) {
      if (spendErr.message === "INSUFFICIENT_HIGGSFIELD_BALANCE") {
        return NextResponse.json(
          { error: "Insufficient Higgsfield token balance." },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: spendErr.message }, { status: 400 });
    }

    const { generatedMedia, higgsfieldModel, balanceAfter } = spendResult;

    // Tag the record with the provider that created it.
    await prisma.generatedMedia.update({
      where: { id: generatedMedia.id },
      data: { provider: "higgsfield" },
    });

    // ── 2. Call Higgsfield ──────────────────────────────────────────────
    let generationResult;
    try {
      generationResult = await generateImage({
        modelKey: higgsfieldModel.modelKey,
        prompt: trimmedPrompt,
        aspectRatio: effectiveAspectRatio,
        safetyTolerance: effectiveSafetyTolerance,
        seed,
      });
    } catch (genErr) {
      // ── 2a. Refund + mark failed on generation error ───────────────────
      try {
        const refundResult = await refundTokens({
          generatedMediaId: generatedMedia.id,
          errorMessage: genErr.message,
        });

        if (CREDIT_ERROR_PATTERN.test(genErr.message ?? "")) {
          return NextResponse.json(
            {
              error: "Higgsfield account has insufficient real credits.",
              detail:
                "The generation reached Higgsfield, but the connected Higgsfield account does not have enough real credits. Your local app tokens were refunded.",
              generatedMedia: refundResult.generatedMedia,
              balanceAfter: refundResult.balanceAfter,
            },
            { status: 500 }
          );
        }

        return NextResponse.json(
          {
            error: "Higgsfield image generation failed.",
            detail: genErr.message,
            generatedMedia: refundResult.generatedMedia,
            balanceAfter: refundResult.balanceAfter,
          },
          { status: 500 }
        );
      } catch (refundErr) {
        return NextResponse.json(
          {
            error: "Higgsfield image generation failed and refund could not be completed.",
            detail: genErr.message,
            refundError: refundErr.message,
          },
          { status: 500 }
        );
      }
    }

    // ── 3. Mark completed on success ─────────────────────────────────────
    const { remoteUrl, externalJobId } = generationResult;
    const completedGeneratedMedia = await completeGeneratedMedia({
      generatedMediaId: generatedMedia.id,
      remoteUrl,
      externalJobId,
    });

    return NextResponse.json({
      generatedMedia: completedGeneratedMedia,
      remoteUrl,
      externalJobId,
      balanceAfter,
    });
  } catch (err) {
    console.error("[HiggsfieldGenerateImage] Unhandled error:", err);
    return NextResponse.json(
      { error: "Higgsfield image generation failed.", detail: err.message },
      { status: 500 }
    );
  }
}
