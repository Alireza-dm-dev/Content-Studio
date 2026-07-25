import { PrismaClient } from "../lib/generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { IMAGE_PROMPT_BOOSTER_RAW_IDEA_TEXT } from "../lib/default-prompt-templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = "file:" + path.join(__dirname, "../dev.db");

const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Placeholder text used for every template.
// The user will paste the real prompt text in the Prompt Library editor.
// ---------------------------------------------------------------------------
function placeholder(name) {
  return `// Placeholder for: ${name}
// Paste your full prompt text here.
// Use {{variable_name}} syntax for dynamic values.`;
}

// ---------------------------------------------------------------------------
// Default instructions for the Video Prompt Enhancer (Raw Idea) template.
// Documents the "Cinematic Controls" contract so every generated video
// prompt ends with a labeled section covering speed ramp, camera movement,
// camera, lens, focal length, and aperture.
// ---------------------------------------------------------------------------
const VIDEO_PROMPT_ENHANCER_RAW_IDEA_TEXT = `You are the Video Prompt Enhancer. Turn the raw video idea and any supporting context below (brand identity, storyboard, calendar post data, visual direction, uploaded reference images) into a single, detailed, production-ready video generation prompt for the requested video creator model.

STRICT RULE — Auto resolution: If any cinematic control input is "Auto" or "Auto — infer from context", do not write "Auto" (or "Auto — infer from context") anywhere in the final output. Instead, choose the most suitable allowed value for that field based on the raw video idea and any available context (brand identity, storyboard, calendar post data, visual direction, uploaded reference images). If the input is already a specific, non-Auto value, keep that exact value — do not change it.

Visual context priority:
- If an uploaded image or other visual context (reference image analysis, combined visual direction, brand visual identity) is provided, use it as the primary source for inferring cinematic choices.
- If no image or visual context is available, infer cinematic choices from the raw video idea, brand identity, storyboard, calendar post data, and visual direction provided below.

The final prompt must end with a clearly labeled section, formatted exactly like this:

Cinematic Controls:
- Speed ramp: <value>
- Camera movement: <value>
- Camera: <value>
- Lens: <value>
- Focal length: <value>
- Aperture: <value>

Field rules:
- Speed ramp — if the input is "Auto" or "Auto — infer from context", choose one of: Slow-mo, Ramp Up, Flash In, Flash Out, Bullet Time, Hero Moment, or a short custom value that better fits the scene. Otherwise keep the given value exactly.
- Camera movement — the system pre-selects the camera movement deterministically based on genre, style, scene, action level, and platform. The input value is already resolved (never "Auto"). Use the exact value provided. Do not override or change it.
- Camera — if the input is "Auto" or "Auto — infer from context", choose one of: Raw 16 mm, Fine film, Clean Digital. Otherwise keep the given value exactly.
- Lens — if the input is "Auto" or "Auto — infer from context", choose one of: extreme macro, anamorphic, warm halation, vintage haze. Otherwise keep the given value exactly.
- Focal length — if the input is "Auto" or "Auto — infer from context", choose one of (in mm): 45, 75, 50, 35, 14, 8. Otherwise keep the given value exactly.
- Aperture — if the input is "Auto" or "Auto — infer from context", choose one of: f/11 deep focus, f/1.4 wide open, f/4 moderate. Otherwise keep the given value exactly.

Camera movement is pre-selected by the system's deterministic camera movement module (genre/style/scene/action-driven taxonomy). The provided camera movement value is the final resolved choice — do not override it. Use it exactly as given.

If the input below includes a "CINEMATIC CONTROLS" section with requested values, treat each value per the field rules above: a specific (non-Auto) value must be honored exactly unless it clearly conflicts with the visual context, and any value of "Auto" or "Auto — infer from context" must be replaced with a real choice from the allowed options.

Final output rule: The final output must include all six cinematic fields listed above, but none of them may be "Auto" or "Auto — infer from context".

Always write the Cinematic Controls section as plain text inside the final prompt. Never return JSON.`;

