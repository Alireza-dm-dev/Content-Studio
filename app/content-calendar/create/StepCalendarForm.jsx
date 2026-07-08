"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, ArrowLeft, ChevronDown, ChevronUp, Check } from "lucide-react";
import { toast } from "sonner";

const PLATFORMS = ["Instagram", "TikTok", "LinkedIn", "Facebook", "YouTube", "Pinterest", "Twitter/X"];
const FORMATS = ["Carousel", "Reel", "Static", "Story", "Live", "YouTube Video", "Short"];

// ─── Suggestion sets ───────────────────────────────────────────────────────────

const MONTHLY_SUBJECT_SUGGESTIONS = [
  "Brand identity & visual storytelling",
  "New service / product launch",
  "Customer success stories",
  "Educational tips series",
  "Behind the scenes",
  "Community & engagement month",
  "Seasonal campaign",
  "Offer & promotion",
  "Thought leadership",
  "Local community spotlight",
];

const MAIN_GOAL_SUGGESTIONS = [
  "Build brand awareness",
  "Generate leads & inquiries",
  "Drive bookings / consultations",
  "Boost engagement & community",
  "Educate the audience",
  "Build trust & credibility",
  "Promote new service / product",
  "Drive website traffic",
  "Increase sales / conversions",
  "Grow followers",
];

const OFFER_SUGGESTIONS = [
  "Free consultation",
  "Free first session",
  "10% off this month",
  "Limited-time bundle offer",
  "Referral bonus program",
  "Free audit / assessment",
  "New service launch",
  "Seasonal promotion",
  "Book now & save",
];

const VIDEO_TOOL_SUGGESTIONS = [
  "Canva",
  "CapCut",
  "Adobe Premiere Rush",
  "InShot",
  "iMovie",
  "DaVinci Resolve",
  "TikTok editor",
  "Instagram editor",
  "Filmora",
];

const VIDEO_LIMITS_SUGGESTIONS = [
  "Phone camera only",
  "No professional equipment",
  "Indoor filming only",
  "No voiceover / narration",
  "Maximum 60 seconds",
  "No paid actors",
  "Self-filming only",
  "No green screen or studio",
];

const CONTENT_STRATEGY_SUGGESTIONS = [
  "Every 3rd post educational",
  "No hard selling",
  "Max 2 promotional posts per week",
  "Always include a CTA",
  "Mix formats: Reel + Carousel + Static",
  "Repurpose content across platforms",
  "Lead with value, then promote",
  "One behind-the-scenes per month",
  "Pin best-performing post each week",
];

const AUDIENCE_LANGUAGE_SUGGESTIONS = [
  "English only",
  "Casual, conversational tone",
  "Avoid industry jargon",
  "Use simple, everyday language",
  "Professional but approachable",
  "Use 'you' to speak directly to audience",
  "No slang or informal abbreviations",
  "Inclusive, gender-neutral language",
];

const WRITING_STYLE_SUGGESTIONS = [
  "Short sentences, max 2 lines",
  "End with a question for engagement",
  "Use emojis sparingly",
  "Max 3–5 hashtags",
  "Always start with a strong hook",
  "Use bullet points for lists",
  "Call out the audience in the first line",
  "Keep captions under 150 words",
];

// ─── Generic field (no suggestions) ───────────────────────────────────────────

