import { NextResponse } from "next/server";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { generateWithPromptTemplate } from "@/lib/ai";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "@/lib/brand-identity-utils";

const str = (v) => (typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : "");

// Ensures an array of non-empty strings without splitting individual entries
// (used for short-title lists like bestPostIdeas).
const toStringArray = (v) => {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
};

// Converts hashtags (array or whitespace/comma-separated string) into an array of tags.
const toHashtagArray = (v) => {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(/[\s,]+/).filter(Boolean);
  return [];
};

function createCompactToneInformationSummary(tone) {
  return [
    tone.brandName               && `Brand name: ${tone.brandName}`,
    tone.industry                && `Industry: ${tone.industry}`,
    tone.servicesOrProducts.length && `Services/products: ${tone.servicesOrProducts.join(", ")}`,
    tone.targetAudience          && `Target audience: ${tone.targetAudience}`,
    tone.locationOrMarket        && `Location/market: ${tone.locationOrMarket}`,
    tone.brandPersonality.length && `Brand personality: ${tone.brandPersonality.join(", ")}`,
    tone.toneOfVoice.length      && `Tone of voice: ${tone.toneOfVoice.join(", ")}`,
    tone.contentStyle            && `Content style: ${tone.contentStyle}`,
    tone.businessGoals.length    && `Business goals: ${tone.businessGoals.join(", ")}`,
    tone.keyMessages.length      && `Key messages: ${tone.keyMessages.join(", ")}`,
    tone.offers.length           && `Offers: ${tone.offers.join(", ")}`,
    tone.contentDoRules.length   && `Content do's: ${tone.contentDoRules.join("; ")}`,
    tone.contentDontRules.length && `Content don'ts: ${tone.contentDontRules.join("; ")}`,
  ].filter(Boolean).join("\n");
}

/**
 * Build a brand identity summary that balances visual identity and tone/brand data.
 */
function buildIdentitySummary(identity, brand) {
  if (!identity) {
    return [
      brand.name && `Brand: ${brand.name}`,
      brand.businessType && `Type: ${brand.businessType}`,
      brand.brandTone && `Tone: ${brand.brandTone}`,
      brand.brandVisualStyle && `Visual style: ${brand.brandVisualStyle}`,
      brand.targetAudience && `Audience: ${brand.targetAudience}`,
      brand.mainServicesOrProducts && `Services: ${brand.mainServicesOrProducts}`,
    ].filter(Boolean).join(". ");
  }

  const { brandVisualIdentity, brandToneInformationAndData } = normalizeBrandIdentityOutput(identity);
  const visualSummary = createCompactBrandVisualIdentitySummaryForImagePrompt(brandVisualIdentity);
  const toneSummary = createCompactToneInformationSummary(brandToneInformationAndData);

  return [
    "--- Visual Identity ---",
    visualSummary || "(not extracted)",
    "",
    "--- Tone & Brand Data ---",
    toneSummary || "(not extracted)",
  ].join("\n");
}

function normalisePost(p, idx, defaultPlatform) {
  return {
    postNumber: p.postNumber ?? p.post_number ?? p.number ?? idx + 1,
    platform:   str(p.platform  ?? defaultPlatform ?? ""),
    format:     str(p.format    ?? p.contentType ?? p.content_type ?? p.postFormat ?? p.post_format ?? ""),
    suggestedHook: str(
      p.suggestedHook ?? p.suggested_hook ??
      p.hook          ?? p.headline       ??
      p.title         ?? p.postTitle      ?? p.post_title ??
      p.idea          ?? p.subject        ?? p.topic      ?? ""
    ),
    mainAngleAndCoreMessage: str(
      p.mainAngleAndCoreMessage ?? p.main_angle_and_core_message ??
      p.coreMessage   ?? p.core_message   ??
      p.mainAngle     ?? p.main_angle     ??
      p.angle         ?? p.message        ??
      p.description   ?? p.content        ??
      p.body          ?? p.detail         ?? ""
    ),
    suggestedCaption: str(
      p.suggestedCaption ?? p.suggested_caption ??
      p.caption          ?? p.captionText       ??
      p.caption_text     ?? p.copy              ??
      p.text             ?? ""
    ),
    visualDirection: str(
      p.visualDirection ?? p.visual_direction ??
      p.visual          ?? p.visuals          ??
      p.imageDescription ?? p.image_description ?? ""
    ),
    contentStructure: str(p.contentStructure ?? p.content_structure ?? p.structure ?? ""),
    hashtags:         toHashtagArray(p.hashtags ?? p.tags),
    inspirationSource: str(p.inspirationSource ?? p.inspiration_source ?? p.inspiration ?? ""),
    contentOrigin:     str(p.contentOrigin    ?? p.content_origin    ?? "original"),
    referenceLink:     str(p.referenceLink    ?? p.reference_link    ?? ""),
  };
}