// ---------------------------------------------------------------------------
// Default instructions for the LinkedIn Post From Reference template.
// Grounds every suggested post in one of the fetched articles supplied in
// userInput (see app/api/content-calendar/linkedin/suggest-posts/route.js) —
// unlike most content templates, this one ships with real instructions
// instead of a placeholder so the LinkedIn journey works without a manual
// Prompt Library edit first.
// ---------------------------------------------------------------------------
const LINKEDIN_POST_FROM_REFERENCE_TEXT = `You are a LinkedIn content strategist. Using ONLY the article(s) provided below, generate exactly {{numberOfPosts}} LinkedIn post ideas for {{brandName}}.

STRICT RULES:
- Platform is LinkedIn only.
- Each post's "format" must be exactly "Static" or "Carousel" — never Reel, Story, Video, or any other format.
- Every post idea MUST be grounded in one of the provided articles. Do not invent facts, statistics, quotes, or claims that are not present in the article text below.
- If there is only one article, base all {{numberOfPosts}} ideas on that single article, exploring different angles, sections, or takeaways from it.
- If there are multiple articles, distribute the {{numberOfPosts}} ideas across them based on which articles offer the strongest, most professionally relevant angles for LinkedIn — you do not need to use every article, and you may generate more than one idea from the same article.
- Write in a professional, credible LinkedIn tone — no hashtag spam, no clickbait, no emoji overuse.

For every post idea, include:
- "postNumber": sequential number starting at 1
- "articleIndex": the 0-based index of the article (from the ARTICLES list below) this idea is grounded in
- "format": "Static" or "Carousel"
- "suggestedHook": a strong opening line/hook
- "mainAngleAndCoreMessage": the core angle and message of the post
- "suggestedCaption": a full draft LinkedIn caption
- "visualDirection": a description of the accompanying visual (single image for Static, or slide-by-slide direction for Carousel)
- "contentStructure": for Carousel, a slide-by-slide breakdown ("Slide 1: ...", "Slide 2: ..."); for Static, a short structure summary
- "hashtags": an array of 3-5 relevant LinkedIn hashtags
- "inspirationSource": a short note on which article/section inspired this idea

Return a JSON object: { "posts": [ ... ] } with exactly {{numberOfPosts}} entries in the "posts" array.`;

// ---------------------------------------------------------------------------
// Default instructions for the Video Prompt Revision template. Rewrites an
// already-generated final video prompt according to user feedback, keeping
// it in sync with the row inserted directly into dev.db.
// ---------------------------------------------------------------------------
const VIDEO_PROMPT_REVISION_TEXT = `You are a video prompt revision assistant.

# Current final video prompt:

{{currentPrompt}}

# Requested changes (user feedback):

{{feedback}}

# Your task:

Rewrite the current final video prompt above so that it fully incorporates the requested changes, while preserving everything else that the feedback does not ask you to change.

# Rules:

- Keep the same overall structure, level of detail, and specificity as the current prompt.
- Only change what the feedback asks you to change. Do not remove or simplify unrelated details that the feedback does not mention.
- Do not ask the user any clarification questions. Make a reasonable interpretation of the feedback and apply it directly.
- Do not include commentary, explanations, or notes about what you changed. Output only the revised prompt itself.
- The revised prompt must start with the exact sentence: "Generate a video with the following prompt" (do not paraphrase this opening line).

Return only the final revised video prompt text.`;

const TEMPLATES = [
  {
    id: "tpl-brand-visual-identity-extractor",
    name: "Brand Visual Identity Extractor",
    slug: "brand-visual-identity-extractor",
    category: "brand",
    outputType: "json",
  },
  {
    id: "tpl-reference-image-information-extractor",
    name: "Reference Image Information Extractor",
    slug: "reference-image-information-extractor",
    category: "image",
    outputType: "json",
  },
  {
    id: "tpl-image-reference-and-brand-identity-combiner",
    name: "Image Reference & Brand Identity Combiner",
    slug: "image-reference-and-brand-identity-combiner",
    category: "image",
    outputType: "json",
  },
  {
    id: "tpl-image-prompt-booster-raw-idea",
    name: "Image Prompt Booster (Raw Idea)",
    slug: "image-prompt-booster-raw-idea",
    category: "image",
    outputType: "text",
  },
  {
    id: "tpl-video-storyboard-generator",
    name: "Video Storyboard Generator",
    slug: "video-storyboard-generator",
    category: "video",
    outputType: "storyboard",
  },
  {
    id: "tpl-video-prompt-enhancer-raw-idea",
    name: "Video Prompt Enhancer (Raw Idea)",
    slug: "video-prompt-enhancer-raw-idea",
    category: "video",
    outputType: "text",
  },
  {
    id: "tpl-video-prompt-revision",
    name: "Video Prompt Revision",
    slug: "video-prompt-revision",
    category: "video",
    outputType: "text",
  },
  {
    id: "tpl-post-suggestor",
    name: "Post Suggestor",
    slug: "post-suggestor",
    category: "content",
    outputType: "json",
  },
  {
    id: "tpl-content-calendar-generator",
    name: "Content Calendar Generator",
    slug: "content-calendar-generator",
    category: "calendar",
    outputType: "json",
  },
  {
    id: "tpl-image-prompt-from-brand-and-post-without-reference",
    name: "Image Prompt from Brand & Post (No Reference)",
    slug: "image-prompt-from-brand-and-post-without-reference",
    category: "image",
    outputType: "text",
  },
  {
    id: "tpl-brand-identity-regeneration",
    name: "Brand Identity Regeneration",
    slug: "brand-identity-regeneration",
    category: "brand",
    outputType: "json",
  },
  {
    id: "tpl-linkedin-post-from-reference",
    name: "LinkedIn Post From Reference",
    slug: "linkedin-post-from-reference",
    category: "content-calendar",
    outputType: "json",
  },
];

