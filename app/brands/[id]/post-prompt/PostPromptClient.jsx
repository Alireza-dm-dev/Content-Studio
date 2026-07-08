"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowLeft, Sparkles, Loader2, Copy, Save, AlertCircle } from "lucide-react";
import ReferenceImageUploader from "@/components/ReferenceImageUploader";

const IMAGE_TEMPLATES = [
  { slug: "image-prompt-from-brand-and-post-without-reference", label: "From Brand + Post (no reference)" },
  { slug: "image-prompt-booster-raw-idea",                      label: "Boost a Raw Idea" },
];

const VIDEO_TEMPLATES = [
  { slug: "video-storyboard-generator",    label: "Generate Storyboard first" },
  { slug: "video-prompt-enhancer-raw-idea", label: "Enhance a Raw Idea" },
];

function buildVariables(brand, post, brandIdentity, type) {
  const identitySummary = brandIdentity?.editableSummary
    ?? (brandIdentity?.jsonOutput ?? null)
    ?? `Brand: ${brand.name}. Tone: ${brand.brandTone ?? ""}. Visual style: ${brand.brandVisualStyle ?? ""}. Audience: ${brand.targetAudience ?? ""}.`;

  const base = {
    brandName: brand.name,
    brandTone: brand.brandTone ?? "",
    brandVisualStyle: brand.brandVisualStyle ?? "",
    brandIdentitySummary: identitySummary,
    targetAudience: brand.targetAudience ?? "",
    platform: post?.platform ?? "",
    format: post?.format ?? "",
  };

  if (post) {
    Object.assign(base, {
      suggestedHook: post.suggestedHook ?? "",
      mainAngleAndCoreMessage: post.mainAngleAndCoreMessage ?? "",
      visualDirection: post.visualDirection ?? "",
      outputImageTextRequirements: post.outputImageTextRequirements ?? "",
      suggestedCaption: post.suggestedCaption ?? "",
      contentStructure: post.contentStructure ?? "",
    });
  }

  if (type === "image") {
    Object.assign(base, { rawIdea: post?.visualDirection ?? "" });
  } else {
    Object.assign(base, { rawIdea: post?.mainAngleAndCoreMessage ?? "" });
  }

  return base;
}

