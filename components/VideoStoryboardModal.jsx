"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  X, Film, Loader2, Copy, Check, RefreshCw, AlertCircle, Sparkles,
  ChevronDown, ChevronUp, Clapperboard,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────────

async function safeParseJson(response) {
  const text = await response.text();
  if (!text?.trim()) throw new Error(`Empty response from server (status ${response.status}).`);
  try { return JSON.parse(text); }
  catch { throw new Error("Server returned invalid JSON. Check API logs."); }
}

const VIDEO_FORMATS = new Set([
  "reel", "video", "tiktok", "tiktok video", "youtube shorts", "shorts",
  "story video", "ad creative", "cinematic scene", "product video",
  "brand video", "educational video",
]);
function isVideoFormat(f) { return VIDEO_FORMATS.has((f || "").toLowerCase()); }

function defaultAspectRatio(platform) {
  const p = (platform || "").toLowerCase();
  if (p.includes("youtube") && !p.includes("short")) return "16:9";
  if (p.includes("linkedin")) return "1:1";
  return "9:16";
}

// ── Post summary ───────────────────────────────────────────────────────────────
function PostSummary({ post }) {
  return (
    <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        {post.postNumber && (
          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">#{post.postNumber}</span>
        )}
        {post.format && (
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            isVideoFormat(post.format) ? "bg-purple-500/10 text-purple-400" : "text-muted-foreground"
          }`}>{post.format}</span>
        )}
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

// ── Select field ───────────────────────────────────────────────────────────────
function SelectField({ label, value, onChange, options, fullWidth }) {
  return (
    <div className={`space-y-1 ${fullWidth ? "col-span-2" : ""}`}>
      <label className="text-xs font-medium text-muted-foreground block">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── Final Prompt Panel ─────────────────────────────────────────────────────────
function FinalPromptPanel({ storyboard, settings }) {
  const { targetModel, customModel, duration, aspectRatio, videoFormat, customFormat, videoGoal } = settings;
  const effectiveModel  = targetModel  === "Other" ? customModel.trim()  : targetModel;
  const effectiveFormat = videoFormat  === "Other" ? customFormat.trim() : videoFormat;

  const [generating, setGenerating] = useState(false);
  const [finalPrompt, setFinalPrompt] = useState("");
  const [saved, setSaved]             = useState(false);
  const [copied, setCopied]           = useState(false);
  const [error, setError]             = useState(null);

  // ── Request changes (revise final prompt) ─────────────────────────────────
  const [generatedPromptId, setGeneratedPromptId] = useState(null);
  const [revisionFeedback, setRevisionFeedback]   = useState("");
  const [revising, setRevising]                   = useState(false);
  const [revisionError, setRevisionError]         = useState(null);

  async function handleGenerate() {
    setGenerating(true);
    setFinalPrompt("");
    setError(null);
    setSaved(false);
    setGeneratedPromptId(null);
    setRevisionFeedback("");
    setRevisionError(null);
    try {
      const res = await fetch(`/api/video-storyboards/${storyboard.id}/generate-final-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetVideoCreatorModel: effectiveModel || "Higgsfield",
          duration,
          aspectRatio,
          videoFormat: effectiveFormat || videoFormat,
          videoGoal,
        }),
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
      toast.success("Final video prompt created and saved.");
    } catch (err) {
      setError(err.message || "Generation failed. Please try again.");
      toast.error(err.message || "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(finalPrompt);
    setCopied(true);
    toast.success("Prompt copied!");
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRevise() {
    if (!generatedPromptId || !revisionFeedback.trim() || revising) return;
    setRevising(true);
    setRevisionError(null);
    try {
      const res = await fetch(`/api/prompts/${generatedPromptId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: revisionFeedback.trim() }),
      });
      const data = await safeParseJson(res);
      if (!data.success) {
        setRevisionError(data.error ?? "Revision failed.");
        toast.error(data.error ?? "Revision failed.");
        return;
      }
      setFinalPrompt(data.generatedPrompt.finalPrompt ?? finalPrompt);
      setGeneratedPromptId(data.generatedPrompt.id ?? generatedPromptId);
      setRevisionFeedback("");
    } catch (err) {
      setRevisionError(err.message || "Revision failed. Please try again.");
      toast.error(err.message || "Revision failed.");
    } finally {
      setRevising(false);
    }
  }

  const reviseDisabled = !generatedPromptId || !revisionFeedback.trim() || revising;

  return (
    <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-purple-500/20">
        <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-purple-300">Step 2 — Generate Final Video Prompt</p>
          <p className="text-xs text-muted-foreground">
            Model: {effectiveModel} · {duration} · {aspectRatio} · {effectiveFormat || videoFormat}
            {videoGoal ? ` · ${videoGoal}` : ""}
          </p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {!finalPrompt && (
          <>
            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
              </div>
            )}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-60 transition-colors"
            >
              {generating
                ? <><Loader2 className="w-4 h-4 animate-spin" />Generating final video prompt…</>
                : <><Sparkles className="w-4 h-4" />Generate Final Video Prompt</>}
            </button>
          </>
        )}

        {finalPrompt && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">Final Video Prompt</p>
                {saved && (
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />Saved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">
                  {copied ? <><Check className="w-3 h-3" />Copied!</> : <><Copy className="w-3 h-3" />Copy Prompt</>}
                </button>
                <button type="button" onClick={() => {
                  setFinalPrompt(""); setSaved(false);
                  setGeneratedPromptId(null); setRevisionFeedback(""); setRevisionError(null);
                }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg text-muted-foreground hover:text-foreground">
                  <RefreshCw className="w-3 h-3" />Regenerate
                </button>
              </div>
            </div>
            <textarea
              value={finalPrompt}
              onChange={e => setFinalPrompt(e.target.value)}
              rows={12}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs resize-y leading-relaxed"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Saved to{" "}
              <a href="/generated-prompts" className="underline hover:text-foreground" target="_blank" rel="noreferrer">
                Generated Prompts
              </a>
              {" "}· type: <code className="font-mono">video</code> · mode: <code className="font-mono">storyboard_based</code>
            </p>

            {/* ── Request changes ── */}
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <label htmlFor="storyboard-revision-feedback" className="text-xs font-medium block">
                Request changes
              </label>
              <textarea
                id="storyboard-revision-feedback"
                value={revisionFeedback}
                onChange={e => setRevisionFeedback(e.target.value)}
                placeholder="Describe what to change, e.g. make the tone more playful, shorten the intro shot…"
                rows={3}
                disabled={revising}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-y leading-relaxed disabled:opacity-60"
                spellCheck={false}
              />
              {revisionError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />{revisionError}
                </div>
              )}
              <button
                type="button"
                onClick={handleRevise}
                disabled={reviseDisabled}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60 transition-colors"
              >
                {revising
                  ? <><Loader2 className="w-3 h-3 animate-spin" />Revising…</>
                  : "Revise prompt"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function VideoStoryboardModal({ post, calendarId, brandId, onClose }) {
  const postFormat   = post.format   || "";
  const postPlatform = post.platform || "";
  const isVideo = isVideoFormat(postFormat);

  // ── Video settings (used for storyboard AND final prompt) ──────────────────
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [targetModel,  setTargetModel]  = useState("Higgsfield");
  const [customModel,  setCustomModel]  = useState("");
  const [duration,     setDuration]     = useState("15 seconds");
  const [aspectRatio,  setAspectRatio]  = useState(defaultAspectRatio(postPlatform));
  const [videoFormat,  setVideoFormat]  = useState(postFormat || "Reel");
  const [customFormat, setCustomFormat] = useState("");
  const [videoGoal,    setVideoGoal]    = useState(
    post.mainAngle || post.coreMessage || post.mainAngleAndCoreMessage || ""
  );

  const effectiveModel  = targetModel  === "Other" ? customModel.trim()  : targetModel;
  const effectiveFormat = videoFormat  === "Other" ? customFormat.trim() : videoFormat;

  // ── Storyboard state ───────────────────────────────────────────────────────
  const [generating,  setGenerating]  = useState(false);
  const [storyboard,  setStoryboard]  = useState(null);
  const [storyboardText, setStoryboardText] = useState("");
  const [sbError,     setSbError]     = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [approving,   setApproving]   = useState(false);
  const [sbCopied,    setSbCopied]    = useState(false);

  const isApproved = storyboard?.status === "approved";

  // ── Generate storyboard ────────────────────────────────────────────────────
  async function handleGenerateStoryboard() {
    setGenerating(true);
    setSbError(null);
    setStoryboard(null);
    setStoryboardText("");

    try {
      const res = await fetch(`/api/content-calendar/${calendarId}/posts/${post.id}/video-storyboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          targetVideoCreatorModel: effectiveModel || "Higgsfield",
          duration,
          aspectRatio,
          videoFormat: effectiveFormat || videoFormat,
          videoGoal,
        }),
      });
      const data = await safeParseJson(res);

      if (!data.success) {
        setSbError(data.error ?? "Storyboard generation failed.");
        toast.error(data.error ?? "Storyboard generation failed.");
        return;
      }

      const sb = data.videoStoryboard;
      setStoryboard(sb);
      setStoryboardText(sb.storyboardOutput ?? "");
      setSettingsOpen(false);
      toast.success("Storyboard created. Review and approve.");
    } catch (err) {
      setSbError(err.message || "Storyboard generation failed.");
      toast.error(err.message || "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  // ── Save revision ──────────────────────────────────────────────────────────
  async function handleSaveRevision() {
    if (!storyboard) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/video-storyboards/${storyboard.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedStoryboard: storyboardText, status: "draft" }),
      });
      const data = await safeParseJson(res);
      if (!data.success) { toast.error(data.error ?? "Save failed."); return; }
      setStoryboard(prev => ({ ...prev, approvedStoryboard: storyboardText, status: "draft" }));
      toast.success("Revision saved.");
    } catch (err) {
      toast.error(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // ── Approve ────────────────────────────────────────────────────────────────
  async function handleApprove() {
    if (!storyboard) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/video-storyboards/${storyboard.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedStoryboard: storyboardText, status: "approved" }),
      });
      const data = await safeParseJson(res);
      if (!data.success) { toast.error(data.error ?? "Approval failed."); return; }
      setStoryboard(prev => ({ ...prev, approvedStoryboard: storyboardText, status: "approved" }));
      toast.success("Storyboard approved! Generate the final video prompt below.");
    } catch (err) {
      toast.error(err.message || "Approval failed.");
    } finally {
      setApproving(false);
    }
  }

  // ── Copy storyboard ────────────────────────────────────────────────────────
  async function handleCopyStoryboard() {
    await navigator.clipboard.writeText(storyboardText);
    setSbCopied(true);
    toast.success("Storyboard copied!");
    setTimeout(() => setSbCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-background border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Clapperboard className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Create Video Prompt</h2>
              <p className="text-xs text-muted-foreground">from Calendar Post · storyboard → final prompt</p>
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

          {!isVideo && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              This post format ({postFormat || "unknown"}) is not typically a video format. You can still create a video prompt — consider adapting it as a motion graphic.
            </div>
          )}

          {/* ── Video settings (Step 1) ── */}
          <div className="rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setSettingsOpen(v => !v)}
              disabled={!!storyboard}
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 disabled:cursor-default transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {storyboard ? "Video Settings" : "Step 1 — Video Settings"}
                </span>
                {storyboard && (
                  <span className="text-xs text-muted-foreground">
                    {effectiveModel} · {duration} · {aspectRatio} · {effectiveFormat || videoFormat}
                  </span>
                )}
              </div>
              {!storyboard && (settingsOpen
                ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground" />)}
            </button>

            {settingsOpen && !storyboard && (
              <div className="p-4 border-t border-border space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Target video creator model" value={targetModel} onChange={setTargetModel}
                    options={[
                      { value: "Higgsfield",        label: "Higgsfield"        },
                      { value: "Runway",             label: "Runway"            },
                      { value: "Pika",               label: "Pika"              },
                      { value: "Kling",              label: "Kling"             },
                      { value: "Veo",                label: "Veo"               },
                      { value: "Sora",               label: "Sora"              },
                      { value: "Hailuo",             label: "Hailuo"            },
                      { value: "Luma Dream Machine", label: "Luma Dream Machine"},
                      { value: "Other",              label: "Other…"            },
                    ]}
                  />
                  {targetModel === "Other" && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground block">Custom model name</label>
                      <input value={customModel} onChange={e => setCustomModel(e.target.value)}
                        placeholder="e.g. Vidu, PixVerse…"
                        className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" />
                    </div>
                  )}

                  <SelectField label="Duration" value={duration} onChange={setDuration}
                    options={[
                      { value: "5 seconds",  label: "5 seconds"  },
                      { value: "10 seconds", label: "10 seconds" },
                      { value: "15 seconds", label: "15 seconds" },
                      { value: "20 seconds", label: "20 seconds" },
                      { value: "30 seconds", label: "30 seconds" },
                      { value: "45 seconds", label: "45 seconds" },
                      { value: "60 seconds", label: "60 seconds" },
                    ]}
                  />

                  <SelectField label="Aspect ratio" value={aspectRatio} onChange={setAspectRatio}
                    options={[
                      { value: "9:16", label: "9:16 (Vertical / Reel)" },
                      { value: "1:1",  label: "1:1 (Square)"           },
                      { value: "4:5",  label: "4:5 (Portrait)"         },
                      { value: "3:4",  label: "3:4 (Portrait)"         },
                      { value: "16:9", label: "16:9 (Landscape)"       },
                    ]}
                  />

                  <SelectField label="Video format" value={videoFormat} onChange={setVideoFormat}
                    options={[
                      { value: "Reel",                   label: "Reel"                   },
                      { value: "TikTok video",            label: "TikTok video"           },
                      { value: "YouTube Shorts",          label: "YouTube Shorts"         },
                      { value: "Story",                   label: "Story"                  },
                      { value: "Ad creative",             label: "Ad creative"            },
                      { value: "Explainer video",         label: "Explainer video"        },
                      { value: "Product video",           label: "Product video"          },
                      { value: "Brand awareness video",   label: "Brand awareness video"  },
                      { value: "Educational video",       label: "Educational video"      },
                      { value: "Testimonial style video", label: "Testimonial style video"},
                      { value: "Other",                   label: "Other…"                 },
                    ]}
                  />
                  {videoFormat === "Other" && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground block">Custom format</label>
                      <input value={customFormat} onChange={e => setCustomFormat(e.target.value)}
                        placeholder="e.g. Cinematic brand film…"
                        className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" />
                    </div>
                  )}

                  <SelectField label="Video goal" value={videoGoal} onChange={setVideoGoal} fullWidth
                    options={[
                      { value: "",                   label: "Select or skip"           },
                      { value: "Awareness",          label: "Awareness"               },
                      { value: "Lead generation",    label: "Lead generation"         },
                      { value: "Engagement",         label: "Engagement"              },
                      { value: "Trust building",     label: "Trust building"          },
                      { value: "Education",          label: "Education"               },
                      { value: "Conversion",         label: "Conversion"              },
                      { value: "Service explanation",label: "Service explanation"     },
                      { value: "Product explanation",label: "Product explanation"     },
                      { value: "Promotion",          label: "Promotion"               },
                      { value: "Retargeting",        label: "Retargeting"             },
                      { value: "Other",              label: "Other"                   },
                    ]}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Step 2: create storyboard ── */}
          {!storyboard && (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-amber-400" />
                  Step 2 — Create Video Storyboard
                </p>
                <ul className="space-y-0.5 list-disc list-inside mt-1">
                  <li>Brand identity and visual rules</li>
                  <li>Post hook, message, visual direction</li>
                  <li>Video planning and production details</li>
                  <li>Your selected video settings above</li>
                </ul>
              </div>

              {sbError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />{sbError}
                </div>
              )}

              <button type="button" onClick={handleGenerateStoryboard} disabled={generating}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-60 transition-colors">
                {generating
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Generating storyboard…</>
                  : <><Film className="w-4 h-4" />Create Video Storyboard</>}
              </button>
            </div>
          )}

          {/* ── Storyboard output ── */}
          {storyboard && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">
                    {isApproved ? "Storyboard" : "Step 2 — Review & Approve Storyboard"}
                  </p>
                  {isApproved && (
                    <span className="inline-flex items-center gap-1 text-xs bg-green-500/10 text-green-400 border border-green-500/20 rounded px-1.5 py-0.5">
                      <Check className="w-2.5 h-2.5" />Approved
                    </span>
                  )}
                  {!isApproved && storyboard.approvedStoryboard && (
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Revision saved</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={handleCopyStoryboard}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">
                    {sbCopied ? <><Check className="w-3 h-3" />Copied!</> : <><Copy className="w-3 h-3" />Copy</>}
                  </button>
                  {!isApproved && (
                    <button type="button" onClick={() => { setStoryboard(null); setStoryboardText(""); setSettingsOpen(true); }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg text-muted-foreground hover:text-foreground">
                      <RefreshCw className="w-3 h-3" />Regenerate
                    </button>
                  )}
                </div>
              </div>

              <textarea
                value={storyboardText}
                onChange={e => setStoryboardText(e.target.value)}
                rows={16}
                readOnly={isApproved}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-y leading-relaxed"
                spellCheck={false}
              />

              {!isApproved && (
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={handleApprove} disabled={approving || saving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 transition-colors">
                    {approving
                      ? <><Loader2 className="w-3 h-3 animate-spin" />Approving…</>
                      : <><Check className="w-3 h-3" />Approve Storyboard</>}
                  </button>
                  <button type="button" onClick={handleSaveRevision} disabled={saving || approving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-60">
                    {saving ? <><Loader2 className="w-3 h-3 animate-spin" />Saving…</> : "Save Revision"}
                  </button>
                </div>
              )}

              {isApproved && (
                <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 text-xs text-green-400 flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  Storyboard approved. Generate the final video prompt below.
                </div>
              )}

              {/* Hint while still in draft */}
              {!isApproved && (
                <div className="rounded-lg border border-border bg-muted/10 px-3 py-2.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="w-3.5 h-3.5 shrink-0 text-purple-400/50" />
                  <span>Approve the storyboard first to unlock <span className="font-medium text-foreground">Step 3 — Generate Final Video Prompt</span>.</span>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: generate final prompt ── */}
          {isApproved && (
            <FinalPromptPanel
              storyboard={storyboard}
              settings={{ targetModel, customModel, duration, aspectRatio, videoFormat, customFormat, videoGoal }}
            />
          )}

        </div>
      </div>
    </div>
  );
}
