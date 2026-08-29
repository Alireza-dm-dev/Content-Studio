import { NextResponse } from "next/server";
import { generateWithPromptTemplate } from "@/lib/ai";
import { getAdminAccess } from "@/lib/auth";
import { normalizeVisualControls, serializeVisualControls } from "@/lib/image-visual-controls";
import {
  resolveImageStyleAndPreset,
  imageStylePresetErrorResponse,
  buildProductionControlsSection,
} from "@/lib/image-style-preset-resolution";

const ALLOWED_TEMPLATE_SLUGS = new Set([
  "image-prompt-booster-raw-idea",
  "image-prompt-from-brand-and-post-without-reference",
  "video-storyboard-generator",
  "video-prompt-enhancer-raw-idea",
]);

export async function POST(request) {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, error: "Request body must be a JSON object" },
      { status: 400 }
    );
  }

  const { templateSlug, variables, responseFormat, images, userInput, visualControls } = body;

  if (typeof templateSlug !== "string" || !templateSlug.trim()) {
    return NextResponse.json(
      { success: false, error: "templateSlug is required" },
      { status: 400 }
    );
  }

  if (!ALLOWED_TEMPLATE_SLUGS.has(templateSlug)) {
    return NextResponse.json(
      { success: false, error: "Unsupported prompt template" },
      { status: 400 }
    );
  }

  try {
    // ── Shared style/preset resolution ──────────────────────────────────────
    // Invalid explicit selections return a structured 400 JSON instead of
    // being silently downgraded to "auto" or crashing later.
    if (visualControls !== undefined && visualControls !== null && typeof visualControls !== "object") {
      return NextResponse.json(
        { success: false, code: "INVALID_VISUAL_CONTROLS", error: "visualControls must be an object." },
        { status: 400 }
      );
    }
    const resolved = resolveImageStyleAndPreset(visualControls);
    if (!resolved.ok) {
      const { body, status } = imageStylePresetErrorResponse(resolved.errors);
      return NextResponse.json(body, { status });
    }

    const controls = normalizeVisualControls(visualControls);
    const controlsBlock = serializeVisualControls(controls);

    const rawIdeaText = typeof userInput === "string" ? userInput.trim() : "";
    const ideaBlock = `Raw image idea:\n${rawIdeaText}`;

    let finalUserInput;
    const parts = [];
    if (rawIdeaText) parts.push(ideaBlock);
    const productionSection = buildProductionControlsSection({
      manualControlsBlock: controlsBlock,
      cinematicStyle: resolved.cinematicStyle,
      preset: resolved.preset,
    });
    if (productionSection) parts.push(productionSection);
    finalUserInput = parts.length > 0 ? parts.join("\n\n") : null;

    const result = await generateWithPromptTemplate({
      templateSlug,
      variables: variables ?? {},
      responseFormat: responseFormat ?? "auto",
      images: images ?? [],
      userInput: finalUserInput,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[generate/test]", err);
    return NextResponse.json(
      { success: false, code: "PROMPT_BUILD_FAILED", error: err.message ?? "Generation failed" },
      { status: 500 }
    );
  }
}
