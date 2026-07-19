"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  X, Sparkles, Loader2, Copy, Check, ImageIcon, RefreshCw, AlertCircle, ChevronDown, ChevronUp, MessageSquare,
} from "lucide-react";
import ReferenceImageUploader from "@/components/ReferenceImageUploader";
import GenerationReferenceImageInput from "@/components/GenerationReferenceImageInput";
import HiggsfieldImageGenerationCard from "@/components/HiggsfieldImageGenerationCard";
import OpenAIImageGenerationCard from "@/components/OpenAIImageGenerationCard";
import { formatOutputImageTextRequirementsForDisplay } from "@/lib/calendar-post-utils";
import { defaultVisualControls, ASPECT_RATIO_OPTIONS } from "@/lib/image-visual-controls";
import ImageVisualProductionControls from "@/components/ImageVisualProductionControls";

// ── Safe JSON response helper ──────────────────────────────────────────────────
async function safeParseJson(response) {
  const text = await response.text();
  if (!text?.trim()) throw new Error(`Empty response from server (status ${response.status}).`);
  try { return JSON.parse(text); }
  catch { throw new Error("Server returned invalid JSON. Check API logs."); }
}

// ── Post summary ──────────────────────────────────────────────────────────────
function PostSummary({ post }) {
  return (
    <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        {post.postNumber && (
          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">#{post.postNumber}</span>
        )}
        {post.format && <span className="text-xs text-muted-foreground">{post.format}</span>}
        {post.platform && <span className="text-xs text-muted-foreground">· {post.platform}</span>}
      </div>
      {(post.hookTitle || post.suggestedHook) && (
        <p className="text-sm font-medium line-clamp-2">{post.hookTitle || post.suggestedHook}</p>
      )}
      {(post.mainAngle || post.coreMessage || post.mainAngleAndCoreMessage) && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {post.mainAngle || post.coreMessage || post.mainAngleAndCoreMessage}
        </p>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function ImagePromptModal({ post, calendarId, brandId, onClose }) {
  // Carousel
  const format = (post.format || "").toLowerCase();
  const isCarousel = format.includes("carousel");

  const [carouselMode, setCarouselMode] = useState(
    isCarousel ? "full_carousel" : "not_carousel"
  );
  const [carouselSlideNumber, setCarouselSlideNumber] = useState(1);

  // Reference mode
  const [imageMode, setImageMode] = useState(null); // null | "without_reference" | "with_reference"

  // Reference flow state
  const [referenceAnalysis, setReferenceAnalysis] = useState(null);
  const [combining, setCombining] = useState(false);
  const [combined, setCombined] = useState(null);
  const [combinedText, setCombinedText] = useState("");
  const [combinedJsonError, setCombinedJsonError] = useState(null);
  const [savingCvd, setSavingCvd] = useState(false);
  const [approvingCvd, setApprovingCvd] = useState(false);
  const [cvdCollapsed, setCvdCollapsed] = useState(false);

  // Generation
  // Pre-fill from the structured field (cleanly formatted), then the dedicated
  // outputImageTextRequirements string, then legacy imageText fallbacks.
  const [outputImageTextRequirements, setOutputImageTextRequirements] = useState(
    formatOutputImageTextRequirementsForDisplay(post.outputImageTextRequirementsStructured ?? post.outputImageTextRequirements)
    || post.outputImageTextRequirements || post.output_image_text_requirements
    || post.imageText || post.image_text || ""
  );
  const [generating, setGenerating] = useState(false);
  const [finalPrompt, setFinalPrompt] = useState("");
  const [generatedPromptId, setGeneratedPromptId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [refinementFeedback, setRefinementFeedback] = useState("");
  const [refiningPrompt, setRefiningPrompt] = useState(false);
  const [promptGuidance, setPromptGuidance] = useState("");

// Reference image for generation (final-step upload — not CVD flow)
   const [referenceImageUrl, setReferenceImageUrl] = useState(null);
   const [referenceImageDescription, setReferenceImageDescription] = useState("");

   // Visual Production Controls — initialized from safe calendar-post fields.
   // The modal remounts per post (conditional render in the parent), so this
   // initializer runs fresh for every opened post and prevents stale leakage.
   const [visualControls, setVisualControls] = useState(() => {
     const defaults = defaultVisualControls();
     if (post?.aspectRatio) {
       const aspectRatio = post.aspectRatio.trim();
       const found = ASPECT_RATIO_OPTIONS.find(
         (o) => o.value === aspectRatio && o.value !== "auto"
       );
       if (found) defaults.aspectRatio = aspectRatio;
     }
     return defaults;
   });

  // ── Reference: combine brand + ref analysis ──────────────────────────────
  async function handleCombine(refAnalysis) {
    const analysis = refAnalysis || referenceAnalysis;
    if (!analysis) return;

    setCombining(true);
    setCombined(null);
    setCombinedText("");
    setCombinedJsonError(null);

    try {
      const res = await fetch("/api/image/combined-visual-direction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          referenceImageAnalysisId: analysis.id,
          calendarId,
          calendarPostId: post.id,
          sourceFlow: "calendar_post_reference_image_mode",
          outputImageTextRequirements,
          rawIdeaOrPostInformation: [
            post.hookTitle || post.suggestedHook ? `Hook: ${post.hookTitle || post.suggestedHook}` : null,
            post.coreMessage || post.mainAngleAndCoreMessage ? `Core message: ${post.coreMessage || post.mainAngleAndCoreMessage}` : null,
            post.visualDirection ? `Visual direction: ${post.visualDirection}` : null,
            post.format ? `Format: ${post.format}` : null,
            post.platform ? `Platform: ${post.platform}` : null,
          ].filter(Boolean).join("\n"),
        }),
      });
      const data = await safeParseJson(res);
      if (!data.success) { toast.error(data.error ?? "Combination failed."); return; }
      const cvd = data.combinedVisualDirection;
      setCombined(cvd);
      setCombinedText(JSON.stringify(cvd.combinedJson, null, 2));
      toast.success("Combined direction created. Review and approve before generating.");
    } catch (err) {
      console.error("[ImagePromptModal] combine error:", err);
      toast.error(err.message || "Combination failed. Please try again.");
    } finally {
      setCombining(false);
    }
  }

  async function handleSaveCvd() {
    let parsed;
    try { parsed = JSON.parse(combinedText); setCombinedJsonError(null); }
    catch { setCombinedJsonError("Invalid JSON — fix before saving."); return; }
    setSavingCvd(true);
    try {
      const res = await fetch(`/api/image/combined-visual-direction/${combined.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editedJson: parsed, status: "draft" }),
      });
      const data = await safeParseJson(res);
      if (!data.success) { toast.error(data.error ?? "Save failed."); return; }
      setCombined(prev => ({ ...prev, editedJson: parsed, status: "draft" }));
      toast.success("Direction saved.");
    } catch (err) {
      toast.error(err.message || "Save failed.");
    } finally {
      setSavingCvd(false);
    }
  }

  async function handleApproveCvd() {
    let parsed;
    try { parsed = JSON.parse(combinedText); setCombinedJsonError(null); }
    catch { setCombinedJsonError("Invalid JSON — fix before approving."); return; }
    setApprovingCvd(true);
    try {
      const origStr = JSON.stringify(combined.combinedJson, null, 2);
      const isEdited = combinedText.trim() !== origStr.trim();
      const body = { status: "approved", ...(isEdited ? { editedJson: parsed } : {}) };
      const res = await fetch(`/api/image/combined-visual-direction/${combined.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await safeParseJson(res);
      if (!data.success) { toast.error(data.error ?? "Approval failed."); return; }
      setCombined(prev => ({ ...prev, status: "approved", editedJson: isEdited ? parsed : prev.editedJson }));
      toast.success("Direction approved. Ready to generate Nanobanana prompt.");
    } catch (err) {
      toast.error(err.message || "Approval failed.");
    } finally {
      setApprovingCvd(false);
    }
  }

  // ── Generate prompt ──────────────────────────────────────────────────────
  async function handleGenerate() {
    setGenerating(true);
    setFinalPrompt("");
    setError(null);
    setSaved(false);

    try {
      const body = {
        brandId,
        outputImageTextRequirements,
        carouselMode: isCarousel ? carouselMode : "not_carousel",
        carouselSlideNumber: carouselMode === "exact_slide" ? carouselSlideNumber : null,
        combinedVisualDirectionId: combined?.id || null,
        visualControls,
        ...(promptGuidance.trim() ? { promptGuidance: promptGuidance.trim() } : {}),
      };

      const res = await fetch(`/api/content-calendar/${calendarId}/posts/${post.id}/image-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await safeParseJson(res);

      if (!data.success) {
        setError(data.error ?? "Generation failed.");
        toast.error(data.error ?? "Generation failed.");
        return;
      }

      setFinalPrompt(data.generatedPrompt.finalPrompt ?? "");
      setGeneratedPromptId(data.generatedPrompt.id ?? null);
      setSaved(true);
      toast.success("Image prompt created and saved.");
    } catch (err) {
      console.error("[ImagePromptModal] generate error:", err);
      setError(err.message || "Generation failed. Please try again.");
      toast.error(err.message || "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  // ── Reference image upload ──────────────────────────────────────────────
  // (handled inside GenerationReferenceImageInput)

  async function handleCopy() {
    await navigator.clipboard.writeText(finalPrompt);
    setCopied(true);
    toast.success("Prompt copied!");
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRefinePrompt() {
    if (!refinementFeedback.trim() || !finalPrompt) return;
    setRefiningPrompt(true);
    setError(null);

    try {
      const body = {
        brandId,
        outputImageTextRequirements,
        carouselMode: isCarousel ? carouselMode : "not_carousel",
        carouselSlideNumber: carouselMode === "exact_slide" ? carouselSlideNumber : null,
        combinedVisualDirectionId: combined?.id || null,
        visualControls,
        currentPrompt: finalPrompt,
        refinementFeedback: refinementFeedback.trim(),
      };

      const res = await fetch(`/api/content-calendar/${calendarId}/posts/${post.id}/image-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await safeParseJson(res);

      if (!data.success) {
        toast.error(data.error ?? "Refinement failed.");
        return;
      }

      setFinalPrompt(data.generatedPrompt.finalPrompt ?? "");
      setGeneratedPromptId(data.generatedPrompt.id ?? null);
      setSaved(true);
      setRefinementFeedback("");
      toast.success("Prompt refined and saved.");
    } catch (err) {
      console.error("[ImagePromptModal] refine error:", err);
      toast.error(err.message || "Refinement failed. Please try again.");
    } finally {
      setRefiningPrompt(false);
    }
  }

  // ── Can generate? ─────────────────────────────────────────────────────────
  const canGenerate = (() => {
    if (!imageMode) return false;
    if (imageMode === "with_reference") {
      return combined?.status === "approved";
    }
    return true;
  })();

  const modeLabel = (() => {
    if (imageMode === "with_reference") {
      if (!referenceAnalysis) return "Upload reference image";
      if (!combined) return "Combine directions";
      if (combined.status !== "approved") return "Approve combined direction";
      return "Ready to generate";
    }
    return null;
  })();

  // Busy state for disabling controls during generation/refinement
  const busyState = generating || refiningPrompt;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-background border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <ImageIcon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Create Image Prompt</h2>
              <p className="text-xs text-muted-foreground">from Calendar Post</p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Post summary */}
          <PostSummary post={post} />

          {/* ── Carousel options ── */}
          {isCarousel && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Carousel Options</p>
              <div className="flex gap-2 flex-wrap">
                {["full_carousel", "exact_slide"].map(m => (
                  <button key={m} type="button"
                    onClick={() => setCarouselMode(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      carouselMode === m
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}>
                    {m === "full_carousel" ? "Full carousel prompt" : "Exact slide"}
                  </button>
                ))}
              </div>
              {carouselMode === "exact_slide" && (
                <div className="flex items-center gap-2 mt-2">
                  <label className="text-xs text-muted-foreground">Slide number:</label>
                  <input
                    type="number"
                    min={1}
                    value={carouselSlideNumber}
                    onChange={e => setCarouselSlideNumber(Number(e.target.value))}
                    className="w-16 h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Image text requirements ── */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground block">
              Output image text requirements
              <span className="ml-1 text-muted-foreground/60">
                {isCarousel ? "— slide-by-slide text (optional, edit if needed)" : "(optional)"}
              </span>
            </label>
            <textarea
              value={outputImageTextRequirements}
              onChange={e => setOutputImageTextRequirements(e.target.value)}
              rows={isCarousel ? 6 : 2}
              placeholder={
                isCarousel
                  ? "Slide 1: {main_headline: '...', subheadline: '...', call_to_action: '...', logo_text: '...'}\nSlide 2: {...}"
                  : "E.g. Include a bold headline, no long text, small CTA at bottom."
              }
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-y"
            />
          </div>

          {/* ── Mode selection ── */}
          {!imageMode && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Image Prompt Mode</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setImageMode("without_reference")}
                  className="rounded-lg border border-border px-4 py-4 text-left hover:border-primary hover:bg-primary/5 transition-colors">
                  <ImageIcon className="w-4 h-4 text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Without Reference Image</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Use brand identity + post context only</p>
                </button>
                <button type="button" onClick={() => setImageMode("with_reference")}
                  className="rounded-lg border border-border px-4 py-4 text-left hover:border-primary hover:bg-primary/5 transition-colors">
                  <Sparkles className="w-4 h-4 text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">With Reference Image</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Upload a reference image to guide the visual style</p>
                </button>
              </div>
            </div>
          )}

          {/* ── Mode selected: Without reference ── */}
          {imageMode === "without_reference" && !finalPrompt && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Mode: <span className="text-foreground font-medium">Without reference image</span>
                </p>
                <button type="button" onClick={() => setImageMode(null)}
                  className="text-xs text-muted-foreground hover:text-foreground underline">
                  Change mode
                </button>
              </div>
{/* Pre-generation guidance */}
       <div className="space-y-1.5">
         <label className="text-xs font-medium text-muted-foreground block">
           Extra guidance for the final prompt
           <span className="ml-1 font-normal text-muted-foreground/60">(optional)</span>
         </label>
         <textarea
           value={promptGuidance}
           onChange={e => setPromptGuidance(e.target.value)}
           placeholder="Make it more premium and minimal. Focus on clean composition and stronger CTA placement."
           rows={2}
           disabled={generating}
           className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-y"
         />
         <p className="text-xs text-muted-foreground/60">
           Tell AI what to emphasize in the final image prompt.
         </p>
       </div>

       {/* Visual Production Controls */}
       <ImageVisualProductionControls
         value={visualControls}
         onChange={setVisualControls}
         disabled={busyState}
       />

       {error && (
         <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-center gap-2">
           <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
         </div>
       )}
       <button type="button" onClick={handleGenerate} disabled={generating}
         className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors">
         {generating
           ? <><Loader2 className="w-4 h-4 animate-spin" />Generating Nanobanana prompt…</>
           : <><Sparkles className="w-4 h-4" />Generate Image Prompt</>}
       </button>
            </div>
          )}

          {/* ── Mode selected: With reference ── */}
          {imageMode === "with_reference" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Mode: <span className="text-foreground font-medium">With reference image</span>
                  {modeLabel && <> · <span className="text-primary">{modeLabel}</span></>}
                </p>
                <button type="button" onClick={() => { setImageMode(null); setReferenceAnalysis(null); setCombined(null); setFinalPrompt(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline">
                  Change mode
                </button>
              </div>

              {/* Step 1: Reference image upload */}
              <ReferenceImageUploader
                sourceFlow="calendar_post_image_creation"
                brandId={brandId}
                calendarId={calendarId}
                calendarPostId={post.id}
                onAnalysisApproved={(analysis) => {
                  setReferenceAnalysis(analysis);
                  setCombined(null);
                  setFinalPrompt("");
                  handleCombine(analysis);
                }}
                onAnalysisSaved={(a) => setReferenceAnalysis(prev => prev ? { ...prev, ...a } : a)}
              />

              {/* Step 2: Combine */}
              {referenceAnalysis && !combined && (
                <div className="space-y-2">
                  {combining ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />Combining brand identity with reference image analysis…
                    </div>
                  ) : (
                    <button type="button" onClick={() => handleCombine(referenceAnalysis)}
                      className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg bg-muted hover:bg-muted/80 transition-colors">
                      <Sparkles className="w-3.5 h-3.5" />Combine brand + reference image direction
                    </button>
                  )}
                </div>
              )}

              {/* Step 3: CVD review */}
{combined && (
         <div className="rounded-lg border border-border overflow-hidden">
           <button type="button"
             onClick={() => setCvdCollapsed(v => !v)}
             className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors">
             <div className="flex items-center gap-2">
               <span className="text-sm font-medium">Combined Visual Direction</span>
               {combined.status === "approved" && (
                 <span className="inline-flex items-center gap-1 text-xs bg-green-500/10 text-green-400 border border-green-500/20 rounded px-1.5 py-0.5">
                   <Check className="w-2.5 h-2.5" />Approved
                 </span>
               )}
             </div>
             {cvdCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
           </button>

           {!cvdCollapsed && (
             <div className="p-4 space-y-3 border-t border-border">
               <p className="text-xs text-muted-foreground">
                 Edit if needed, then approve to generate the final Nanobanana prompt.
               </p>
               {combinedJsonError && (
                 <p className="text-xs text-destructive flex items-center gap-1">
                   <AlertCircle className="w-3 h-3" />{combinedJsonError}
                 </p>
               )}
               <textarea
                 value={combinedText}
                 onChange={e => { setCombinedText(e.target.value); setCombinedJsonError(null); }}
                 rows={12}
                 readOnly={combined.status === "approved"}
                 className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs resize-y"
                 spellCheck={false}
               />
               {combined.status !== "approved" && (
                 <div className="flex gap-2 flex-wrap">
                   <button type="button" onClick={handleApproveCvd} disabled={approvingCvd || savingCvd}
                     className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                     {approvingCvd ? <><Loader2 className="w-3 h-3 animate-spin" />Approving…</> : <><Check className="w-3 h-3" />Approve Direction</>}
                   </button>
                   <button type="button" onClick={handleSaveCvd} disabled={savingCvd || approvingCvd}
                     className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-60">
                     {savingCvd ? <><Loader2 className="w-3 h-3 animate-spin" />Saving…</> : "Save Edits"}
                   </button>
                   <button type="button" onClick={() => handleCombine(referenceAnalysis)} disabled={combining}
                     className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-60">
                     <RefreshCw className="w-3 h-3" />Recombine
                   </button>
                 </div>
               )}
             </div>
           )}
         </div>
       )}
       {/* Visual Production Controls - show when we have combined data */}
       {combined && (
         <ImageVisualProductionControls
           value={visualControls}
           onChange={setVisualControls}
           disabled={busyState}
         />
       )}

              {/* Step 4: Generate */}
              {combined?.status === "approved" && !finalPrompt && (
                <div className="space-y-2">
                  {error && (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
                    </div>
                  )}
                  <button type="button" onClick={handleGenerate} disabled={generating}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors">
                    {generating
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Generating Nanobanana prompt…</>
                      : <><Sparkles className="w-4 h-4" />Generate Image Prompt</>}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Final prompt output ── */}
          {finalPrompt && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Nanobanana Prompt</p>
                <div className="flex items-center gap-2">
                  {saved && (
                    <span className="text-xs text-green-400 flex items-center gap-1">
                      <Check className="w-3 h-3" />Saved
                    </span>
                  )}
                  <button type="button" onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">
                    {copied ? <><Check className="w-3 h-3" />Copied!</> : <><Copy className="w-3 h-3" />Copy</>}
                  </button>
                  <button type="button" onClick={() => { setFinalPrompt(""); setSaved(false); }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg text-muted-foreground hover:text-foreground">
                    <RefreshCw className="w-3 h-3" />Regenerate
                  </button>
                </div>
              </div>
              <textarea
                value={finalPrompt}
                onChange={e => setFinalPrompt(e.target.value)}
                rows={10}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs resize-y"
              />

              {/* Refine prompt with feedback */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                  <p className="text-xs font-medium">Refine this Nanobanana Prompt</p>
                </div>
                <textarea
                  value={refinementFeedback}
                  onChange={e => setRefinementFeedback(e.target.value)}
                  placeholder="e.g. Make it more premium and less text-heavy. Keep the same content but make the composition more editorial."
                  rows={2}
                  disabled={refiningPrompt}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-y"
                />
                <button
                  type="button"
                  onClick={handleRefinePrompt}
                  disabled={refiningPrompt || !refinementFeedback.trim() || !finalPrompt}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
                >
                  {refiningPrompt
                    ? <><Loader2 className="w-3 h-3 animate-spin" />Refining…</>
                    : <><Sparkles className="w-3 h-3" />Refine Prompt</>}
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                Saved to <a href="/generated-prompts" className="underline hover:text-foreground" target="_blank" rel="noreferrer">Generated Prompts</a>
                {" "}· type: <code className="font-mono">image</code> · mode: <code className="font-mono">{imageMode === "with_reference" ? "calendar_post_with_reference" : "calendar_post_without_reference"}</code>
              </p>
            </div>
          )}

          {/* ── Reference Image for Generation ── */}
          {finalPrompt && (
            <GenerationReferenceImageInput
              referenceImageUrl={referenceImageUrl}
              setReferenceImageUrl={setReferenceImageUrl}
              referenceImageDescription={referenceImageDescription}
              setReferenceImageDescription={setReferenceImageDescription}
            />
          )}

          {/* ── Generate with Higgsfield ── */}
          <HiggsfieldImageGenerationCard
            finalPrompt={finalPrompt}
            brandId={brandId}
            calendarPostId={post?.id}
            generatedPromptId={generatedPromptId}
            referenceImageDescription={referenceImageDescription}
            referenceImageUrl={referenceImageUrl}
          />

          {/* ── Generate with OpenAI ── */}
          <OpenAIImageGenerationCard
            finalPrompt={finalPrompt}
            brandId={brandId}
            calendarPostId={post?.id}
            generatedPromptId={generatedPromptId}
            referenceImageUrl={referenceImageUrl}
            referenceImageDescription={referenceImageDescription}
          />
        </div>
      </div>
    </div>
  );
}