/**
 * Extract seasonal / important dates for the calendar period using a direct
 * OpenAI call. Returns an empty array on any failure so it never blocks the
 * main response.
 */
async function extractSeasonalDates({ period, location, businessType, apiKey }) {
  if (!period) return [];
  try {
    const openai = new OpenAI({ apiKey });
    const prompt = `You are a social media calendar strategist. Identify seasonal dates, holidays, awareness days, and local events for a ${businessType || "business"} in ${location || "an unspecified location"} during the period: "${period}".

Return a JSON object with a "dates" array. Each entry must have:
- "date": string (e.g. "June 21, 2026")
- "name": string (name of the day, holiday, or event)
- "relevance": "High" | "Medium" | "Low" (relevance to this specific business type)
- "contentAngle": one-sentence idea for turning this date into a branded social media post
- "suggestedPostType": "Reel" | "Carousel" | "Static" | "Story"

Include 5–15 dates total. Prioritise dates genuinely relevant to a ${businessType || "business"} and to ${location || "the region"}. Mix international observances with locally important dates. The array must cover the full calendar period.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const arr = parsed.dates ?? parsed.seasonal_dates ?? parsed.seasonalDates ??
      Object.values(parsed).find(v => Array.isArray(v)) ?? [];
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.warn("Seasonal dates extraction failed:", err.message);
    return [];
  }
}

export async function POST(request) {
  console.log("[SuggestPosts] POST /api/content-calendar/suggest-posts");

  try {
    // ── 1. Parse body ──────────────────────────────────────────────────────
    let body;
    try { body = await request.json(); }
    catch (e) {
      return NextResponse.json(
        { success: false, error: "Invalid request body.", details: e.message },
        { status: 400 }
      );
    }

    const {
      brandId, platform, monthlyObjective,
      calendarPeriod, calendarPeriodStart, calendarPeriodEnd,
      numberOfPosts,
      popularIndustryPosts, importantIndustryWebsites, competitorPages,
      campaignEvents, offers, seasonalDates: _ignored, contentLimitations, additionalNotes,
    } = body;

    console.log("[SuggestPosts] brandId:", brandId, "| posts:", numberOfPosts);

    if (!brandId) {
      return NextResponse.json(
        { success: false, error: "brandId is required." },
        { status: 400 }
      );
    }

    // ── 2. Load brand + identity + API key ────────────────────────────────
    const [brand, identity, apiKeySetting] = await Promise.all([
      prisma.brand.findUnique({ where: { id: brandId } }),
      prisma.brandIdentity.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
      prisma.settings.findUnique({ where: { key: "OPENAI_API_KEY" } }),
    ]);

    if (!brand) {
      return NextResponse.json(
        { success: false, error: "Brand not found." },
        { status: 404 }
      );
    }

    const apiKey = apiKeySetting?.value || process.env.OPENAI_API_KEY || "";
    const brandIdentitySummary = buildIdentitySummary(identity, brand);

    // ── 3. Derive post count and period ───────────────────────────────────
    const effectivePeriod = calendarPeriod ||
      (calendarPeriodStart && calendarPeriodEnd
        ? `${calendarPeriodStart} to ${calendarPeriodEnd}`
        : calendarPeriodStart || "");

    const requestedCount = parseInt(String(numberOfPosts ?? 12), 10);
    const safeCount = isNaN(requestedCount) || requestedCount < 1 ? 12 : requestedCount;

    // ── 4. Build variables + userInput ────────────────────────────────────
    const variables = {
      brandName:              brand.name,
      brandTone:              brand.brandTone              ?? "",
      targetAudience:         brand.targetAudience         ?? "",
      mainServicesOrProducts: brand.mainServicesOrProducts ?? "",
      brandVisualStyle:       brand.brandVisualStyle       ?? "",
      brandIdentitySummary,
      platform:               platform            ?? "Instagram",
      monthlyObjective:       monthlyObjective    ?? "",
      calendarPeriod:         effectivePeriod,
      numberOfPosts:          String(safeCount),
      popularIndustryPosts:   popularIndustryPosts   ?? "",
      importantIndustryWebsites: importantIndustryWebsites ?? "",
      competitorPages:        competitorPages     ?? "",
      campaignEvents:         campaignEvents      ?? "",
      offers:                 offers              ?? "",
      seasonalDates:          "",
      contentLimitations:     contentLimitations  ?? "",
      additionalNotes:        additionalNotes     ?? "",
    };

    const row = (label, value) => value ? `${label}: ${value}` : null;
    const userInput = [
      "=== BRAND INFORMATION ===",
      row("Brand Name",        brand.name),
      row("Business Type",     brand.businessType),
      row("Location",          brand.businessLocation),
      row("Tone",              brand.brandTone),
      row("Target Audience",   brand.targetAudience),
      row("Services/Products", brand.mainServicesOrProducts),
      row("Visual Style",      brand.brandVisualStyle),
      "",
      "=== BRAND IDENTITY SUMMARY ===",
      brandIdentitySummary || "Not yet extracted.",
      "",
      "=== CAMPAIGN DETAILS ===",
      row("Platform",                 platform),
      row("Monthly Objective",        monthlyObjective),
      row("Calendar Period",          effectivePeriod),
      row("Number of Post Ideas",     String(safeCount)),
      row("Offers / Promotions",      offers),
      row("Popular Industry Posts",   popularIndustryPosts),
      row("Key Industry Websites",    importantIndustryWebsites),
      row("Competitor Pages",         competitorPages),
      row("Campaign Events",          campaignEvents),
      row("Content Limitations",      contentLimitations),
      row("Additional Notes",         additionalNotes),
    ].filter(v => v !== null).join("\n");

    console.log("[SuggestPosts] userInput length:", userInput.length, "chars | safeCount:", safeCount);

    // ── 5. Run AI + seasonal dates in parallel ────────────────────────────
    const [suggestResult, seasonalDates] = await Promise.all([
      generateWithPromptTemplate({
        templateSlug: "post-suggestor",
        variables,
        userInput,
        // no maxTokens — let the model use its natural output limit for text tables
      }),
      extractSeasonalDates({
        period: effectivePeriod,
        location: brand.businessLocation ?? "",
        businessType: brand.businessType ?? brand.name,
        apiKey,
      }),
    ]);

    console.log("[SuggestPosts] Raw AI output length:", suggestResult.raw?.length ?? 0, "chars");

    // ── 6. Extract posts array ────────────────────────────────────────────
    let raw = [];
    const content = suggestResult.content;
    if (Array.isArray(content)) {
      raw = content;
    } else if (content && typeof content === "object") {
      const arrayValues = Object.values(content).filter(v => Array.isArray(v));
      raw = content.posts         ?? content.postIdeas      ?? content.post_ideas   ??
            content.suggestions   ?? content.ideas          ?? content.postSuggestions ??
            content.post_suggestions ?? content.results     ?? arrayValues[0]       ?? [];
    }
    if (!Array.isArray(raw)) raw = [];

    let posts = raw.map((p, i) => normalisePost(p, i, platform));
    if (posts.length > safeCount) posts = posts.slice(0, safeCount);

    // ── 7. Extract calendar-level strategy fields ─────────────────────────
    const isContentObject = content && typeof content === "object" && !Array.isArray(content);
    const strategicSummary      = isContentObject ? str(content.strategicSummary ?? content.strategic_summary ?? "") : "";
    const recommendedContentMix = isContentObject ? str(content.recommendedContentMix ?? content.recommended_content_mix ?? "") : "";
    const contentGaps           = isContentObject ? str(content.contentGaps ?? content.content_gaps ?? "") : "";
    const competitorPatterns    = isContentObject
      ? str(content.competitorPatterns ?? content.competitorInspiredPatterns ?? content.competitor_patterns ?? "")
      : "";
    const bestPostIdeas = isContentObject
      ? toStringArray(content.bestPostIdeas ?? content.best_post_ideas)
      : [];

    console.log("[SuggestPosts] Parsed posts:", posts.length, "| seasonal dates:", seasonalDates.length);

    return NextResponse.json({
      success: true,
      posts,
      seasonalDates,
      strategicSummary,
      recommendedContentMix,
      contentGaps,
      competitorPatterns,
      bestPostIdeas,
      requestedCount: safeCount,
      returnedCount:  posts.length,
      usage:          suggestResult.usage,
      model:          suggestResult.model,
    });

  } catch (err) {
    console.error("[SuggestPosts] Unhandled error:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Post idea generation failed. Please check your inputs and try again.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