export default function PostPromptClient({ brand, post, brandIdentity, type, calendarId }) {
  const templates = type === "image" ? IMAGE_TEMPLATES : VIDEO_TEMPLATES;
  const [selectedSlug, setSelectedSlug] = useState(templates[0].slug);
  const [variables, setVariables] = useState(
    JSON.stringify(buildVariables(brand, post, brandIdentity, type), null, 2)
  );
  const [jsonError, setJsonError] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Reference image analysis (approved)
  const [approvedAnalysis, setApprovedAnalysis] = useState(null);

  const backHref = calendarId
    ? `/content-calendar/${calendarId}`
    : `/brand-workspace?brandId=${brand.id}`;

  function handleVarsChange(val) {
    setVariables(val);
    try { JSON.parse(val); setJsonError(null); }
    catch { setJsonError("Invalid JSON"); }
  }

  async function handleGenerate() {
    if (jsonError) return toast.error("Fix JSON first.");
    let vars;
    try { vars = JSON.parse(variables); }
    catch { return toast.error("Invalid JSON."); }

    setRunning(true); setResult(null); setError(null);
    try {
      // Build userInput to append reference analysis if available
      let userInput = null;
      if (approvedAnalysis?.analysisJson) {
        userInput = [
          "=== REFERENCE IMAGE ANALYSIS ===",
          "Use the following extracted reference image data to inform the visual style, composition, lighting, and color direction:",
          JSON.stringify(approvedAnalysis.analysisJson, null, 2),
        ].join("\n");
      }

      const res = await fetch("/api/generate/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateSlug: selectedSlug,
          variables: vars,
          ...(userInput ? { userInput } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed.");
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    try {
      const finalPrompt = typeof result.content === "object"
        ? JSON.stringify(result.content, null, 2)
        : result.content ?? "";

      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: type,
          mode: "from-post",
          targetTool: type === "image" ? "image-generator" : "video-generator",
          rawInput: variables,
          finalPrompt,
          brandId: brand.id,
          calendarPostId: post?.id ?? null,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Prompt saved to Generated Prompts.");
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  function handleCopy() {
    const text = typeof result?.content === "object"
      ? JSON.stringify(result.content, null, 2)
      : result?.content ?? "";
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard.");
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href={backHref}><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">
            {type === "image" ? "Image Prompt" : "Video Prompt"} from Post
          </h1>
          <p className="text-sm text-muted-foreground">{brand.name}</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Post summary */}
        {post && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Source Post</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {post.postNumber && (
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center justify-center">
                    {post.postNumber}
                  </span>
                  {post.platform && <Badge variant="secondary" className="text-xs">{post.platform}</Badge>}
                  {post.format && <Badge variant="outline" className="text-xs">{post.format}</Badge>}
                </div>
              )}
              {post.suggestedHook && <p className="text-sm font-medium">{post.suggestedHook}</p>}
              {post.mainAngleAndCoreMessage && <p className="text-xs text-muted-foreground">{post.mainAngleAndCoreMessage}</p>}
              {post.visualDirection && (
                <p className="text-xs text-muted-foreground italic">Visual: {post.visualDirection}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Reference Image (only for image type) */}
        {type === "image" && (
          <ReferenceImageUploader
            sourceFlow="calendar_post_image_creation"
            brandId={brand.id}
            calendarId={calendarId}
            calendarPostId={post?.id}
            onAnalysisApproved={(analysis) => setApprovedAnalysis(analysis)}
            onAnalysisSaved={(analysis) => {
              setApprovedAnalysis(prev => prev ? { ...prev, ...analysis } : analysis);
            }}
          />
        )}

        {/* Template selector */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Template</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {templates.map((tpl) => (
              <label key={tpl.slug} className="flex items-center gap-3 cursor-pointer rounded-lg border border-border px-3 py-2.5 hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="template"
                  value={tpl.slug}
                  checked={selectedSlug === tpl.slug}
                  onChange={() => setSelectedSlug(tpl.slug)}
                  className="accent-primary"
                />
                <div>
                  <p className="text-sm font-medium">{tpl.label}</p>
                  <code className="text-xs text-muted-foreground font-mono">{tpl.slug}</code>
                </div>
              </label>
            ))}
          </CardContent>
        </Card>

        {/* Variables */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Variables</CardTitle>
              {jsonError && (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />{jsonError}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              value={variables}
              onChange={(e) => handleVarsChange(e.target.value)}
              className="font-mono text-xs min-h-[180px] resize-y"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Pre-filled from post and brand data. Edit as needed.
              {approvedAnalysis && (
                <span className="text-primary ml-1">· Reference image analysis will be included.</span>
              )}
            </p>
          </CardContent>
        </Card>

        {/* Generate */}
        <Button onClick={handleGenerate} disabled={running || !!jsonError} className="w-full gap-2" size="lg">
          {running
            ? <><Loader2 className="w-4 h-4 animate-spin" />Generating…</>
            : <><Sparkles className="w-4 h-4" />Generate {type === "image" ? "Image" : "Video"} Prompt</>}
        </Button>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 flex gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Result */}
        {result && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Generated Prompt</h3>
                <div className="flex items-center gap-2">
                  {result.usage && (
                    <span className="text-xs text-muted-foreground">{result.usage.total_tokens} tokens</span>
                  )}
                  <Badge variant="outline" className="text-xs">{result.model}</Badge>
                </div>
              </div>
              <pre className="bg-muted rounded-lg p-4 text-xs overflow-auto max-h-[400px] whitespace-pre-wrap break-words">
                {typeof result.content === "object"
                  ? JSON.stringify(result.content, null, 2)
                  : result.content}
              </pre>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopy}>
                  <Copy className="w-3.5 h-3.5" />Copy
                </Button>
                <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={saving}>
                  <Save className="w-3.5 h-3.5" />{saving ? "Saving…" : "Save to Generated Prompts"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
