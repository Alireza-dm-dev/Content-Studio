"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ArrowLeft, Briefcase, Check, Loader2, Sparkles,
  Copy, Save, AlertCircle, RefreshCw, ChevronDown, ChevronUp,
  Clock, ImageIcon,
} from "lucide-react";
import ReferenceImageUploader from "@/components/ReferenceImageUploader";
import HiggsfieldImageGenerationCard from "@/components/HiggsfieldImageGenerationCard";
import GenerationReferenceImageInput from "@/components/GenerationReferenceImageInput";
import ImageVisualProductionControls from "@/components/ImageVisualProductionControls";
import { defaultVisualControls } from "@/lib/image-visual-controls";
import { parseApiResponse, getApiErrorMessage } from "@/lib/http";

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Brand" },
  { id: 2, label: "Reference Image" },
  { id: 3, label: "Creative Brief" },
  { id: 4, label: "Combine" },
  { id: 5, label: "Review" },
  { id: 6, label: "Prompt" },
];

function StepIndicator({ current }) {
  return (
    <div className="flex items-center gap-1 mb-8 flex-wrap">
      {STEPS.map((s, i) => {
        const done   = s.id < current;
        const active = s.id === current;
        return (
          <div key={s.id} className="flex items-center gap-1">
            <div className={`flex items-center gap-1.5 ${active ? "text-foreground" : done ? "text-primary" : "text-muted-foreground"}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium border ${
                active ? "border-primary bg-primary text-primary-foreground" :
                done   ? "border-primary bg-primary/10 text-primary" :
                "border-border"
              }`}>
                {done ? <Check className="w-3 h-3" /> : s.id}
              </div>
              <span className="text-xs hidden sm:inline">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-4 sm:w-8 ${done ? "bg-primary" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Format an ISO date for the recent-reference picker ─────────────────────────

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Build rawIdeaOrPostInformation from calendar post ─────────────────────────

function buildPostInfo(post) {
  if (!post) return "";
  return [
    post.hookTitle || post.suggestedHook ? `Hook / Title: ${post.hookTitle || post.suggestedHook}` : null,
    post.mainAngle || post.coreMessage   ? `Core Message: ${post.mainAngle || ""} ${post.coreMessage || ""}`.trim() : null,
    post.caption   || post.suggestedCaption ? `Caption: ${post.caption || post.suggestedCaption}` : null,
    post.visualDirection ? `Visual Direction: ${post.visualDirection}` : null,
    post.platform   ? `Platform: ${post.platform}` : null,
    post.format     ? `Format: ${post.format}` : null,
  ].filter(Boolean).join("\n");
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ReferenceFlowClient({
  brands,
  initialBrand,
  initialBrandIdentity,
  initialCalendarPost,
  initialCalendarId,
  initialCalendarPostId,
}) {
  // Brand selection
  const [brand, setBrand]               = useState(initialBrand);
  const [brandIdentity, setBrandIdentity] = useState(initialBrandIdentity);
  const [loadingIdentity, setLoadingIdentity] = useState(false);

  // Reference image
  const [referenceAnalysis, setReferenceAnalysis] = useState(null);

  // Recent reference-image history (Step 2 picker)
  const [recentReferenceItems, setRecentReferenceItems] = useState([]);
  const [loadingRecent, setLoadingRecent]               = useState(false);
  const [recentError, setRecentError]                   = useState(null);
  const [usedRecentReference, setUsedRecentReference]   = useState(false);

  // Creative requirements
  const [requirements, setRequirements] = useState({
    outputImageTextRequirements: "",
    referenceImageAttractionNotes: "",
    rawIdeaOrPostInformation: buildPostInfo(initialCalendarPost),
  });

  // Combine
  const [combining, setCombining]   = useState(false);
  const [combined, setCombined]     = useState(null);
  const [combinedText, setCombinedText] = useState("");
  const [combineError, setCombineError] = useState(null);
  const [jsonError, setJsonError]   = useState(null);
  const [saving, setSaving]         = useState(false);
  const [approving, setApproving]   = useState(false);

  // Nanobanana prompt
  const [creating, setCreating]   = useState(false);
  const [finalPrompt, setFinalPrompt] = useState("");
  const [copied, setCopied]       = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [savedId, setSavedId]     = useState(null);

  // Visual production controls (applied only to the final prompt request; not persisted)
  const [visualControls, setVisualControls] = useState(defaultVisualControls());

  // Final-step reference image for generation (separate from the CVD reference flow)
  const [genReferenceImageUrl, setGenReferenceImageUrl] = useState(null);
  const [genReferenceImageDescription, setGenReferenceImageDescription] = useState("");

  // Determine current step
  function currentStep() {
    if (!brand) return 1;
    if (!referenceAnalysis) return 2;
    if (!combined) return 3;
    if (combined.status !== "approved") return 5;
    if (!finalPrompt) return 6;
    return 6;
  }

  // ── Recent reference-image history (fetched once a brand is selected) ────────
  useEffect(() => {
    if (!brand?.id) return;
    let cancelled = false;
    (async () => {
      setLoadingRecent(true);
      setRecentError(null);
      try {
        const res = await fetch(
          `/api/image/combined-visual-direction?history=reference-flow&brandId=${brand.id}&limit=10`
        );
        const data = await res.json();
        if (cancelled) return;
        if (!data.success) {
          setRecentError(data.error ?? "Failed to load recent reference images.");
          setRecentReferenceItems([]);
        } else {
          setRecentReferenceItems(Array.isArray(data.items) ? data.items : []);
        }
      } catch {
        if (!cancelled) {
          setRecentError("Failed to load recent reference images.");
          setRecentReferenceItems([]);
        }
      } finally {
        if (!cancelled) setLoadingRecent(false);
      }
    })();
    return () => { cancelled = true; };
  }, [brand?.id]);

  // ── Apply a recent reference-image entry instead of uploading ────────────────
  function applyRecentReference(item) {
    let analysisJson = null;
    if (item.referenceAnalysisJsonOutput) {
      try { analysisJson = JSON.parse(item.referenceAnalysisJsonOutput); } catch { analysisJson = null; }
    }
    setReferenceAnalysis({
      id:           item.referenceImageAnalysisId,
      imageUrl:     item.referenceImageUrl ?? null,
      analysisJson,
      editedJson:   null,
    });
    setUsedRecentReference(true);
    setCombined(null);
    setFinalPrompt("");
    setSavedId(null);
    setVisualControls(defaultVisualControls());
  }

  // ── Brand selection ──────────────────────────────────────────────────────────
  async function selectBrand(b) {
    setRecentReferenceItems([]);
    setRecentError(null);
    setLoadingRecent(false);
    setUsedRecentReference(false);
    setBrand(b);
    setBrandIdentity(null);
    setLoadingIdentity(true);
    try {
      const res = await fetch(`/api/brands/${b.id}/identity`);
      const data = await res.json();
      setBrandIdentity(Array.isArray(data) ? (data[0] ?? null) : null);
    } catch {
      toast.error("Failed to load brand identity.");
    } finally {
      setLoadingIdentity(false);
    }
  }

  // ── Combine ──────────────────────────────────────────────────────────────────
  async function handleCombine() {
    if (!brand || !referenceAnalysis || !requirements.rawIdeaOrPostInformation.trim()) {
      toast.error("Please choose a brand, approve a reference image analysis, and enter your raw idea before combining.");
      return;
    }

    setCombining(true);
    setCombined(null);
    setCombineError(null);
    setFinalPrompt("");
    setSavedId(null);

    try {
      const res = await fetch("/api/image/combined-visual-direction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId:                      brand.id,
          referenceImageAnalysisId:     referenceAnalysis.id,
          calendarId:                   initialCalendarId   || null,
          calendarPostId:               initialCalendarPostId || null,
          sourceFlow: initialCalendarId ? "calendar_post_reference_image_mode" : "create_image_brand_reference_mode",
          outputImageTextRequirements:  requirements.outputImageTextRequirements,
          referenceImageAttractionNotes: requirements.referenceImageAttractionNotes,
          rawIdeaOrPostInformation:     requirements.rawIdeaOrPostInformation,
        }),
      });

      const data = parseApiResponse(await res.text());
      if (!data.success) {
        setCombineError(getApiErrorMessage(data));
        toast.error(getApiErrorMessage(data));
        return;
      }

      const cvd = data.combinedVisualDirection;
      setCombined(cvd);
      setCombinedText(JSON.stringify(cvd.combinedJson, null, 2));
      toast.success("Combined direction created. Review and approve.");
    } catch (err) {
      console.error("[ReferenceFlow] combine error:", err);
      setCombineError("Combination failed. Please try again.");
      toast.error("Combination failed. Please try again.");
    } finally {
      setCombining(false);
    }
  }

  // ── Save edited direction ────────────────────────────────────────────────────
  async function handleSave() {
    let parsed;
    try { parsed = JSON.parse(combinedText); setJsonError(null); }
    catch { setJsonError("Invalid JSON — fix before saving."); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/image/combined-visual-direction/${combined.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editedJson: parsed, status: "draft" }),
      });
      const data = await res.json();
      if (!data.success) { toast.error(data.error ?? "Save failed."); return; }
      setCombined(prev => ({ ...prev, editedJson: parsed, status: "draft" }));
      toast.success("Direction saved.");
    } catch (err) {
      console.error("[ReferenceFlow] save error:", err);
      toast.error("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Approve direction ────────────────────────────────────────────────────────
  async function handleApprove() {
    let parsed;
    try { parsed = JSON.parse(combinedText); setJsonError(null); }
    catch { setJsonError("Invalid JSON — fix before approving."); return; }

    setApproving(true);
    try {
      const origStr = JSON.stringify(combined.combinedJson, null, 2);
      const isEdited = combinedText.trim() !== origStr.trim();
      const body = { status: "approved", ...(isEdited ? { editedJson: parsed } : {}) };

      const res = await fetch(`/api/image/combined-visual-direction/${combined.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) { toast.error(data.error ?? "Approval failed."); return; }
      setCombined(prev => ({ ...prev, status: "approved", editedJson: isEdited ? parsed : prev.editedJson }));
      toast.success("Direction approved. Ready to create Nanobanana prompt.");
    } catch (err) {
      console.error("[ReferenceFlow] approve error:", err);
      toast.error("Approval failed. Please try again.");
    } finally {
      setApproving(false);
    }
  }

  // ── Create Nanobanana prompt ─────────────────────────────────────────────────
  async function handleCreatePrompt() {
    setCreating(true);
    setFinalPrompt("");
    setSavedId(null);
    try {
      const useEditedJson = !!(combined.editedJson);
      const res = await fetch(`/api/image/combined-visual-direction/${combined.id}/create-nanobanana-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useEditedJson, visualControls }),
      });
      if (!res.ok && res.headers.get("content-type")?.includes("text/html")) {
        throw new Error(`Server error: HTTP ${res.status}`);
      }
      const data = parseApiResponse(await res.text());
      if (!data.success) { toast.error(getApiErrorMessage(data)); return; }
      setFinalPrompt(data.finalNanobananaPrompt ?? "");
      toast.success("Nanobanana prompt created!");
    } catch (err) {
      console.error("[ReferenceFlow] prompt error:", err);
      toast.error("Prompt creation failed. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(finalPrompt);
    setCopied(true);
    toast.success("Prompt copied!");
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSavePrompt() {
    if (!finalPrompt) return;
    setPromptSaved(false);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "image",
          mode: "reference-based",
          targetTool: "Nanobanana",
          rawInput: JSON.stringify(requirements),
          finalPrompt,
          brandId: brand?.id ?? null,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSavedId(data?.id ?? null);
      setPromptSaved(true);
      toast.success("Prompt saved to Generated Prompts.");
    } catch {
      toast.error("Failed to save prompt.");
    }
  }

  const step = currentStep();

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href={initialBrand ? `/create-image/from-brand` : "/create-image"}>
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Graphic Post from Reference Image</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Combine brand identity, reference image analysis, and your idea.
          </p>
        </div>
      </div>

      <StepIndicator current={step} />

      <div className="space-y-5">

        {/* ── Step 1: Brand ──────────────────────────────────────────────────── */}
        {!brand ? (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Step 1 — Choose Brand</p>
            {brands.length === 0 ? (
              <p className="text-sm text-muted-foreground">No brands yet. <Link href="/brands/new" className="underline">Create one first.</Link></p>
            ) : (
              <div className="space-y-2">
                {brands.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => selectBrand(b)}
                    className="w-full text-left rounded-lg border border-border px-4 py-3 hover:border-primary hover:bg-primary/5 transition-colors"
                  >
                    <p className="text-sm font-medium">{b.name}</p>
                    {b.businessType && <p className="text-xs text-muted-foreground">{b.businessType}</p>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Brand confirmed header */
          <div className="rounded-lg border border-border px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Briefcase className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">{brand.name}</p>
                {loadingIdentity ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Checking identity…</p>
                ) : brandIdentity ? (
                  <p className="text-xs text-green-500 flex items-center gap-1"><Check className="w-3 h-3" />Brand identity ready</p>
                ) : (
                  <p className="text-xs text-amber-500 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    No brand identity —{" "}
                    <Link href={`/brands/${brand.id}/extract-identity`} className="underline">Extract it first</Link>
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setBrand(null); setBrandIdentity(null); setReferenceAnalysis(null); setCombined(null); setFinalPrompt(""); setSavedId(null); setRecentReferenceItems([]); setRecentError(null); setLoadingRecent(false); setUsedRecentReference(false); setVisualControls(defaultVisualControls()); }}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Change
            </button>
          </div>
        )}

        {/* ── Step 2: Reference Image (only when brand + identity ready) ──────── */}
        {brand && (
          <div className={brandIdentity ? "" : "opacity-40 pointer-events-none"}>
            {!brandIdentity && (
              <p className="text-xs text-amber-500 mb-2 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />Extract brand identity first to enable reference image upload.
              </p>
            )}

            {/* Recent reference images — only shown before a reference is selected */}
            {!referenceAnalysis && (
              <div className="space-y-3 mb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />Recent Reference Images
                </p>

                {loadingRecent ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading recent reference images…
                  </p>
                ) : recentError ? (
                  <p className="text-xs text-muted-foreground">
                    Could not load recent reference images. You can still upload a new one below.
                  </p>
                ) : recentReferenceItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No recent reference images yet. Upload one below to get started.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {recentReferenceItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
                      >
                        {item.referenceImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.referenceImageUrl}
                            alt={item.referenceImageFileName || "Reference image"}
                            className="w-12 h-12 rounded-md object-cover border border-border shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center shrink-0">
                            <ImageIcon className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">
                            {item.referenceImageFileName || "Reference image"}
                          </p>
                          <p className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
                          {item.finalNanobananaPrompt && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {item.finalNanobananaPrompt.slice(0, 140)}
                              {item.finalNanobananaPrompt.length > 140 ? "…" : ""}
                            </p>
                          )}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => applyRecentReference(item)}
                        >
                          Use this reference
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">
                  Upload a New Reference Image
                </p>
              </div>
            )}

            {/* Confirmation banner — only shown when a recent entry was selected */}
            {usedRecentReference && referenceAnalysis && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2.5 mb-4">
                <p className="text-xs text-green-600 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />Using a recent reference image
                </p>
                <button
                  type="button"
                  onClick={() => { setReferenceAnalysis(null); setUsedRecentReference(false); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Choose a different reference
                </button>
              </div>
            )}

            <ReferenceImageUploader
              sourceFlow="create_image_brand_reference_mode"
              brandId={brand.id}
              calendarId={initialCalendarId}
              calendarPostId={initialCalendarPostId}
              onAnalysisApproved={(analysis) => {
                setReferenceAnalysis(analysis);
                setUsedRecentReference(false);
                setCombined(null);
                setFinalPrompt("");
                setSavedId(null);
                setVisualControls(defaultVisualControls());
              }}
              onAnalysisSaved={(a) => setReferenceAnalysis(prev => prev ? { ...prev, ...a } : a)}
            />
          </div>
        )}

        {/* ── Step 3: Creative Requirements ────────────────────────────────────── */}
        {brand && referenceAnalysis && (
          <div className="space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Step 3 — Creative Requirements
            </p>
            <p className="text-xs text-muted-foreground">
              Explain what you want in the final image and what parts of the reference image should inspire the result.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="imageText">Output image text requirements</Label>
              <Textarea
                id="imageText"
                value={requirements.outputImageTextRequirements}
                onChange={e => setRequirements(p => ({ ...p, outputImageTextRequirements: e.target.value }))}
                placeholder="Example: The image should include a short bold headline, no long paragraphs, and a small CTA at the bottom."
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="attraction">What should we take from the reference image?</Label>
              <Textarea
                id="attraction"
                value={requirements.referenceImageAttractionNotes}
                onChange={e => setRequirements(p => ({ ...p, referenceImageAttractionNotes: e.target.value }))}
                placeholder="Example: I like the composition, strong central object, warm lighting, and clean background. Do not copy the exact objects."
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rawIdea">Raw idea or post information *</Label>
              <Textarea
                id="rawIdea"
                value={requirements.rawIdeaOrPostInformation}
                onChange={e => setRequirements(p => ({ ...p, rawIdeaOrPostInformation: e.target.value }))}
                placeholder="Example: Create an Instagram post about early signs of autism for parents. The tone should be calm, trustworthy, and friendly."
                rows={4}
              />
              {initialCalendarPost && (
                <p className="text-xs text-muted-foreground">Pre-filled from calendar post. You can edit it.</p>
              )}
            </div>

            {/* Combine button */}
            <Button
              onClick={handleCombine}
              disabled={combining || !requirements.rawIdeaOrPostInformation.trim()}
              className="w-full gap-2"
              size="lg"
            >
              {combining
                ? <><Loader2 className="w-4 h-4 animate-spin" />Combining direction…</>
                : <><Sparkles className="w-4 h-4" />Combine Brand and Reference Image Direction</>}
            </Button>

            {combineError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />{combineError}
              </div>
            )}
          </div>
        )}

        {/* ── Step 4+5: Review Combined Direction ──────────────────────────────── */}
        {combined && (
          <>
            <Separator />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Combined Visual Direction</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    This direction combines your brand identity, the reference image analysis, and your post idea. Edit before approving.
                  </p>
                </div>
                {combined.status === "approved" && (
                  <Badge variant="default" className="gap-1 shrink-0">
                    <Check className="w-2.5 h-2.5" />Approved
                  </Badge>
                )}
              </div>

              <div className="space-y-1.5">
                {jsonError && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />{jsonError}
                  </p>
                )}
                <Textarea
                  value={combinedText}
                  onChange={e => { setCombinedText(e.target.value); setJsonError(null); }}
                  rows={18}
                  className="font-mono text-xs resize-y"
                  spellCheck={false}
                  readOnly={combined.status === "approved"}
                />
              </div>

              {combined.status !== "approved" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={handleApprove}
                    disabled={approving || saving}
                    className="gap-1.5"
                  >
                    {approving
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Approving…</>
                      : <><Check className="w-3.5 h-3.5" />Approve Direction</>}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || approving}
                    className="gap-1.5"
                  >
                    {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</> : "Save Edited Direction"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCombine}
                    disabled={combining || saving || approving}
                    className="gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />Recombine
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Step 6: Create Nanobanana Prompt ─────────────────────────────────── */}
        {combined?.status === "approved" && (
          <>
            <Separator />
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold">Create Final Nanobanana Prompt</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The approved combined direction will be passed as the raw image idea to the Nanobanana prompt generator.
                </p>
              </div>

              <ImageVisualProductionControls
                value={visualControls}
                onChange={setVisualControls}
                disabled={creating}
              />

              {!finalPrompt ? (
                <Button
                  onClick={handleCreatePrompt}
                  disabled={creating}
                  className="w-full gap-2"
                  size="lg"
                >
                  {creating
                    ? <><Loader2 className="w-4 h-4 animate-spin" />Creating Nanobanana prompt…</>
                    : <><Sparkles className="w-4 h-4" />Use this direction to create final Nanobanana prompt</>}
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Final Nanobanana Prompt</h3>
                    <Badge variant="outline" className="text-xs">Ready</Badge>
                  </div>
                  <Textarea
                    value={finalPrompt}
                    onChange={e => { setFinalPrompt(e.target.value); setSavedId(null); }}
                    rows={10}
                    className="font-mono text-xs resize-y"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
                      {copied ? <><Check className="w-3.5 h-3.5" />Copied!</> : <><Copy className="w-3.5 h-3.5" />Copy Prompt</>}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSavePrompt}
                      disabled={promptSaved}
                      className="gap-1.5"
                    >
                      {promptSaved ? <><Check className="w-3.5 h-3.5" />Saved</> : <><Save className="w-3.5 h-3.5" />Save to Prompts</>}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCreatePrompt}
                      disabled={creating}
                      className="gap-1.5 text-muted-foreground"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />Regenerate
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Saved to{" "}
                    <Link href="/generated-prompts" className="underline hover:text-foreground">Generated Prompts</Link>
                    {" "}as type <code className="font-mono">image</code> · mode <code className="font-mono">reference-based</code>.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Reference Image for Generation ── */}
        {finalPrompt && (
          <GenerationReferenceImageInput
            referenceImageUrl={genReferenceImageUrl}
            setReferenceImageUrl={setGenReferenceImageUrl}
            referenceImageDescription={genReferenceImageDescription}
            setReferenceImageDescription={setGenReferenceImageDescription}
          />
        )}

        {/* ── Generate with Higgsfield ──────────────────────────────────────────── */}
        <HiggsfieldImageGenerationCard
          finalPrompt={finalPrompt}
          brandId={brand?.id ?? null}
          calendarPostId={null}
          generatedPromptId={savedId}
          referenceImageDescription={genReferenceImageDescription}
          referenceImageUrl={genReferenceImageUrl}
        />
      </div>
    </div>
  );
}
