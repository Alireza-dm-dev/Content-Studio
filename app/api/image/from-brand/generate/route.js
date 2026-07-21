import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess } from "@/lib/auth";
import { generateWithPromptTemplate } from "@/lib/ai";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "@/lib/brand-identity-utils";
import { normalizeVisualControls, serializeVisualControls } from "@/lib/image-visual-controls";

const TEMPLATE_SLUG = "image-prompt-from-brand-and-post-without-reference";

const FALLBACK_TEMPLATE = `You are creating a final ready-to-use prompt for Nanobanana image generation.

Use the brand identity summary as design guidance only. Do not write out the full brand identity. Do not expose JSON. Do not explain your reasoning.

Create ONE concise Nanobanana-ready image prompt.

The prompt must describe:
1. Final image concept and subject
2. Layout and composition
3. Brand colors and visual style (mention only key values)
4. Text to appear on image (if provided — include verbatim)
5. Post type and platform context
6. Aspect ratio
7. Visual style direction
8. Logo placement if relevant (say "use the real brand logo" — do not invent logo details)
9. What to avoid (clutter, unreadable text, distorted logos, extra text, off-brand colors)

Rules:
- Return ONLY the final prompt text.
- No markdown, no labels, no section headers, no explanations before or after.
- Keep the output under 1400 characters.
- Make it production-ready and immediately usable in Nanobanana.`;

export async function POST(request) {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    brandId,
    rawIdeaOrPostInformation,
    outputImageTextRequirements = "",
    postType = "Static post",
    platform = "Instagram",
    aspectRatio = "4:5",
    creativeGoal = "Awareness",
    visualStyleDirection = "Clean and minimal",
    textDensity = "Headline plus short supporting text",
  } = body ?? {};

  // Normalize untrusted control input. Invalid/unknown values collapse to
  // "auto" and never throw — this must not cause a 400 or 500.
  const normalizedVisualControls = normalizeVisualControls(body?.visualControls);

  if (!brandId) {
    return NextResponse.json({ success: false, error: "Please choose a brand." }, { status: 400 });
  }
  if (!rawIdeaOrPostInformation?.trim()) {
    return NextResponse.json({ success: false, error: "Please enter your raw idea or post information." }, { status: 400 });
  }

  try {
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) {
      return NextResponse.json({ success: false, error: "Brand not found." }, { status: 404 });
    }

    const brandIdentity = await prisma.brandIdentity.findFirst({
      where: { brandId },
      orderBy: { createdAt: "desc" },
    });
    if (!brandIdentity) {
      return NextResponse.json({
        success: false,
        error: "Please create or approve a brand identity before generating a brand-based image prompt.",
      }, { status: 422 });
    }

    const { brandVisualIdentity } = normalizeBrandIdentityOutput(brandIdentity);
    const brandIdentitySummary = createCompactBrandVisualIdentitySummaryForImagePrompt(brandVisualIdentity);

    // Ensure template has up-to-date instructions for the new structured-input flow
    const template = await prisma.promptTemplate.findUnique({ where: { slug: TEMPLATE_SLUG } });
    if (!template) {
      return NextResponse.json({ success: false, error: "Prompt template not configured." }, { status: 500 });
    }
    if (needsTemplateUpdate(template.templateText)) {
      await prisma.promptTemplate.update({
        where: { slug: TEMPLATE_SLUG },
        data: { templateText: FALLBACK_TEMPLATE },
      });
    }

    const userInput = buildUserInput({
      brandIdentitySummary,
      rawIdeaOrPostInformation: rawIdeaOrPostInformation.trim(),
      outputImageTextRequirements: outputImageTextRequirements?.trim() ?? "",
      postType,
      platform,
      aspectRatio,
      creativeGoal,
      visualStyleDirection,
      textDensity,
      visualControlsBlock: serializeVisualControls(normalizedVisualControls),
    });

    const result = await generateWithPromptTemplate({
      templateSlug: TEMPLATE_SLUG,
      userInput,
      variables: {},
    });

    const finalPrompt = (typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content)
    ).trim();

    const saved = await prisma.generatedPrompt.create({
      data: {
        type: "image",
        mode: "brand_based_without_reference",
        targetTool: "Nanobanana",
        brandId,
        rawInput: JSON.stringify({
          brandId,
          rawIdeaOrPostInformation,
          outputImageTextRequirements,
          postType,
          platform,
          aspectRatio,
          creativeGoal,
          visualStyleDirection,
          textDensity,
          brandIdentitySummary,
        }),
        finalPrompt,
      },
    });

    return NextResponse.json({
      success: true,
      generatedPrompt: {
        id: saved.id,
        finalPrompt,
      },
    });
  } catch (err) {
    console.error("[image/from-brand/generate]", err);
    if (err.message?.includes("not configured")) {
      return NextResponse.json({
        success: false,
        code: "OPENAI_NOT_CONFIGURED",
        error: "OpenAI is not configured. Ask an administrator to add the API key in Settings.",
      }, { status: 503 });
    }
    return NextResponse.json({
      success: false,
      error: err.message ?? "Generation failed.",
      ...(process.env.NODE_ENV === "development" ? { details: err.stack } : {}),
    }, { status: 500 });
  }
}

function needsTemplateUpdate(text) {
  if (!text || text.includes("// Placeholder for:")) return true;
  // Update if the template lacks the key instruction for our compact-input flow
  return !text.includes("Nanobanana-ready image prompt");
}

function buildUserInput({
  brandIdentitySummary,
  rawIdeaOrPostInformation,
  outputImageTextRequirements,
  postType,
  platform,
  aspectRatio,
  creativeGoal,
  visualStyleDirection,
  textDensity,
  visualControlsBlock,
}) {
  const lines = [
    `Brand identity summary: ${brandIdentitySummary}`,
    "",
    `Post type: ${postType}`,
    `Platform: ${platform}`,
    `Aspect ratio: ${aspectRatio}`,
    `Creative goal: ${creativeGoal}`,
    `Visual style direction: ${visualStyleDirection}`,
    `Text density: ${textDensity}`,
    "",
    `Raw idea or post information: ${rawIdeaOrPostInformation}`,
  ];

  if (outputImageTextRequirements) {
    lines.push("", `Image text requirements:\n${outputImageTextRequirements}`);
  }

  // ── Selected Visual Production Controls (explicit user constraints) ──────
  // Only non-auto selections are serialized; auto values are never sent to the
  // AI. Appended as production/style direction that must not override the
  // brand's required identity.
  if (visualControlsBlock) {
    lines.push(
      "",
      visualControlsBlock,
      "",
      "These selected Visual Production Controls are intentional user constraints. Apply them as production/style direction only. They must NOT alter the brand's required identity — brand colors, logo rules, typography, photography/illustration style, tone, products, or services. Where a control conflicts with required brand identity, apply it in the closest compatible way (for example, a lighting or colour-treatment choice may shift mood and grade but must not redesign the product or replace brand assets). Never invent a different logo, palette, product, or brand style.",
    );
  }

  return lines.join("\n");
}
