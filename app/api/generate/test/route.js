import { NextResponse } from "next/server";
import { generateWithPromptTemplate } from "@/lib/ai";
import { getAdminAccess } from "@/lib/auth";
import { normalizeVisualControls, serializeVisualControls, buildImageStyleBlock } from "@/lib/image-visual-controls";
import { resolveCinematicStyle } from "@/lib/cinematic-styles";

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
    const controls = normalizeVisualControls(visualControls);
    const controlsBlock = serializeVisualControls(controls);

    const rawIdeaText = typeof userInput === "string" ? userInput.trim() : "";
    const ideaBlock = `Raw image idea:\n${rawIdeaText}`;

    // ── Cinematic style validation ─────────────────────────────────────────────
    // Invalid explicit selections return a clean 400 instead of being silently
    // downgraded to "auto" or crashing later.
    const cinematic = resolveCinematicStyle(visualControls?.cinematicStyle);
    if (cinematic.error) {
      return NextResponse.json({ success: false, error: cinematic.error }, { status: 400 });
    }
    const styleBlock = cinematic.style !== "auto" ? buildImageStyleBlock(cinematic.style) : "";

    let finalUserInput;
    const parts = [];
    if (rawIdeaText) parts.push(ideaBlock);
    if (controlsBlock) parts.push(controlsBlock);
    if (styleBlock) parts.push(styleBlock);
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
    return NextResponse.json(
      { error: err.message ?? "Generation failed" },
      { status: 500 }
    );
  }
}
