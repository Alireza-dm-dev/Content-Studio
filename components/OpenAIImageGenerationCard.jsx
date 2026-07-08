"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ImageIcon, AlertCircle, Check, Sparkles, Wand2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// Platform presets map an Instagram-friendly format to the closest size the
// OpenAI image API actually supports (gpt-image-1 only outputs 1024x1024,
// 1536x1024, or 1024x1536). The exact Instagram pixel dimensions are carried
// as metadata plus a prompt instruction so the model composes accordingly —
// no client-side resizing/cropping happens here.
const PLATFORM_PRESETS = [
  {
    key: "square",
    label: "Square — 1024×1024",
    openaiSize: "1024x1024",
    targetWidth: 1024,
    targetHeight: 1024,
    ratioLabel: "1:1",
    promptInstruction: null,
  },
  {
    key: "ig-post-4-5",
    label: "Instagram Post 4:5 — 1080×1350",
    openaiSize: "1024x1536",
    targetWidth: 1080,
    targetHeight: 1350,
    ratioLabel: "4:5",
    promptInstruction:
      "Compose this image for an Instagram Post (4:5 vertical format), target 1080×1350. Keep important subjects and text within safe margins.",
  },
  {
    key: "ig-post-3-4",
    label: "Instagram Post 3:4 — 1080×1440",
    openaiSize: "1024x1536",
    targetWidth: 1080,
    targetHeight: 1440,
    ratioLabel: "3:4",
    promptInstruction:
      "Compose this image for an Instagram Post (3:4 vertical format), target 1080×1440. Keep important subjects and text within safe margins.",
  },
  {
    key: "ig-reel",
    label: "Instagram Reel — 1080×1920",
    openaiSize: "1024x1536",
    targetWidth: 1080,
    targetHeight: 1920,
    ratioLabel: "9:16",
    promptInstruction:
      "Compose this image for an Instagram Reel (9:16 vertical format), target 1080×1920. Keep important subjects and text within safe margins.",
  },
  {
    key: "ig-story",
    label: "Instagram Story — 1080×1920",
    openaiSize: "1024x1536",
    targetWidth: 1080,
    targetHeight: 1920,
    ratioLabel: "9:16",
    promptInstruction:
      "Compose this image for an Instagram Story (9:16 vertical format), target 1080×1920. Keep important subjects and text within safe margins.",
  },
];

function getPreset(key) {
  return PLATFORM_PRESETS.find((p) => p.key === key) ?? PLATFORM_PRESETS[0];
}

const QUALITIES = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

async function safeParseJson(response) {
  const text = await response.text();
  if (!text?.trim()) throw new Error(`Empty response from server (status ${response.status}).`);
  try { return JSON.parse(text); }
  catch { throw new Error("Server returned invalid JSON. Check API logs."); }
}

// ── Generate with OpenAI ──────────────────────────────────────────────────────
export default function OpenAIImageGenerationCard({
  finalPrompt,
  brandId,
  calendarPostId,
  generatedPromptId,
}) {
  const [platformPreset, setPlatformPreset] = useState("square");
  const [quality, setQuality] = useState("auto");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [editInstruction, setEditInstruction] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState(null);

  async function handleGenerate() {
    if (!finalPrompt?.trim()) return;

    setGenerating(true);
    setResult(null);
    setError(null);

    const preset = getPreset(platformPreset);

    try {
      const res = await fetch("/api/openai/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalPrompt,
          size: preset.openaiSize,
          quality,
          platformPreset: preset.key,
          targetWidth: preset.targetWidth,
          targetHeight: preset.targetHeight,
          aspectRatioLabel: preset.ratioLabel,
          ...(brandId ? { brandId } : {}),
          ...(calendarPostId ? { calendarPostId } : {}),
          ...(generatedPromptId ? { generatedPromptId } : {}),
        }),
      });
      const data = await safeParseJson(res);

      if (!res.ok || !data.success) {
        const msg = data.error ?? "OpenAI image generation failed.";
        setError(msg);
        toast.error(msg);
        return;
      }

      setResult(data);
      toast.success("Image generated with OpenAI!");
    } catch (err) {
      console.error("[OpenAIImageGenerationCard] error:", err);
      const msg = err.message || "OpenAI image generation failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  }

  async function handleEdit() {
    const generatedMediaId = result?.generatedMedia?.id;
    if (!generatedMediaId || !editInstruction.trim() || editing) return;

    setEditing(true);
    setEditError(null);

    const preset = getPreset(platformPreset);

    try {
      const res = await fetch("/api/openai/edit-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generatedMediaId,
          instruction: editInstruction,
          size: preset.openaiSize,
          quality,
          platformPreset: preset.key,
          targetWidth: preset.targetWidth,
          targetHeight: preset.targetHeight,
          aspectRatioLabel: preset.ratioLabel,
        }),
      });
      const data = await safeParseJson(res);

      if (!res.ok || !data.success) {
        const msg = data.error ?? "OpenAI image edit failed.";
        setEditError(msg);
        toast.error(msg);
        return;
      }

      setResult(data);
      setEditInstruction("");
      setEditError(null);
      toast.success("Image edited with OpenAI!");
    } catch (err) {
      console.error("[OpenAIImageGenerationCard] edit error:", err);
      const msg = err.message || "OpenAI image edit failed.";
      setEditError(msg);
      toast.error(msg);
    } finally {
      setEditing(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      {/* Header */}
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        Generate with OpenAI
      </p>

      {/* Empty-prompt placeholder */}
      {!finalPrompt && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Generate an image prompt first, then create the image with OpenAI.
        </div>
      )}

      {/* Controls — only shown when a prompt exists */}
      {!!finalPrompt && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Format</p>
              <Select value={platformPreset} onValueChange={setPlatformPreset}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_PRESETS.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Quality</p>
              <Select value={quality} onValueChange={setQuality}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITIES.map((q) => (
                    <SelectItem key={q.value} value={q.value}>
                      {q.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {generating
              ? <><Loader2 className="w-4 h-4 animate-spin" />Generating image…</>
              : <><ImageIcon className="w-4 h-4" />Generate Image with OpenAI</>}
          </button>
        </>
      )}

      {/* Success */}
      {result && (
        <div className="space-y-2 rounded-lg border border-green-500/30 bg-green-500/5 p-3">
          <p className="text-xs text-green-400 flex items-center gap-1.5 font-medium">
            <Check className="w-3.5 h-3.5" />
            Image generated successfully.
          </p>
          {result.filePath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.filePath}
              alt="OpenAI generated result"
              className="w-full rounded-md border border-border"
            />
          )}
          <Link
            href="/generated-media"
            target="_blank"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View in Generated Media
          </Link>

          {/* Edit / regenerate this image */}
          <div className="space-y-1.5 pt-1">
            <Label htmlFor="openai-edit-instruction" className="text-xs">
              Edit this image
            </Label>
            <Textarea
              id="openai-edit-instruction"
              value={editInstruction}
              onChange={(e) => setEditInstruction(e.target.value)}
              placeholder="Describe what you'd like to change…"
              className="text-sm"
              disabled={editing}
            />
            <Button
              type="button"
              size="sm"
              className="w-full"
              onClick={handleEdit}
              disabled={!result?.generatedMedia?.id || !editInstruction.trim() || editing}
            >
              {editing
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Creating edited image…</>
                : <><Wand2 className="w-3.5 h-3.5" />Create edited image</>}
            </Button>
            {editError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs text-destructive flex items-center gap-1.5 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {editError}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs text-destructive flex items-center gap-1.5 font-medium">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </p>
        </div>
      )}
    </div>
  );
}
