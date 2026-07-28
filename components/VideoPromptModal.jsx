"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  X, Clapperboard, Loader2, Copy, Check, RefreshCw, AlertCircle, ChevronDown, ChevronUp,
} from "lucide-react";

import { CINEMATIC_STYLE_OPTIONS } from "@/lib/cinematic-styles";

// ── Safe JSON response helper ──────────────────────────────────────────────────
async function safeParseJson(response) {
  const text = await response.text();
  if (!text?.trim()) throw new Error(`Empty response from server (status ${response.status}).`);
  try { return JSON.parse(text); }
  catch { throw new Error("Server returned invalid JSON. Check API logs."); }
}

// ── Video format detection ─────────────────────────────────────────────────────
const VIDEO_FORMATS = new Set([
  "reel", "video", "tiktok", "tiktok video", "youtube shorts", "shorts",
  "story video", "ad creative", "cinematic scene", "product video",
  "brand video", "educational video",
]);

function isVideoFormat(format) {
  return VIDEO_FORMATS.has((format || "").toLowerCase());
}

// ── Post summary ──────────────────────────────────────────────────────────────
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

// ── Field input ───────────────────────────────────────────────────────────────
function Field({ label, value, onChange, type = "input", rows = 2, placeholder = "" }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground block">{label}</label>
      {type === "textarea" ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-none"
        />
      ) : (
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-8 rounded-md border border-input bg-transparent px-3 text-xs"
        />
      )}
    </div>
  );
}

// ── Select input ──────────────────────────────────────────────────────────────
function SelectField({ label, value, onChange, options }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground block">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-8 rounded-md border border-input bg-transparent px-2 text-xs"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function VideoPromptModal({ post, calendarId, brandId, onClose }) {
  const postFormat = post.format || "";
  const postPlatform = post.platform || "";

  // Default aspect ratio from platform
  const defaultAspectRatio = (() => {
    const p = postPlatform.toLowerCase();
    if (p.includes("youtube") && !p.includes("short")) return "16:9";
    if (p.includes("linkedin")) return "1:1";
    return "9:16";
  })();

  // Settings
  const [targetVideoCreatorModel, setTargetVideoCreatorModel] = useState("Higgsfield");
  const [duration, setDuration] = useState("15 seconds");
  const [aspectRatio, setAspectRatio] = useState(defaultAspectRatio);
  const [videoGoal, setVideoGoal] = useState(
    post.mainAngle || post.coreMessage || post.mainAngleAndCoreMessage || ""
  );
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [cinematicStyle, setCinematicStyle] = useState("auto");

  // Generation
  const [generating, setGenerating] = useState(false);
  const [finalPrompt, setFinalPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const isVideo = isVideoFormat(postFormat);

  async function handleGenerate() {
    setGenerating(true);
    setFinalPrompt("");
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(`/api/content-calendar/${calendarId}/posts/${post.id}/video-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          targetVideoCreatorModel,
          duration,
          aspectRatio,
          videoGoal,
          cinematicStyle,
        }),
      });
      const data = await safeParseJson(res);

      if (!data.success) {
        setError(data.error ?? "Generation failed.");
        toast.error(data.error ?? "Generation failed.");
        return;
      }

      setFinalPrompt(data.generatedPrompt.finalPrompt ?? "");
      setSaved(true);
      setSettingsOpen(false);
      toast.success("Video prompt created and saved.");
    } catch (err) {
      console.error("[VideoPromptModal] generate error:", err);
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

          {!isVideo && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              This post format ({postFormat || "unknown"}) is not typically a video format. A video prompt can still be created — it may work as a short-form video or motion graphic.
            </div>
          )}

          {/* Settings panel */}
          <div className="rounded-lg border border-border overflow-hidden">
            <button type="button"
              onClick={() => setSettingsOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left">
              <span className="text-sm font-medium">Generation Settings</span>
              {settingsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {settingsOpen && (
              <div className="p-4 border-t border-border grid grid-cols-2 gap-3">
                <SelectField
                  label="Video Creator Model"
                  value={targetVideoCreatorModel}
                  onChange={setTargetVideoCreatorModel}
                  options={[
                    { value: "Higgsfield", label: "Higgsfield" },
                    { value: "Kling", label: "Kling" },
                    { value: "Runway", label: "Runway" },
                    { value: "Sora", label: "Sora" },
                    { value: "Hailuo", label: "Hailuo" },
                    { value: "Vidu", label: "Vidu" },
                    { value: "Pika", label: "Pika" },
                    { value: "Luma Dream Machine", label: "Luma Dream Machine" },
                  ]}
                />
                <SelectField
                  label="Duration"
                  value={duration}
                  onChange={setDuration}
                  options={[
                    { value: "5 seconds", label: "5 seconds" },
                    { value: "8 seconds", label: "8 seconds" },
                    { value: "10 seconds", label: "10 seconds" },
                    { value: "15 seconds", label: "15 seconds" },
                    { value: "20 seconds", label: "20 seconds" },
                    { value: "30 seconds", label: "30 seconds" },
                    { value: "60 seconds", label: "60 seconds" },
                  ]}
                />
                <SelectField
                  label="Aspect Ratio"
                  value={aspectRatio}
                  onChange={setAspectRatio}
                  options={[
                    { value: "9:16", label: "9:16 (Vertical / Reel)" },
                    { value: "1:1", label: "1:1 (Square)" },
                    { value: "16:9", label: "16:9 (Landscape)" },
                    { value: "4:5", label: "4:5 (Portrait)" },
                  ]}
                />
                <Field label="Video Goal" value={videoGoal} onChange={setVideoGoal}
                  placeholder="E.g. Increase awareness, drive clicks…" />
                <SelectField
                  label="Cinematic Style"
                  value={cinematicStyle}
                  onChange={setCinematicStyle}
                  options={CINEMATIC_STYLE_OPTIONS}
                />
              </div>
            )}
          </div>

          {/* Generate button */}
          {!finalPrompt && (
            <div className="space-y-2">
              {error && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
                </div>
              )}
              <button type="button" onClick={handleGenerate} disabled={generating}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-60 transition-colors">
                {generating
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Generating video prompt…</>
                  : <><Clapperboard className="w-4 h-4" />Generate Video Prompt ({targetVideoCreatorModel})</>}
              </button>
            </div>
          )}

          {/* Final prompt output */}
          {finalPrompt && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Video Prompt — {targetVideoCreatorModel}</p>
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
                  <button type="button" onClick={() => { setFinalPrompt(""); setSaved(false); setSettingsOpen(true); }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg text-muted-foreground hover:text-foreground">
                    <RefreshCw className="w-3 h-3" />Regenerate
                  </button>
                </div>
              </div>
              <textarea
                value={finalPrompt}
                onChange={e => setFinalPrompt(e.target.value)}
                rows={12}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs resize-y"
              />
              <p className="text-xs text-muted-foreground">
                Saved to <a href="/generated-prompts" className="underline hover:text-foreground" target="_blank" rel="noreferrer">Generated Prompts</a>
                {" "}· type: <code className="font-mono">video</code> · mode: <code className="font-mono">calendar_post</code>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
