"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import HiggsfieldImageGenerationCard from "@/components/HiggsfieldImageGenerationCard";
import OpenAIImageGenerationCard from "@/components/OpenAIImageGenerationCard";
import GenerationReferenceImageInput from "@/components/GenerationReferenceImageInput";
import ImageVisualProductionControls from "@/components/ImageVisualProductionControls";
import {
  normalizeBrandIdentityOutput,
  createCompactBrandVisualIdentitySummaryForImagePrompt,
} from "@/lib/brand-identity-utils";
import { defaultVisualControls } from "@/lib/image-visual-controls";
import { parseApiResponse, getApiErrorMessage } from "@/lib/http";
import {
  ArrowLeft,
  Briefcase,
  Sparkles,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ImageIcon,
  ScanLine,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";

const POST_TYPES = [
  "Static post",
  "Carousel cover",
  "Carousel slide",
  "Instagram story",
  "Ad creative",
  "Website hero image",
  "YouTube thumbnail",
  "LinkedIn post graphic",
  "Other",
];

const PLATFORMS = [
  "Instagram",
  "LinkedIn",
  "Facebook",
  "Website",
  "Google Business Profile",
  "YouTube Thumbnail",
  "Other",
];

const ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9", "3:4"];

const CREATIVE_GOALS = [
  "Awareness",
  "Engagement",
  "Lead generation",
  "Conversion",
  "Trust building",
  "Education",
  "Promotion",
  "Announcement",
  "Other",
];

const VISUAL_STYLES = [
  "Clean and minimal",
  "Bold and eye catching",
  "Professional and corporate",
  "Warm and friendly",
  "Luxury and premium",
  "Educational infographic",
  "Realistic photo based",
  "3D graphic style",
  "Mixed media",
  "Other",
];

const TEXT_DENSITIES = [
  "Very minimal text",
  "Short headline only",
  "Headline plus short supporting text",
  "Moderate text",
  "Text heavy infographic",
];

const MAX_CHARS = 1400;

function resolveSelectValue(selectVal, customVal) {
  return selectVal === "Other" ? customVal.trim() : selectVal;
}

export default function FromBrandClient({ brands }) {
  const router = useRouter();
  const [step, setStep] = useState("pick");
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [brandIdentity, setBrandIdentity] = useState(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityCollapsed, setIdentityCollapsed] = useState(true);

  // Form fields
  const [rawIdeaOrPostInformation, setRawIdeaOrPostInformation] = useState("");
  const [outputImageTextRequirements, setOutputImageTextRequirements] = useState("");
  const [postType, setPostType] = useState("Static post");
  const [customPostType, setCustomPostType] = useState("");
  const [platform, setPlatform] = useState("Instagram");
  const [customPlatform, setCustomPlatform] = useState("");
  const [aspectRatio, setAspectRatio] = useState("4:5");
  const [creativeGoal, setCreativeGoal] = useState("Awareness");
  const [customCreativeGoal, setCustomCreativeGoal] = useState("");
  const [visualStyleDirection, setVisualStyleDirection] = useState("Clean and minimal");
  const [customVisualStyleDirection, setCustomVisualStyleDirection] = useState("");
  const [textDensity, setTextDensity] = useState("Headline plus short supporting text");

  // Visual Production Controls — kept across idea edits, target-tool switches,
  // review, and regeneration. Reset only on brand change or full workflow reset.
  const [visualControls, setVisualControls] = useState(defaultVisualControls());

  // Generation state
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [savedId, setSavedId] = useState(null);
  const [genError, setGenError] = useState("");
  const [referenceImageUrl, setReferenceImageUrl] = useState(null);
  const [referenceImageDescription, setReferenceImageDescription] = useState("");
  const [copied, setCopied] = useState(false);

  // A user with exactly one assigned brand has nothing to pick, so open their
  // brand directly. `brands` is scoped server-side, so this can only ever
  // select a brand the user belongs to. The ref keeps it to a single run.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current) return;
    if (selectedBrand) return;
    if (brands?.length !== 1) return;
    autoSelected.current = true;
    handleSelectBrand(brands[0]);
  }, [brands, selectedBrand]);

  async function handleSelectBrand(brand) {
    setSelectedBrand(brand);
    setIdentityLoading(true);
    setBrandIdentity(null);
    setOutput("");
    setGenError("");
    setSavedId(null);
    setVisualControls(defaultVisualControls());

    try {
      const res = await fetch(`/api/brands/${brand.id}/identity`);
      const data = await res.json();
      setBrandIdentity(data[0] ?? null);
    } catch {
      toast.error("Failed to load brand identity.");
    } finally {
      setIdentityLoading(false);
      setStep("method");
    }
  }

  async function handleGenerate() {
    if (!rawIdeaOrPostInformation.trim()) {
      return toast.error("Please enter your raw idea or post information.");
    }
    if (!brandIdentity) {
      return toast.error("Please create or approve brand identity before generating.");
    }

    const finalPostType = resolveSelectValue(postType, customPostType);
    const finalPlatform = resolveSelectValue(platform, customPlatform);
    const finalCreativeGoal = resolveSelectValue(creativeGoal, customCreativeGoal);
    const finalVisualStyleDirection = resolveSelectValue(visualStyleDirection, customVisualStyleDirection);

    if (!finalPostType) return toast.error("Please select or enter a post type.");
    if (!finalPlatform) return toast.error("Please select or enter a platform.");

    setRunning(true);
    setOutput("");
    setGenError("");
    setSavedId(null);

    try {
      const res = await fetch("/api/image/from-brand/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: selectedBrand.id,
          rawIdeaOrPostInformation: rawIdeaOrPostInformation.trim(),
          outputImageTextRequirements: outputImageTextRequirements.trim(),
          postType: finalPostType,
          platform: finalPlatform,
          aspectRatio,
          creativeGoal: finalCreativeGoal,
          visualStyleDirection: finalVisualStyleDirection,
          textDensity,
          visualControls,
        }),
      });

      const data = await parseApiResponse(res);
      if (!data.success) throw new Error(getApiErrorMessage(data) ?? "Generation failed.");

      setOutput(data.generatedPrompt.finalPrompt);
      setSavedId(data.generatedPrompt.id);
      toast.success("Prompt generated and saved.");
    } catch (err) {
      setGenError(err.message);
    } finally {
      setRunning(false);
    }
  }

  async function handleCopy() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    toast.success("Prompt copied!");
    setTimeout(() => setCopied(false), 2000);
  }

  const charCount = output.length;
  const isOverLimit = charCount > MAX_CHARS;

  // ── Brand picker ───────────────────────────────────────────────────────────
  if (step === "pick") {
    return (
      <div className="p-8 max-w-3xl">
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/create-image">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Create Image from Brand</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Select the brand to create the image for.
            </p>
          </div>
        </div>

        {brands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
              <Briefcase className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No brands yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Create a brand first, then extract its visual identity before generating image prompts.
            </p>
            <Button asChild className="mt-4" size="sm">
              <Link href="/brands/new">Create Brand</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {brands.map((brand) => (
              <button
                key={brand.id}
                onClick={() => handleSelectBrand(brand)}
                className="text-left group"
              >
                <Card className="h-full transition-colors hover:border-primary hover:bg-muted/40 cursor-pointer">
                  <CardContent className="pt-5 pb-4">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                      <Briefcase className="w-4 h-4 text-primary" />
                    </div>
                    <p className="text-sm font-medium leading-tight">{brand.name}</p>
                    {brand.businessType && (
                      <p className="text-xs text-muted-foreground mt-0.5">{brand.businessType}</p>
                    )}
                    <div className="flex gap-1.5 flex-wrap mt-2">
                      {brand.businessLocation && (
                        <Badge variant="secondary" className="text-xs">
                          {brand.businessLocation}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Method selection ────────────────────────────────────────────────────────
  if (step === "method") {
    return (
      <div className="p-8 max-w-2xl">
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="icon" onClick={() => setStep("pick")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Choose Image Creation Method</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{selectedBrand?.name}</p>
          </div>
        </div>

        <div
          className={`rounded-lg border px-4 py-3 flex items-start gap-3 mb-6 ${
            identityLoading
              ? "border-border"
              : brandIdentity
              ? "border-green-500/30 bg-green-500/5"
              : "border-amber-400/40 bg-amber-50/5"
          }`}
        >
          {identityLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-0.5 shrink-0" />
          ) : brandIdentity ? (
            <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          )}
          <div className="min-w-0">
            {identityLoading ? (
              <p className="text-xs text-muted-foreground">Checking brand identity…</p>
            ) : brandIdentity ? (
              <p className="text-xs text-green-600 dark:text-green-400">
                Brand identity found — AI will use it for image direction.
              </p>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                No brand identity found.{" "}
                <Link
                  href={`/brands/${selectedBrand?.id}/extract-identity`}
                  className="underline"
                >
                  Extract it
                </Link>{" "}
                for better results.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setStep("form")}
            className="text-left rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors p-5 space-y-3"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ImageIcon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">
                Graphic post based on brand and post information
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Provide your post idea and parameters. AI generates a concise Nanobanana
                prompt.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              router.push(`/create-image/reference-flow?brandId=${selectedBrand?.id}`)
            }
            className="text-left rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors p-5 space-y-3"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ScanLine className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Graphic post based on reference image</p>
              <p className="text-xs text-muted-foreground mt-1">
                Upload a reference image. AI combines visual style with brand identity.
              </p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ── Form step ──────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setStep("method");
            setOutput("");
            setGenError("");
          }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Graphic Post from Brand</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{selectedBrand?.name}</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Brand Identity preview (collapsed by default) */}
        <Card>
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setIdentityCollapsed((v) => !v)}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Brand Identity</CardTitle>
              <div className="flex items-center gap-2">
                {identityLoading && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                )}
                {!identityLoading && !brandIdentity && (
                  <Badge variant="destructive" className="text-xs">
                    No identity found
                  </Badge>
                )}
                {identityCollapsed ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
          {!identityCollapsed && (
            <CardContent>
              {identityLoading ? (
                <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading identity…
                </div>
              ) : brandIdentity ? (
                <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-48 whitespace-pre-wrap break-words">
                  {createCompactBrandVisualIdentitySummaryForImagePrompt(
                    normalizeBrandIdentityOutput(brandIdentity).brandVisualIdentity
                  )}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No brand identity found. Go to{" "}
                  <Link
                    href={`/brands/${selectedBrand?.id}/extract-identity`}
                    className="underline hover:text-foreground"
                  >
                    Extract Identity
                  </Link>{" "}
                  first.
                </p>
              )}
            </CardContent>
          )}
        </Card>

        {/* Raw idea or post information */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Raw Idea or Post Information{" "}
              <span className="text-destructive ml-0.5">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={rawIdeaOrPostInformation}
              onChange={(e) => setRawIdeaOrPostInformation(e.target.value)}
              placeholder="Example: Create an Instagram post about why small businesses need a clear landing page before running ads."
              rows={4}
            />
          </CardContent>
        </Card>

        {/* Image text requirements */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Image Text Requirements</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Optional but recommended — specify the exact text you want on the image.
            </p>
          </CardHeader>
          <CardContent>
            <Textarea
              value={outputImageTextRequirements}
              onChange={(e) => setOutputImageTextRequirements(e.target.value)}
              placeholder={
                "Example:\nMain headline: Ads do not fix unclear offers.\nSupporting text: Fix the landing page first.\nCTA: Book a strategy call."
              }
              rows={4}
            />
          </CardContent>
        </Card>

        {/* Post Type + Platform */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Post Type</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={postType} onValueChange={setPostType}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select post type" />
                </SelectTrigger>
                <SelectContent>
                  {POST_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {postType === "Other" && (
                <input
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Enter post type"
                  value={customPostType}
                  onChange={(e) => setCustomPostType(e.target.value)}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Platform</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select platform" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {platform === "Other" && (
                <input
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Enter platform"
                  value={customPlatform}
                  onChange={(e) => setCustomPlatform(e.target.value)}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Aspect Ratio + Creative Goal */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Aspect Ratio</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select aspect ratio" />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIOS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Creative Goal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={creativeGoal} onValueChange={setCreativeGoal}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select creative goal" />
                </SelectTrigger>
                <SelectContent>
                  {CREATIVE_GOALS.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {creativeGoal === "Other" && (
                <input
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Enter creative goal"
                  value={customCreativeGoal}
                  onChange={(e) => setCustomCreativeGoal(e.target.value)}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Visual Style Direction + Text Density */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Visual Style Direction</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={visualStyleDirection} onValueChange={setVisualStyleDirection}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select visual style" />
                </SelectTrigger>
                <SelectContent>
                  {VISUAL_STYLES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {visualStyleDirection === "Other" && (
                <input
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Enter visual style direction"
                  value={customVisualStyleDirection}
                  onChange={(e) => setCustomVisualStyleDirection(e.target.value)}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Text Density</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={textDensity} onValueChange={setTextDensity}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select text density" />
                </SelectTrigger>
                <SelectContent>
                  {TEXT_DENSITIES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </div>

        {/* Visual Production Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Visual Production Controls</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Optional production direction. Leave on AI decides to let the brand
              identity lead. Selections become explicit constraints for the prompt.
            </p>
          </CardHeader>
          <CardContent>
            <ImageVisualProductionControls
              value={visualControls}
              onChange={setVisualControls}
              disabled={running}
            />
          </CardContent>
        </Card>

        {/* Generate button */}
        <Button
          onClick={handleGenerate}
          disabled={running || !rawIdeaOrPostInformation.trim()}
          className="w-full gap-2"
          size="lg"
        >
          {running ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Generate Nanobanana Prompt
            </>
          )}
        </Button>

        {/* Error */}
        {genError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {genError}
          </div>
        )}

        {/* Output */}
        {output && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Final Nanobanana Prompt</h2>
                {savedId && (
                  <Link
                    href="/generated-prompts"
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    View in Generated Prompts
                  </Link>
                )}
              </div>

              <Textarea
                value={output}
                onChange={(e) => setOutput(e.target.value)}
                rows={10}
                className="font-mono text-xs resize-y"
              />

              <div className="flex items-center justify-between">
                <p
                  className={`text-xs ${
                    isOverLimit ? "text-destructive font-medium" : "text-muted-foreground"
                  }`}
                >
                  {charCount} / {MAX_CHARS} characters
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="gap-1.5"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Prompt
                    </>
                  )}
                </Button>
              </div>

              {isOverLimit && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-50/5 px-3 py-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Prompt is over {MAX_CHARS} characters. Please regenerate or shorten it.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Reference Image for Generation */}
        {output && (
          <GenerationReferenceImageInput
            referenceImageUrl={referenceImageUrl}
            setReferenceImageUrl={setReferenceImageUrl}
            referenceImageDescription={referenceImageDescription}
            setReferenceImageDescription={setReferenceImageDescription}
          />
        )}

        {/* Generate with Higgsfield */}
        <HiggsfieldImageGenerationCard
          finalPrompt={output}
          brandId={selectedBrand?.id}
          generatedPromptId={savedId}
          calendarPostId={null}
          referenceImageDescription={referenceImageDescription}
          referenceImageUrl={referenceImageUrl}
        />

        {/* Generate with OpenAI */}
        <OpenAIImageGenerationCard
          finalPrompt={output}
          brandId={selectedBrand?.id}
          calendarPostId={null}
          generatedPromptId={savedId}
          referenceImageUrl={referenceImageUrl}
          referenceImageDescription={referenceImageDescription}
        />
      </div>
    </div>
  );
}