const HIGGSFIELD_MODELS = [
  {
    modelKey: "higgsfield-image-placeholder",
    label: "Higgsfield Image Placeholder",
    mediaType: "image",
    tokenCost: 10,
    description:
      "Placeholder image model until official Higgsfield model IDs are configured.",
    isActive: false,
  },
  {
    modelKey: "higgsfield-video-placeholder",
    label: "Higgsfield Video Placeholder",
    mediaType: "video",
    tokenCost: 50,
    description:
      "Placeholder video model until official Higgsfield model IDs are configured.",
    isActive: false,
  },
  {
    modelKey: "flux-pro/kontext/max/text-to-image",
    label: "Flux Pro Kontext Max (Text to Image)",
    mediaType: "image",
    tokenCost: 10,
    description:
      "Official Higgsfield text to image endpoint for image generation testing.",
    isActive: true,
  },
];

async function main() {
  // Sample brand
  const brand = await prisma.brand.upsert({
    where: { id: "seed-brand-01" },
    update: {},
    create: {
      id: "seed-brand-01",
      name: "Bloom Studio",
      website: "https://bloomstudio.example.com",
      instagramPage: "@bloomstudio",
      linkedinPage: "linkedin.com/company/bloomstudio",
      facebookPage: "facebook.com/bloomstudio",
      businessLocation: "Austin, TX",
      businessType: "Creative Agency",
      mainServicesOrProducts:
        "Brand identity, social media content, and digital marketing for small businesses",
      targetAudience:
        "Small business owners aged 28–45 looking to grow their online presence",
      brandTone: "Warm, approachable, and creatively inspiring",
      brandVisualStyle: "Clean minimalism with earthy tones and bold typography",
    },
  });
  console.log(`Seeded brand: ${brand.name} (${brand.id})`);

  // Delete any old template slugs that no longer exist in TEMPLATES
  const keepSlugs = TEMPLATES.map((t) => t.slug);
  const deleted = await prisma.promptTemplate.deleteMany({
    where: { slug: { notIn: keepSlugs } },
  });
  if (deleted.count > 0) console.log(`Removed ${deleted.count} old template(s)`);

  // Upsert the 8 canonical templates
  for (const tpl of TEMPLATES) {
    const text = tpl.slug === "video-prompt-enhancer-raw-idea"
      ? VIDEO_PROMPT_ENHANCER_RAW_IDEA_TEXT
      : tpl.slug === "video-prompt-revision"
      ? VIDEO_PROMPT_REVISION_TEXT
      : tpl.slug === "linkedin-post-from-reference"
      ? LINKEDIN_POST_FROM_REFERENCE_TEXT
      : tpl.slug === "image-prompt-booster-raw-idea"
      ? IMAGE_PROMPT_BOOSTER_RAW_IDEA_TEXT
      : placeholder(tpl.name);
    await prisma.promptTemplate.upsert({
      where: { slug: tpl.slug },
      // On update: only refresh name/category/outputType; never overwrite
      // templateText so user edits are preserved.
      update: {
        name: tpl.name,
        category: tpl.category,
        outputType: tpl.outputType,
        defaultTemplateText: text,
      },
      create: {
        id: tpl.id,
        name: tpl.name,
        slug: tpl.slug,
        category: tpl.category,
        outputType: tpl.outputType,
        templateText: text,
        defaultTemplateText: text,
      },
    });
    console.log(`Seeded template: ${tpl.name}`);
  }

  // Upsert the Higgsfield placeholder models
  for (const model of HIGGSFIELD_MODELS) {
    await prisma.higgsfieldModel.upsert({
      where: { modelKey: model.modelKey },
      update: {
        label: model.label,
        mediaType: model.mediaType,
        tokenCost: model.tokenCost,
        description: model.description,
        isActive: model.isActive,
      },
      create: model,
    });
    console.log(`Seeded Higgsfield model: ${model.label}`);
  }

  // Ensure a token balance row exists for the higgsfield provider,
  // without resetting an existing balance
  await prisma.operatorTokenBalance.upsert({
    where: { provider: "higgsfield" },
    update: {},
    create: { provider: "higgsfield", balance: 0 },
  });
  console.log("Seeded operator token balance: higgsfield");

  console.log("\nSeed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