function Field({ id, label, hint, value, onChange, rows, type = "text", placeholder = "" }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {hint && <span className="text-muted-foreground font-normal ml-1 text-xs">— {hint}</span>}
      </Label>
      {rows ? (
        <Textarea id={id} value={value} onChange={e => onChange(e.target.value)} rows={rows}
          className="resize-none" placeholder={placeholder} />
      ) : (
        <Input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );
}

// ─── Field with multi-select suggestion chips ──────────────────────────────────
// - autoComplete="off" prevents browser autocomplete dropdown
// - Clicking a chip picks it (chip moves to selected badges, disappears from available)
// - Clicking ✕ on a badge unpicks it (chip returns to available list)
// - append=true  → picked chips joined with newline  (textarea fields)
// - append=false → picked chips joined with ", "     (single-line fields)

function SuggestField({ id, label, hint, value, onChange, suggestions, rows, placeholder = "", append = false }) {
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState([]);

  const separator = append ? "\n" : ", ";
  const available = suggestions.filter(s => !picked.includes(s));

  function selectChip(s) {
    const next = [...picked, s];
    setPicked(next);
    onChange(next.join(separator));
  }

  function removeChip(s) {
    const next = picked.filter(c => c !== s);
    setPicked(next);
    onChange(next.join(separator));
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {hint && <span className="text-muted-foreground font-normal ml-1 text-xs">— {hint}</span>}
      </Label>

      {/* Selected chips (always visible when any are picked) */}
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map(s => (
            <span key={s} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-primary text-primary-foreground">
              {s}
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => removeChip(s)}
                className="ml-0.5 hover:opacity-70 leading-none"
                aria-label={`Remove ${s}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {rows ? (
        <Textarea
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={rows}
          className="resize-none"
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
      ) : (
        <Input
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
      )}

      {/* Available chips (shown on focus, excludes already-picked ones) */}
      {focused && available.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {available.map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => selectChip(s)}
              className="text-xs px-2.5 py-1 rounded-full border border-border bg-muted/60 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function StepCalendarForm({
  brand, brandIdentity, selectedPosts,
  prefillCampaignEvents = "", prefillMonthlySubject = "",
  calendarPeriod = "", calendarPeriodStart = "", calendarPeriodEnd = "", chosenSeasonalDates = [],
  form, setForm, onBack, onGenerated,
}) {
  const [generating, setGenerating] = useState(false);
  const [showAutoFilled, setShowAutoFilled] = useState(false);
  const [showRules, setShowRules] = useState(false);

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  // Default Monthly Subject from Step 1's monthlyObjective, without overwriting a manual edit.
  useEffect(() => {
    if (!prefillMonthlySubject) return;
    setForm(prev => prev.mainMonthlySubject ? prev : { ...prev, mainMonthlySubject: prefillMonthlySubject });
  }, [prefillMonthlySubject, setForm]);

  // Default Priority Content Ideas from the seasonal dates chosen in Step 2, without overwriting a manual edit.
  useEffect(() => {
    if (!prefillCampaignEvents) return;
    setForm(prev => prev.priorityContentIdeas ? prev : { ...prev, priorityContentIdeas: prefillCampaignEvents });
  }, [prefillCampaignEvents, setForm]);

  function togglePlatform(p) {
    const current = form.platforms.split(",").map(s => s.trim()).filter(Boolean);
    const has = current.includes(p);
    const next = has ? current.filter(x => x !== p) : [...current, p];
    set("platforms", next.join(", "));
  }

  function toggleFormat(f) {
    const current = form.requiredPostFormats.split(",").map(s => s.trim()).filter(Boolean);
    const has = current.includes(f);
    const next = has ? current.filter(x => x !== f) : [...current, f];
    set("requiredPostFormats", next.join(", "));
  }

  const activePlatforms = form.platforms.split(",").map(s => s.trim()).filter(Boolean);
  const activeFormats = form.requiredPostFormats.split(",").map(s => s.trim()).filter(Boolean);

  async function safeParseJsonResponse(response) {
    const text = await response.text();
    if (!text || !text.trim()) {
      throw new Error(`Empty response from server (status ${response.status}). Please try again.`);
    }
    try {
      return JSON.parse(text);
    } catch {
      console.error("[CalendarForm] Server returned non-JSON:", text.slice(0, 300));
      throw new Error("Server returned an unexpected response. Check the browser console for details.");
    }
  }

  async function handleGenerate() {
    if (!form.mainMonthlySubject.trim() && !form.mainGoal.trim()) {
      return toast.error("Fill in at least Monthly Subject or Main Goal.");
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/content-calendar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: brand.id,
          selectedPosts,
          ...form,
          calendarPeriod,
          calendarPeriodStart,
          calendarPeriodEnd,
          chosenSeasonalDates,
        }),
      });

      const data = await safeParseJsonResponse(res);

      if (!res.ok || data.success === false) {
        const msg = data.error ?? "Generation failed.";
        if (data.details) console.error("[CalendarForm] Server error details:", data.details);
        throw new Error(msg);
      }

      const posts = data.posts ?? [];
      if (posts.length === 0) {
        console.warn("[CalendarForm] 0 posts returned. Raw AI output:", data.raw);
      }

      onGenerated({
        posts,
        tables: data.tables ?? null,
        raw: data.raw ?? "",
        usage: data.usage,
        model: data.model,
        formData: form,
      });
    } catch (err) {
      console.error("[CalendarForm] Generation error:", err);
      toast.error(
        err.message.includes("Unexpected") || err.message.includes("JSON")
          ? "Content calendar generation failed. Please try again or reduce the number of posts."
          : err.message
      );
    } finally {
      setGenerating(false);
    }
  }

  const identitySummary = brandIdentity?.editableSummary ??
    (brandIdentity?.jsonOutput ? "(Brand identity JSON available)" : null);

  return (
    <div className="space-y-5 max-w-2xl">
      {/* ─── Auto-filled context ────────────────────────────────── */}
      <div className="rounded-lg border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAutoFilled(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-500 shrink-0" />
            <span className="text-sm font-medium">Auto-filled from brand</span>
            <span className="text-xs text-muted-foreground">
              — {brand.name}{brandIdentity ? " + identity" : ""}
              {selectedPosts.length > 0 ? ` + ${selectedPosts.length} post ideas` : ""}
            </span>
          </div>
          {showAutoFilled
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showAutoFilled && (
          <div className="px-4 py-3 border-t border-border space-y-2 bg-muted/10">
            {[
              { label: "Brand Name", value: brand.name },
              { label: "Brand Tone", value: brand.brandTone },
              { label: "Target Audience", value: brand.targetAudience },
              { label: "Services / Products", value: brand.mainServicesOrProducts },
              { label: "Visual Style", value: brand.brandVisualStyle },
              { label: "Brand Identity", value: identitySummary ? "✓ Available" : "Not extracted" },
              { label: "Selected Post Ideas", value: selectedPosts.length > 0 ? `${selectedPosts.length} ideas selected` : "None" },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-start gap-3 min-w-0">
                <span className="text-xs text-muted-foreground shrink-0 w-36">{label}</span>
                <span className="text-xs text-foreground/70 truncate">{value || <span className="italic text-muted-foreground/50">Not set</span>}</span>
              </div>
            ))}
            {selectedPosts.length > 0 && (
              <details className="mt-1">
                <summary className="text-xs text-primary cursor-pointer hover:underline">View selected ideas</summary>
                <div className="mt-2 space-y-1">
                  {selectedPosts.map((p, i) => (
                    <p key={i} className="text-xs text-muted-foreground pl-2 border-l border-border">
                      {i + 1}. {p.suggestedHook || p.mainAngleAndCoreMessage || `Post ${p.postNumber ?? i + 1}`}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      {/* ─── Content Strategy ───────────────────────────────────── */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Content Strategy</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SuggestField
            id="mainMonthlySubject"
            label="Monthly Subject"
            hint="main theme for the month"
            value={form.mainMonthlySubject}
            onChange={v => set("mainMonthlySubject", v)}
            suggestions={MONTHLY_SUBJECT_SUGGESTIONS}
            placeholder="e.g. Brand identity and visual storytelling"
          />
          <SuggestField
            id="mainGoal"
            label="Main Goal"
            value={form.mainGoal}
            onChange={v => set("mainGoal", v)}
            suggestions={MAIN_GOAL_SUGGESTIONS}
            placeholder="e.g. Build trust, drive consultations"
          />
          <SuggestField
            id="mainOfferOrMessage"
            label="Offer / Key Message"
            value={form.mainOfferOrMessage}
            onChange={v => set("mainOfferOrMessage", v)}
            suggestions={OFFER_SUGGESTIONS}
            placeholder="e.g. Free brand audit in June"
          />
          <Field
            id="mainLandingPageOrServicePage"
            label="Landing / Service Page URL"
            value={form.mainLandingPageOrServicePage}
            onChange={v => set("mainLandingPageOrServicePage", v)}
            placeholder="https://..."
          />
        </div>
        <Field id="importantDetailsToInclude" label="Important Details to Include" rows={2}
          hint="facts, achievements, client results to mention"
          value={form.importantDetailsToInclude} onChange={v => set("importantDetailsToInclude", v)}
          placeholder="We've worked with 200+ small businesses…" />
        <Field id="detailsNotToInvent" label="Details NOT to Invent" rows={2}
          hint="things the AI should not make up or exaggerate"
          value={form.detailsNotToInvent} onChange={v => set("detailsNotToInvent", v)}
          placeholder="Do not invent statistics. Do not claim medical expertise…" />
        <Field id="sourceMaterial" label="Source Material" rows={2}
          hint="blog posts, case studies, videos the AI can reference"
          value={form.sourceMaterial} onChange={v => set("sourceMaterial", v)}
          placeholder="Blog: '3 signs your brand needs a refresh'. Case study: Fitness studio rebrand…" />
        <Field id="priorityContentIdeas" label="Priority Content Ideas" rows={2}
          hint="specific ideas or topics that must be included"
          value={form.priorityContentIdeas} onChange={v => set("priorityContentIdeas", v)}
          placeholder="Client transformation story, myth-busting post, team behind-the-scenes…" />
      </div>

      {/* ─── Posting Schedule ───────────────────────────────────── */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Posting Schedule</p>
        <div className="space-y-1.5">
          <Label>Platforms</Label>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map(p => (
              <Badge key={p} variant={activePlatforms.includes(p) ? "default" : "outline"}
                className="cursor-pointer" onClick={() => togglePlatform(p)}>{p}</Badge>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field id="numberOfPostsNeeded" label="Number of Posts Needed" type="number"
            hint="for the full calendar (independent of post ideas)"
            value={form.numberOfPostsNeeded} onChange={v => set("numberOfPostsNeeded", v)} />
          <Field id="publishingFrequency" label="Publishing Frequency"
            hint="e.g. 3x/week Mon-Wed-Fri"
            value={form.publishingFrequency} onChange={v => set("publishingFrequency", v)}
            placeholder="3 posts per week — Mon, Wed, Fri" />
        </div>
        <div className="space-y-1.5">
          <Label>Required Post Formats</Label>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map(f => (
              <Badge key={f} variant={activeFormats.includes(f) ? "default" : "outline"}
                className="cursor-pointer" onClick={() => toggleFormat(f)}>{f}</Badge>
            ))}
          </div>
          <Input value={form.requiredPostFormats} onChange={e => set("requiredPostFormats", e.target.value)}
            placeholder="Or type format mix: 4 Carousels, 4 Reels, 3 Static…" className="text-xs mt-1" />
        </div>
      </div>

      {/* ─── Rules (collapsible) ────────────────────────────────── */}
      <div className="rounded-lg border border-border overflow-hidden">
        <button type="button" onClick={() => setShowRules(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/60 transition-colors">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Content Rules &amp; Restrictions
          </p>
          {showRules ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showRules && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SuggestField
                id="videoCreationTool"
                label="Video Creation Tool"
                hint="e.g. Canva, CapCut"
                value={form.videoCreationTool}
                onChange={v => set("videoCreationTool", v)}
                suggestions={VIDEO_TOOL_SUGGESTIONS}
              />
              <SuggestField
                id="videoProductionLimitation"
                label="Video Production Limits"
                hint="e.g. phone only, no professional camera"
                value={form.videoProductionLimitation}
                onChange={v => set("videoProductionLimitation", v)}
                suggestions={VIDEO_LIMITS_SUGGESTIONS}
              />
            </div>
            <SuggestField
              id="contentStrategyRules"
              label="Content Strategy Rules"
              hint="e.g. every 3rd post educational, no hard selling"
              value={form.contentStrategyRules}
              onChange={v => set("contentStrategyRules", v)}
              suggestions={CONTENT_STRATEGY_SUGGESTIONS}
              rows={2}
              append
            />
            <SuggestField
              id="audienceLanguageRules"
              label="Audience Language Rules"
              hint="e.g. English only, casual tone, avoid jargon"
              value={form.audienceLanguageRules}
              onChange={v => set("audienceLanguageRules", v)}
              suggestions={AUDIENCE_LANGUAGE_SUGGESTIONS}
              rows={2}
              append
            />
            <SuggestField
              id="writingStyleRules"
              label="Writing Style Rules"
              hint="e.g. short sentences, max 3 hashtags, end with a question"
              value={form.writingStyleRules}
              onChange={v => set("writingStyleRules", v)}
              suggestions={WRITING_STYLE_SUGGESTIONS}
              rows={2}
              append
            />
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1.5" />Back
        </Button>
        <Button onClick={handleGenerate} disabled={generating} className="gap-2 flex-1 sm:flex-none">
          {generating
            ? <><Loader2 className="w-4 h-4 animate-spin" />Generating Calendar…</>
            : <><Sparkles className="w-4 h-4" />Generate Content Calendar</>}
        </Button>
      </div>
    </div>
  );
}
