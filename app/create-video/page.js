"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "sonner";
import {
  ArrowLeft, Briefcase, Sparkles, Loader2,
  Copy, Check, Video, Lightbulb, AlertCircle,
} from "lucide-react";
import { CINEMATIC_STYLE_OPTIONS } from "@/lib/cinematic-styles";

// ── Constants ─────────────────────────────────────────────────────────────────

const VIDEO_CREATOR_MODELS = ["Higgsfield", "Runway", "Pika", "Kling", "Veo", "Sora", "Other"];
const DURATIONS = ["5 seconds", "10 seconds", "15 seconds", "20 seconds", "30 seconds", "45 seconds", "60 seconds"];
const ASPECT_RATIOS = ["9:16", "1:1", "4:5", "16:9", "3:4"];
const VIDEO_TYPES = [
  "Reel", "TikTok", "YouTube Shorts", "Product video", "Brand video",
  "Educational video", "Ad creative", "Story video", "Cinematic scene", "Other",
];
const PLATFORMS = ["Instagram", "TikTok", "YouTube", "LinkedIn", "Facebook", "Website", "Other"];
const VIDEO_FORMATS = [
  "Reel", "TikTok video", "YouTube Shorts", "Story", "Ad creative",
  "Explainer video", "Product video", "Brand awareness video",
  "Educational video", "Testimonial style video", "Other",
];
const VIDEO_GOALS = [
  "Awareness", "Lead generation", "Engagement", "Trust building",
  "Education", "Conversion", "Service explanation", "Product explanation",
  "Promotion", "Retargeting", "Other",
];

// ── Cinematic control options (Raw Idea view) ───────────────────────────────────

const SPEED_RAMP_OPTIONS = [
  "Auto", "Slow-mo", "Ramp Up", "Flash In", "Flash Out", "Bullet Time", "Hero Moment", "Custom",
];
const CAMERA_MOVEMENT_OPTIONS = [
  "Auto", "Static", "Handheld", "Zoom Out", "Zoom in", "Camera follows",
  "Pan left", "Pan right", "Tilt up", "Tilt down", "Orbit around",
  "Dolly in", "Dolly out", "Jib up", "Jib down", "Drone shot",
  "Dolly left", "Dolly right", "360 roll", "Custom",
];
const CAMERA_OPTIONS = ["Auto", "Raw 16 mm", "Fine film", "Clean Digital"];
const LENS_OPTIONS = ["Auto", "extreme macro", "anamorphic", "warm halation", "vintage haze"];
const FOCAL_LENGTH_OPTIONS = ["45", "75", "50", "35", "14", "8"];
const APERTURE_OPTIONS = ["f/11 deep focus", "f/1.4 wide open", "f/4 moderate"];

// ── Cinematic presets (Raw Idea view) ────────────────────────────────────────
// Each preset maps to the six existing cinematic control values above — no new
// option values are introduced, only combinations of the ones already in the
// arrays above. Selecting "manual" (the default) leaves the controls untouched.
const CINEMATIC_PRESETS = [
  {
    key: "manual",
    label: "Custom / Manual",
    description: "Keep your own manual selections below — no preset applied.",
    values: null,
  },
  {
    key: "70s-hollywood",
    label: "70s Hollywood",
    description: "Classic 1970s Hollywood film look — grainy, warm, dramatic, cinematic.",
    values: { camera: "Fine film", lens: "vintage haze", cameraMovement: "Dolly in", speedRamp: "Auto", focalLength: "45", aperture: "f/1.4 wide open" },
  },
  {
    key: "commercial-reel-iphone17",
    label: "Commercial Reel for Brands — iPhone 17",
    description: "Clean modern vertical commercial reel style, as if captured on a premium iPhone 17 for a brand campaign.",
    values: { camera: "Clean Digital", lens: "anamorphic", cameraMovement: "Dolly in", speedRamp: "Auto", focalLength: "35", aperture: "f/4 moderate" },
  },
  {
    key: "ugc-iphone",
    label: "UGC Video — iPhone",
    description: "Natural creator-style user-generated content, handheld, casual, authentic, as if captured on iPhone.",
    values: { camera: "Clean Digital", lens: "Auto", cameraMovement: "Handheld", speedRamp: "Auto", focalLength: "35", aperture: "f/4 moderate" },
  },
  {
    key: "modern-commercial",
    label: "Modern Commercial",
    description: "Polished, premium commercial advertising look with a smooth forward push.",
    values: { camera: "Clean Digital", lens: "anamorphic", cameraMovement: "Dolly in", speedRamp: "Auto", focalLength: "50", aperture: "f/4 moderate" },
  },
  {
    key: "documentary-realism",
    label: "Documentary Realism",
    description: "Raw, handheld, real-life documentary feel.",
    values: { camera: "Raw 16 mm", lens: "warm halation", cameraMovement: "Handheld", speedRamp: "Auto", focalLength: "35", aperture: "f/4 moderate" },
  },
  {
    key: "dreamy-music-video",
    label: "Dreamy Music Video",
    description: "Slow, glowing, emotional music-video atmosphere with orbiting camera work.",
    values: { camera: "Fine film", lens: "warm halation", cameraMovement: "Orbit around", speedRamp: "Slow-mo", focalLength: "75", aperture: "f/1.4 wide open" },
  },
  {
    key: "luxury-product-film",
    label: "Luxury Product Film",
    description: "Premium, macro-detail product beauty shot with shallow depth of field.",
    values: { camera: "Clean Digital", lens: "extreme macro", cameraMovement: "Dolly in", speedRamp: "Slow-mo", focalLength: "75", aperture: "f/1.4 wide open" },
  },
  {
    key: "cinematic-social-reel",
    label: "Cinematic Social Reel",
    description: "Film-look social reel with a warm glow and a smooth forward push.",
    values: { camera: "Fine film", lens: "warm halation", cameraMovement: "Dolly in", speedRamp: "Auto", focalLength: "45", aperture: "f/4 moderate" },
  },
  {
    key: "fast-action-promo",
    label: "Fast Action Promo",
    description: "High-energy, fast-paced promo footage that follows the action.",
    values: { camera: "Clean Digital", lens: "Auto", cameraMovement: "Camera follows", speedRamp: "Ramp Up", focalLength: "35", aperture: "f/4 moderate" },
  },
  {
    key: "vintage-travel-film",
    label: "Vintage Travel Film",
    description: "Nostalgic, retro travel-film look with a gentle panning move.",
    values: { camera: "Raw 16 mm", lens: "vintage haze", cameraMovement: "Pan left", speedRamp: "Auto", focalLength: "45", aperture: "f/11 deep focus" },
  },
];

// ── Shared select style ───────────────────────────────────────────────────────

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm " +
  "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const INPUT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

// ── Safe JSON response parser ─────────────────────────────────────────────────

async function safeParseJsonResponse(response) {
  const text = await response.text();
  if (!text || !text.trim()) throw new Error(`Empty response from server. Status: ${response.status}`);
  try { return JSON.parse(text); }
  catch {
    throw new Error("Server returned invalid JSON. Check API logs.");
  }
}

// ── Extract a human-readable message from an API error response ──────────────

function getServerErrorMessage(data) {
  if (typeof data?.error === "string" && data.error.trim()) return data.error.trim();
  if (typeof data?.message === "string" && data.message.trim()) return data.message.trim();
  if (typeof data?.details === "string" && data.details.trim()) return data.details.trim();
  return null;
}

// ── Output section (shared between both modes) ───────────────────────────────

function OutputSection({ output, setOutput, model, savedId, mode }) {
  const [copied, setCopied] = useState(false);

  // ── Request changes (revise final prompt) ─────────────────────────────────
  const [feedback, setFeedback]     = useState("");
  const [revising, setRevising]     = useState(false);
  const [reviseError, setReviseError] = useState(null);

  async function handleCopy() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    toast.success("Prompt copied.");
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRevise() {
    if (!savedId || !feedback.trim() || revising) return;
    setRevising(true);
    setReviseError(null);
    try {
      const res = await fetch(`/api/prompts/${savedId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: feedback.trim() }),
      });
      const data = await safeParseJsonResponse(res);

      if (!data.success) {
        setReviseError(data.error ?? "Revision failed.");
        toast.error(data.error ?? "Revision failed.");
        return;
      }

      setOutput(data.generatedPrompt.finalPrompt ?? output);
      setFeedback("");
    } catch (err) {
      setReviseError(err.message || "Revision failed. Please try again.");
      toast.error(err.message || "Revision failed.");
    } finally {
      setRevising(false);
    }
  }

  const reviseDisabled = !savedId || !feedback.trim() || revising;

  return (
    <>
      <Separator />
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold">
            {mode === "brand_based" ? "Generated Brand Based Video Prompt" : "Generated Video Prompt"}
          </h2>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{model}</Badge>
            {savedId && (
              <span className="text-xs text-muted-foreground">
                Saved to{" "}
                <Link href="/generated-prompts" className="underline hover:text-foreground">
                  Generated Prompts
                </Link>
              </span>
            )}
          </div>
        </div>

        <Textarea
          value={output}
          onChange={e => setOutput(e.target.value)}
          rows={12}
          className="font-mono text-xs resize-y"
        />

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
            {copied
              ? <><Check className="w-3.5 h-3.5" />Copied!</>
              : <><Copy className="w-3.5 h-3.5" />Copy Prompt</>}
          </Button>
        </div>

        {/* ── Request changes ── */}
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <Label htmlFor={`feedback-${mode}`} className="text-xs font-medium">
            Request changes
          </Label>
          <Textarea
            id={`feedback-${mode}`}
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Describe what to change, e.g. make the tone more playful, shorten the intro shot…"
            rows={3}
            disabled={revising}
            className="text-xs"
          />
          {reviseError && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />{reviseError}
            </div>
          )}
          <Button size="sm" onClick={handleRevise} disabled={reviseDisabled} className="gap-1.5">
            {revising
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Revising…</>
              : "Revise prompt"}
          </Button>
        </div>
      </div>
    </>
  );
}

// ── Hub view ──────────────────────────────────────────────────────────────────

function HubView({ onSelectMode }) {
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        eyebrow="Video prompts"
        title="Create Video"
        description="Choose how you want to create your video prompt."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Option 1: Brand-based */}
        <button
          type="button"
          onClick={() => onSelectMode("brand-based")}
          className="sketch-card text-left transition-colors hover:border-foreground hover:bg-muted/40 p-5 space-y-3"
        >
          <div className="sketch-frame icon-sketch flex size-11 items-center justify-center bg-card text-foreground">
            <Briefcase className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Create video based on brand</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use brand identity and your idea to create a video prompt.
            </p>
          </div>
        </button>

        {/* Option 2: Raw idea */}
        <button
          type="button"
          onClick={() => onSelectMode("raw-idea")}
          className="sketch-card text-left transition-colors hover:border-foreground hover:bg-muted/40 p-5 space-y-3"
        >
          <div className="sketch-frame icon-sketch flex size-11 items-center justify-center bg-card text-foreground">
            <Lightbulb className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Create video just based on raw idea</p>
            <p className="text-xs text-muted-foreground mt-1">
              Turn a simple video idea into a structured prompt for Higgsfield, Runway, Pika, Kling, Veo, Sora, or another video tool.
            </p>
          </div>
        </button>
      </div>
    </PageContainer>
  );
}

// ── Brand-based view ─────────────────────────────────────────────────────────

function BrandBasedView({ onBack }) {
  // Brand state
  const [brands, setBrands]               = useState([]);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [brandIdentity, setBrandIdentity] = useState(null);
  const [checkingIdentity, setCheckingIdentity] = useState(false);

  // Form fields
  const [rawVideoIdea, setRawVideoIdea]       = useState("");
  const [platform, setPlatform]               = useState("Instagram");
  const [customPlatform, setCustomPlatform]   = useState("");
  const [videoFormat, setVideoFormat]         = useState("Reel");
  const [customVideoFormat, setCustomFormat]  = useState("");
  const [videoGoal, setVideoGoal]             = useState("Awareness");
  const [customGoal, setCustomGoal]           = useState("");
  const [model, setModel]                     = useState("Higgsfield");
  const [customModel, setCustomModel]         = useState("");
  const [duration, setDuration]               = useState("15 seconds");
  const [aspectRatio, setAspectRatio]         = useState("9:16");

  // Cinematic controls
  const [speedRamp, setSpeedRamp]                       = useState("Auto");
  const [customSpeedRamp, setCustomSpeedRamp]           = useState("");
  const [cameraMovement, setCameraMovement]             = useState("Auto");
  const [customCameraMovement, setCustomCameraMovement] = useState("");
  const [camera, setCamera]                             = useState("Auto");
  const [lens, setLens]                                 = useState("Auto");
  const [focalLength, setFocalLength]                   = useState("50");
  const [aperture, setAperture]                         = useState("f/4 moderate");
  const [cinematicPreset, setCinematicPreset]           = useState("manual");
  const [cinematicStyle, setCinematicStyle]             = useState("auto");

  // Generation
  const [generating, setGenerating] = useState(false);
  const [output, setOutput]         = useState("");
  const [savedId, setSavedId]       = useState(null);

  const resolvedPlatform = platform === "Other"    ? customPlatform.trim()  : platform;
  const resolvedFormat   = videoFormat === "Other" ? customVideoFormat.trim(): videoFormat;
  const resolvedGoal     = videoGoal === "Other"   ? customGoal.trim()      : videoGoal;
  const resolvedModel    = model === "Other"       ? customModel.trim()     : model;
  const resolvedSpeedRamp      = speedRamp === "Custom" ? customSpeedRamp.trim() : speedRamp;
  const resolvedCameraMovement = cameraMovement === "Custom" ? customCameraMovement.trim() : cameraMovement;

  // Applying a preset sets all six cinematic controls together
  function applyCinematicPreset(key) {
    setCinematicPreset(key);
    const preset = CINEMATIC_PRESETS.find(p => p.key === key);
    if (!preset?.values) return;
    setCamera(preset.values.camera);
    setLens(preset.values.lens);
    setCameraMovement(preset.values.cameraMovement);
    setSpeedRamp(preset.values.speedRamp);
    setFocalLength(preset.values.focalLength);
    setAperture(preset.values.aperture);
  }

  // Load all brands
  useEffect(() => {
    fetch("/api/brands")
      .then(r => r.json())
      .then(data => setBrands(Array.isArray(data) ? data : []))
      .catch(() => toast.error("Failed to load brands."))
      .finally(() => setLoadingBrands(false));
  }, []);

  async function selectBrand(brand) {
    setSelectedBrand(brand);
    setBrandIdentity(null);
    setOutput("");
    setSavedId(null);
    setCheckingIdentity(true);
    try {
      const res  = await fetch(`/api/brands/${brand.id}/identity`);
      const data = await res.json();
      setBrandIdentity(Array.isArray(data) ? (data[0] ?? null) : null);
    } catch {
      toast.error("Failed to check brand identity.");
    } finally {
      setCheckingIdentity(false);
    }
  }

  async function handleGenerate() {
    if (!selectedBrand)               { toast.error("Please select a brand."); return; }
    if (!brandIdentity)               { toast.error("Please create brand identity first."); return; }
    if (!rawVideoIdea.trim())         { toast.error("Please enter a raw video idea."); return; }
    if (platform === "Other" && !customPlatform.trim())    { toast.error("Please enter a custom platform."); return; }
    if (videoFormat === "Other" && !customVideoFormat.trim()) { toast.error("Please enter a custom video format."); return; }
    if (videoGoal === "Other" && !customGoal.trim())       { toast.error("Please enter a custom video goal."); return; }
    if (model === "Other" && !customModel.trim())          { toast.error("Please enter a custom model name."); return; }
    if (speedRamp === "Custom" && !customSpeedRamp.trim())             { toast.error("Please enter a custom speed ramp value."); return; }
    if (cameraMovement === "Custom" && !customCameraMovement.trim())   { toast.error("Please enter a custom camera movement value."); return; }

    setGenerating(true);
    setOutput("");
    setSavedId(null);

    try {
      const res = await fetch("/api/video/brand-based/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId:                selectedBrand.id,
          rawVideoIdea:           rawVideoIdea.trim(),
          platform:               resolvedPlatform,
          videoFormat:            resolvedFormat,
          videoGoal:              resolvedGoal,
          targetVideoCreatorModel: resolvedModel,
          duration,
          aspectRatio,
          speedRamp:              resolvedSpeedRamp,
          cameraMovement:         resolvedCameraMovement,
          camera,
          lens,
          focalLength,
          aperture,
          cinematicStyle,
        }),
      });

      const data = await safeParseJsonResponse(res);

      if (!data.success) {
        const msg = getServerErrorMessage(data);
        if (res.status >= 500) {
          console.error("[BrandBasedView] Server error:", msg ?? "Unknown server error");
        }
        toast.error(msg ?? "Brand based video prompt generation failed. Please check your inputs and try again.");
        return;
      }

      setOutput(data.generatedPrompt.finalPrompt ?? "");
      setSavedId(data.generatedPrompt.id);
      toast.success("Brand based video prompt generated.");
    } catch (err) {
      const errMsg = err.message || "";
      if (errMsg.includes("Empty response") || errMsg.includes("invalid JSON")) {
        toast.error("Video prompt generation failed. The server returned an invalid response.");
      } else if (/fetch|Failed to fetch|NetworkError|network|connect/i.test(errMsg)) {
        toast.error("Could not reach the server. Check that the app is running and retry.");
      } else {
        console.error("[BrandBasedView] error:", err);
        toast.error("Brand based video prompt generation failed. Please check your inputs and try again.");
      }
    } finally {
      setGenerating(false);
    }
  }

  const identityReady = brandIdentity !== null;
  const showForm = selectedBrand && identityReady;

  return (
    <div className="p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Create Brand Based Video Prompt</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Brand identity will be combined with your idea to create a production-ready video prompt.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* ── Brand selector ────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Step 1 — Choose Brand</p>
          {loadingBrands ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />Loading brands…
            </p>
          ) : brands.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No brands found.{" "}
              <Link href="/brands/new" className="underline hover:text-foreground">Create a brand</Link> first.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {brands.map(b => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => selectBrand(b)}
                  className={`text-left rounded-lg border px-4 py-3 transition-colors ${
                    selectedBrand?.id === b.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{b.name}</p>
                      {b.businessType && <p className="text-xs text-muted-foreground truncate">{b.businessType}</p>}
                    </div>
                    {selectedBrand?.id === b.id && <Check className="w-4 h-4 text-primary shrink-0 ml-2" />}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Brand identity status ─────────────────────────────────────────── */}
        {selectedBrand && (
          <div className={`rounded-lg border px-4 py-3 flex items-start gap-3 ${
            checkingIdentity ? "border-border" :
            identityReady    ? "border-green-500/30 bg-green-500/5" :
            "border-amber-400/40 bg-amber-50/5"
          }`}>
            {checkingIdentity ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-0.5 shrink-0" />
            ) : identityReady ? (
              <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              {checkingIdentity ? (
                <p className="text-xs text-muted-foreground">Checking brand identity…</p>
              ) : identityReady ? (
                <p className="text-xs text-green-600 dark:text-green-400">
                  Brand identity found — will be combined with your video idea.
                </p>
              ) : (
                <>
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    This brand does not have a saved brand identity yet.
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Please create or approve brand identity before generating brand based videos.
                  </p>
                  <Button asChild size="sm" className="mt-2">
                    <Link href={`/brands/${selectedBrand.id}/extract-identity`}>Create Brand Identity</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Form (only when brand + identity ready) ───────────────────────── */}
        {showForm && (
          <>
            <Separator />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Step 2 — Video Requirements</p>

            {/* Raw video idea */}
            <div className="space-y-1.5">
              <Label htmlFor="rawVideoIdea">
                Raw video idea <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="rawVideoIdea"
                value={rawVideoIdea}
                onChange={e => setRawVideoIdea(e.target.value)}
                placeholder="Example: Create a short Instagram Reel showing a parent discovering that their child may need a psychoeducational assessment, ending with a calm call to book a consultation."
                rows={5}
                disabled={generating}
              />
            </div>

            {/* Grid of selects */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {/* Platform */}
              <div className="space-y-1.5">
                <Label htmlFor="platform">Platform <span className="text-destructive">*</span></Label>
                <select id="platform" value={platform} onChange={e => setPlatform(e.target.value)} disabled={generating} className={SELECT_CLASS}>
                  {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                {platform === "Other" && (
                  <input className={INPUT_CLASS + " mt-1.5"} placeholder="Enter platform" value={customPlatform} onChange={e => setCustomPlatform(e.target.value)} disabled={generating} />
                )}
              </div>

              {/* Video format */}
              <div className="space-y-1.5">
                <Label htmlFor="videoFormat">Video format <span className="text-destructive">*</span></Label>
                <select id="videoFormat" value={videoFormat} onChange={e => setVideoFormat(e.target.value)} disabled={generating} className={SELECT_CLASS}>
                  {VIDEO_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                {videoFormat === "Other" && (
                  <input className={INPUT_CLASS + " mt-1.5"} placeholder="Enter video format" value={customVideoFormat} onChange={e => setCustomFormat(e.target.value)} disabled={generating} />
                )}
              </div>

              {/* Video goal */}
              <div className="space-y-1.5">
                <Label htmlFor="videoGoal">Video goal <span className="text-destructive">*</span></Label>
                <select id="videoGoal" value={videoGoal} onChange={e => setVideoGoal(e.target.value)} disabled={generating} className={SELECT_CLASS}>
                  {VIDEO_GOALS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                {videoGoal === "Other" && (
                  <input className={INPUT_CLASS + " mt-1.5"} placeholder="Enter video goal" value={customGoal} onChange={e => setCustomGoal(e.target.value)} disabled={generating} />
                )}
              </div>

              {/* Target model */}
              <div className="space-y-1.5">
                <Label htmlFor="model">Target video creator model <span className="text-destructive">*</span></Label>
                <select id="model" value={model} onChange={e => setModel(e.target.value)} disabled={generating} className={SELECT_CLASS}>
                  {VIDEO_CREATOR_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                {model === "Other" && (
                  <input className={INPUT_CLASS + " mt-1.5"} placeholder="Enter model name" value={customModel} onChange={e => setCustomModel(e.target.value)} disabled={generating} />
                )}
              </div>

              {/* Duration */}
              <div className="space-y-1.5">
                <Label htmlFor="duration">Video duration <span className="text-destructive">*</span></Label>
                <select id="duration" value={duration} onChange={e => setDuration(e.target.value)} disabled={generating} className={SELECT_CLASS}>
                  {DURATIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* Aspect ratio */}
              <div className="space-y-1.5">
                <Label htmlFor="aspectRatio">Aspect ratio <span className="text-destructive">*</span></Label>
                <select id="aspectRatio" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} disabled={generating} className={SELECT_CLASS}>
                  {ASPECT_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>

            {/* ── Cinematic style ──────────────────────────────────── */}
            <div className="space-y-1.5">
              <Label htmlFor="bb-cinematicStyle">Cinematic style</Label>
              <select
                id="bb-cinematicStyle"
                value={cinematicStyle}
                onChange={e => setCinematicStyle(e.target.value)}
                disabled={generating}
                className={SELECT_CLASS}
              >
                {CINEMATIC_STYLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {cinematicStyle !== "auto" && (
                <p className="text-xs text-muted-foreground">
                  {CINEMATIC_STYLE_OPTIONS.find(o => o.value === cinematicStyle)?.description}
                </p>
              )}
            </div>

            {/* ── Cinematic preset ────────────────────────────────── */}
            <div className="space-y-1.5">
              <Label htmlFor="bb-cinematicPreset">Cinematic preset</Label>
              <select
                id="bb-cinematicPreset"
                value={cinematicPreset}
                onChange={e => applyCinematicPreset(e.target.value)}
                disabled={generating}
                className={SELECT_CLASS}
              >
                {CINEMATIC_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">
                Presets auto-fill the speed ramp, camera movement, camera, lens, focal length, and
                aperture controls below. You can still adjust any of them manually afterward —
                doing so switches this back to &quot;Custom / Manual&quot;.
              </p>
            </div>

            {/* ── Cinematic controls ───────────────────────────────── */}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Cinematic controls</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="bb-speedRamp">Speed ramp</Label>
                  <select id="bb-speedRamp" value={speedRamp} onChange={e => { setSpeedRamp(e.target.value); setCinematicPreset("manual"); }} disabled={generating} className={SELECT_CLASS}>
                    {SPEED_RAMP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  {speedRamp === "Custom" && (
                    <input className={INPUT_CLASS + " mt-1.5"} placeholder="Enter custom speed ramp" value={customSpeedRamp} onChange={e => setCustomSpeedRamp(e.target.value)} disabled={generating} />
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="bb-cameraMovement">Camera movement</Label>
                  <select id="bb-cameraMovement" value={cameraMovement} onChange={e => { setCameraMovement(e.target.value); setCinematicPreset("manual"); }} disabled={generating} className={SELECT_CLASS}>
                    {CAMERA_MOVEMENT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  {cameraMovement === "Custom" && (
                    <input className={INPUT_CLASS + " mt-1.5"} placeholder="Enter custom camera movement" value={customCameraMovement} onChange={e => setCustomCameraMovement(e.target.value)} disabled={generating} />
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="bb-camera">Camera</Label>
                  <select id="bb-camera" value={camera} onChange={e => { setCamera(e.target.value); setCinematicPreset("manual"); }} disabled={generating} className={SELECT_CLASS}>
                    {CAMERA_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="bb-lens">Lens</Label>
                  <select id="bb-lens" value={lens} onChange={e => { setLens(e.target.value); setCinematicPreset("manual"); }} disabled={generating} className={SELECT_CLASS}>
                    {LENS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="bb-focalLength">Focal length</Label>
                  <select id="bb-focalLength" value={focalLength} onChange={e => { setFocalLength(e.target.value); setCinematicPreset("manual"); }} disabled={generating} className={SELECT_CLASS}>
                    {FOCAL_LENGTH_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="bb-aperture">Aperture</Label>
                  <select id="bb-aperture" value={aperture} onChange={e => { setAperture(e.target.value); setCinematicPreset("manual"); }} disabled={generating} className={SELECT_CLASS}>
                    {APERTURE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* ── AI-generated parameter guide ──────────────────────── */}
            <div className="rounded-lg border border-border/50 bg-muted/10 px-4 py-3 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                The AI will structure your idea into these nine production parameters
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-foreground/70">scene</span> ·{' '}
                <span className="text-foreground/70">main action</span> ·{' '}
                <span className="text-foreground/70">motion</span> ·{' '}
                <span className="text-foreground/70">camera movement</span> ·{' '}
                <span className="text-foreground/70">shot type</span> ·{' '}
                <span className="text-foreground/70">visual style</span> ·{' '}
                <span className="text-foreground/70">mood / vibe</span> ·{' '}
                <span className="text-foreground/70">video quality</span> ·{' '}
                <span className="text-foreground/70">avoid items</span>
              </p>
            </div>

            {/* Generate button */}
            <Button
              onClick={handleGenerate}
              disabled={generating || !rawVideoIdea.trim()}
              className="w-full gap-2"
              size="lg"
            >
              {generating
                ? <><Loader2 className="w-4 h-4 animate-spin" />Generating brand based video prompt…</>
                : <><Sparkles className="w-4 h-4" />Generate Brand Based Video Prompt</>}
            </Button>
          </>
        )}

        {/* ── Output ────────────────────────────────────────────────────────── */}
        {output && (
          <OutputSection
            output={output}
            setOutput={setOutput}
            model={resolvedModel}
            savedId={savedId}
            mode="brand_based"
          />
        )}
      </div>
    </div>
  );
}

// ── Raw idea view ─────────────────────────────────────────────────────────────

function RawIdeaView({ onBack }) {
  const [rawVideoIdea, setRawVideoIdea]         = useState("");
  const [model, setModel]                        = useState("Higgsfield");
  const [customModel, setCustomModel]            = useState("");
  const [duration, setDuration]                  = useState("15 seconds");
  const [aspectRatio, setAspectRatio]            = useState("9:16");
  const [videoType, setVideoType]                = useState("Reel");
  const [customVideoType, setCustomVideoType]    = useState("");

  // Cinematic controls
  const [speedRamp, setSpeedRamp]                       = useState("Auto");
  const [customSpeedRamp, setCustomSpeedRamp]           = useState("");
  const [cameraMovement, setCameraMovement]             = useState("Auto");
  const [customCameraMovement, setCustomCameraMovement] = useState("");
  const [camera, setCamera]                             = useState("Auto");
  const [lens, setLens]                                 = useState("Auto");
  const [focalLength, setFocalLength]                   = useState("50");
  const [aperture, setAperture]                         = useState("f/4 moderate");
  const [cinematicPreset, setCinematicPreset]           = useState("manual");
  const [cinematicStyle, setCinematicStyle]             = useState("auto");

  const [generating, setGenerating] = useState(false);
  const [output, setOutput]         = useState("");
  const [savedId, setSavedId]       = useState(null);

  const resolvedModel          = model === "Other" ? customModel.trim() : model;
  const resolvedVideoType      = videoType === "Other" ? customVideoType.trim() : videoType;
  const resolvedSpeedRamp      = speedRamp === "Custom" ? customSpeedRamp.trim() : speedRamp;
  const resolvedCameraMovement = cameraMovement === "Custom" ? customCameraMovement.trim() : cameraMovement;

  // Applying a preset sets all six cinematic controls together; the individual
  // dropdowns below stay editable, and changing any of them switches this back
  // to "Custom / Manual" so the UI doesn't imply the full preset is still active.
  function applyCinematicPreset(key) {
    setCinematicPreset(key);
    const preset = CINEMATIC_PRESETS.find(p => p.key === key);
    if (!preset?.values) return;
    setCamera(preset.values.camera);
    setLens(preset.values.lens);
    setCameraMovement(preset.values.cameraMovement);
    setSpeedRamp(preset.values.speedRamp);
    setFocalLength(preset.values.focalLength);
    setAperture(preset.values.aperture);
  }

  async function handleGenerate() {
    if (!rawVideoIdea.trim())                        { toast.error("Please enter a raw video idea."); return; }
    if (model === "Other" && !customModel.trim())     { toast.error("Please enter a custom video creator model."); return; }
    if (videoType === "Other" && !customVideoType.trim()) { toast.error("Please enter a custom video type."); return; }
    if (speedRamp === "Custom" && !customSpeedRamp.trim())             { toast.error("Please enter a custom speed ramp value."); return; }
    if (cameraMovement === "Custom" && !customCameraMovement.trim())   { toast.error("Please enter a custom camera movement value."); return; }

    setGenerating(true);
    setOutput("");
    setSavedId(null);

    try {
      const res = await fetch("/api/video/raw-idea/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawVideoIdea:            rawVideoIdea.trim(),
          targetVideoCreatorModel: resolvedModel,
          duration,
          aspectRatio,
          videoType:               resolvedVideoType,
          speedRamp:               resolvedSpeedRamp,
          cameraMovement:          resolvedCameraMovement,
          camera,
          lens,
          focalLength,
          aperture,
          cinematicStyle,
        }),
      });

      const data = await safeParseJsonResponse(res);

      if (!data.success) {
        const msg = getServerErrorMessage(data);
        if (res.status >= 500) {
          console.error("[RawIdeaView] Server error:", msg ?? "Unknown server error");
        }
        toast.error(msg ?? "Video prompt generation failed. Please check your inputs and try again.");
        return;
      }

      setOutput(data.generatedPrompt.finalPrompt ?? "");
      setSavedId(data.generatedPrompt.id);
      toast.success("Video prompt generated.");
    } catch (err) {
      const errMsg = err.message || "";
      if (errMsg.includes("Empty response") || errMsg.includes("invalid JSON")) {
        toast.error("Video prompt generation failed. The server returned an invalid response.");
      } else if (/fetch|Failed to fetch|NetworkError|network|connect/i.test(errMsg)) {
        toast.error("Could not reach the server. Check that the app is running and retry.");
      } else {
        console.error("[RawIdeaView] error:", err);
        toast.error("Video prompt generation failed. Please check your inputs and try again.");
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Create Video Prompt — Raw Idea</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Turn your raw idea into a structured, production-ready video prompt.
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="rawVideoIdea">
            Raw video idea <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="rawVideoIdea"
            value={rawVideoIdea}
            onChange={e => setRawVideoIdea(e.target.value)}
            placeholder="Example: A short Instagram Reel showing a parent trying to understand why their child struggles with reading, ending with a calm educational message about assessment support."
            rows={5}
            disabled={generating}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="model">Target video creator model <span className="text-destructive">*</span></Label>
            <select id="model" value={model} onChange={e => setModel(e.target.value)} disabled={generating} className={SELECT_CLASS}>
              {VIDEO_CREATOR_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {model === "Other" && (
              <input className={INPUT_CLASS + " mt-1.5"} placeholder="Enter model name" value={customModel} onChange={e => setCustomModel(e.target.value)} disabled={generating} />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="duration">Video duration <span className="text-destructive">*</span></Label>
            <select id="duration" value={duration} onChange={e => setDuration(e.target.value)} disabled={generating} className={SELECT_CLASS}>
              {DURATIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="aspectRatio">Aspect ratio <span className="text-destructive">*</span></Label>
            <select id="aspectRatio" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} disabled={generating} className={SELECT_CLASS}>
              {ASPECT_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="videoType">Video type <span className="text-destructive">*</span></Label>
            <select id="videoType" value={videoType} onChange={e => setVideoType(e.target.value)} disabled={generating} className={SELECT_CLASS}>
              {VIDEO_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {videoType === "Other" && (
              <input className={INPUT_CLASS + " mt-1.5"} placeholder="Enter video type" value={customVideoType} onChange={e => setCustomVideoType(e.target.value)} disabled={generating} />
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ri-cinematicStyle">Cinematic style</Label>
          <select
            id="ri-cinematicStyle"
            value={cinematicStyle}
            onChange={e => setCinematicStyle(e.target.value)}
            disabled={generating}
            className={SELECT_CLASS}
          >
            {CINEMATIC_STYLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {cinematicStyle !== "auto" && (
            <p className="text-xs text-muted-foreground">
              {CINEMATIC_STYLE_OPTIONS.find(o => o.value === cinematicStyle)?.description}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cinematicPreset">Cinematic preset</Label>
          <select
            id="cinematicPreset"
            value={cinematicPreset}
            onChange={e => applyCinematicPreset(e.target.value)}
            disabled={generating}
            className={SELECT_CLASS}
          >
            {CINEMATIC_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">
            Presets auto-fill the speed ramp, camera movement, camera, lens, focal length, and
            aperture controls below. You can still adjust any of them manually afterward —
            doing so switches this back to &quot;Custom / Manual&quot;.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Cinematic controls</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="speedRamp">Speed ramp</Label>
              <select id="speedRamp" value={speedRamp} onChange={e => { setSpeedRamp(e.target.value); setCinematicPreset("manual"); }} disabled={generating} className={SELECT_CLASS}>
                {SPEED_RAMP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              {speedRamp === "Custom" && (
                <input className={INPUT_CLASS + " mt-1.5"} placeholder="Enter custom speed ramp" value={customSpeedRamp} onChange={e => setCustomSpeedRamp(e.target.value)} disabled={generating} />
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cameraMovement">Camera movement</Label>
              <select id="cameraMovement" value={cameraMovement} onChange={e => { setCameraMovement(e.target.value); setCinematicPreset("manual"); }} disabled={generating} className={SELECT_CLASS}>
                {CAMERA_MOVEMENT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              {cameraMovement === "Custom" && (
                <input className={INPUT_CLASS + " mt-1.5"} placeholder="Enter custom camera movement" value={customCameraMovement} onChange={e => setCustomCameraMovement(e.target.value)} disabled={generating} />
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camera">Camera</Label>
              <select id="camera" value={camera} onChange={e => { setCamera(e.target.value); setCinematicPreset("manual"); }} disabled={generating} className={SELECT_CLASS}>
                {CAMERA_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lens">Lens</Label>
              <select id="lens" value={lens} onChange={e => { setLens(e.target.value); setCinematicPreset("manual"); }} disabled={generating} className={SELECT_CLASS}>
                {LENS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="focalLength">Focal length</Label>
              <select id="focalLength" value={focalLength} onChange={e => { setFocalLength(e.target.value); setCinematicPreset("manual"); }} disabled={generating} className={SELECT_CLASS}>
                {FOCAL_LENGTH_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="aperture">Aperture</Label>
              <select id="aperture" value={aperture} onChange={e => { setAperture(e.target.value); setCinematicPreset("manual"); }} disabled={generating} className={SELECT_CLASS}>
                {APERTURE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ── AI-generated parameter guide ────────────────────────── */}
        <div className="rounded-lg border border-border/50 bg-muted/10 px-4 py-3 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            The AI will structure your idea into these nine production parameters
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="text-foreground/70">scene</span> · <span className="text-foreground/70">main action</span> ·{' '}
            <span className="text-foreground/70">motion</span> ·{' '}
            <span className="text-foreground/70">camera movement</span> ·{' '}
            <span className="text-foreground/70">shot type</span> ·{' '}
            <span className="text-foreground/70">visual style</span> ·{' '}
            <span className="text-foreground/70">mood / vibe</span> ·{' '}
            <span className="text-foreground/70">video quality</span> ·{' '}
            <span className="text-foreground/70">avoid items</span>
          </p>
        </div>

        <Button
          onClick={handleGenerate}
          disabled={generating || !rawVideoIdea.trim()}
          className="w-full gap-2"
          size="lg"
        >
          {generating
            ? <><Loader2 className="w-4 h-4 animate-spin" />Generating video prompt…</>
            : <><Sparkles className="w-4 h-4" />Generate Video Prompt</>}
        </Button>

        {output && (
          <OutputSection
            output={output}
            setOutput={setOutput}
            model={resolvedModel}
            savedId={savedId}
            mode="raw_idea"
          />
        )}
      </div>
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function CreateVideoPage() {
  const [mode, setMode] = useState(null); // null | "brand-based" | "raw-idea"

  if (mode === "brand-based") return <BrandBasedView onBack={() => setMode(null)} />;
  if (mode === "raw-idea")    return <RawIdeaView    onBack={() => setMode(null)} />;

  return <HubView onSelectMode={setMode} />;
}
