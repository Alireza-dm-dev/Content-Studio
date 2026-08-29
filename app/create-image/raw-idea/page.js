"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Sparkles, Loader2, Copy, Save, Check, ArrowLeft } from "lucide-react";
import HiggsfieldImageGenerationCard from "@/components/HiggsfieldImageGenerationCard";
import OpenAIImageGenerationCard from "@/components/OpenAIImageGenerationCard";
import GenerationReferenceImageInput from "@/components/GenerationReferenceImageInput";
import ImageVisualProductionControls from "@/components/ImageVisualProductionControls";
import { defaultVisualControls } from "@/lib/image-visual-controls";
import { parseApiResponse, getApiErrorMessage } from "@/lib/http";

const TARGET_TOOLS = ["Nanobanana", "Midjourney", "DALL-E 3", "Stable Diffusion", "Ideogram", "Flux"];

export default function CreateImageRawIdeaPage() {
  const [rawImageIdea, setRawImageIdea] = useState("");
  const [targetTool, setTargetTool] = useState("Nanobanana");
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [model, setModel] = useState("");
  const [referenceImageUrl, setReferenceImageUrl] = useState(null);
  const [referenceImageDescription, setReferenceImageDescription] = useState("");
  const [usage, setUsage] = useState(null);
  const [visualControls, setVisualControls] = useState(defaultVisualControls());

  async function handleGenerate() {
    if (!rawImageIdea.trim()) return toast.error("Enter a raw image idea first.");
    setRunning(true);
    setOutput("");
    setError("");
    setSaved(false);
    setSavedId(null);

    try {
      const res = await fetch("/api/generate/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateSlug: "image-prompt-booster-raw-idea",
          // Pass the raw idea as userInput so it is appended after the template
          // instructions — the template has no {{placeholders}}, it's a system prompt.
          userInput: rawImageIdea.trim(),
          // Also pass as variables for templates that DO use {{rawIdea}}
          variables: {
            rawIdea: rawImageIdea.trim(),
            targetTool,
          },
          visualControls,
        }),
      });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data) ?? "Generation failed.");

      const result = typeof data.content === "string"
        ? data.content
        : JSON.stringify(data.content, null, 2);

      setOutput(result);
      setModel(data.model ?? "");
      setUsage(data.usage ?? null);
    } catch (err) {
      setError(err.message);
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

  async function handleSave() {
    if (!output) return toast.error("Generate a prompt first.");
    setSaving(true);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "image",
          mode: "raw_idea",
          targetTool,
          rawInput: rawImageIdea.trim(),
          finalPrompt: output,
        }),
      });
      if (!res.ok) throw new Error("Failed to save.");
      const data = await res.json();
      setSavedId(data?.id ?? null);
      setSaved(true);
      toast.success("Prompt saved to Generated Prompts.");
    } catch {
      toast.error("Failed to save prompt.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Create Image Prompt</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Boost a raw idea into a detailed AI image generation prompt.</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Input card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Raw Image Idea</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rawImageIdea">Describe your image idea</Label>
              <Textarea
                id="rawImageIdea"
                value={rawImageIdea}
                onChange={e => setRawImageIdea(e.target.value)}
                placeholder="e.g. A woman working at a cozy home office with plants and warm morning light"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Write your idea naturally — the AI will expand it into a detailed, optimised prompt.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Target Tool</Label>
              <div className="flex flex-wrap gap-1.5">
                {TARGET_TOOLS.map(tool => (
                  <Badge
                    key={tool}
                    variant={targetTool === tool ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setTargetTool(tool)}
                  >
                    {tool}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                The prompt will be optimised for the selected tool&apos;s syntax and style.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Visual production controls */}
        <ImageVisualProductionControls
          value={visualControls}
          onChange={setVisualControls}
          disabled={running}
        />

        {/* Generate button */}
        <Button
          onClick={handleGenerate}
          disabled={running || !rawImageIdea.trim()}
          className="w-full gap-2"
          size="lg"
        >
          {running
            ? <><Loader2 className="w-4 h-4 animate-spin" />Boosting idea…</>
            : <><Sparkles className="w-4 h-4" />Boost Image Idea</>}
        </Button>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Output */}
        {output && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Generated Prompt</h2>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {model && <Badge variant="outline" className="text-xs">{model}</Badge>}
                  {usage && <span>{usage.total_tokens} tokens</span>}
                </div>
              </div>

              <Textarea
                value={output}
                onChange={e => {
                  setOutput(e.target.value);
                  setSaved(false);
                  setSavedId(null);
                }}
                rows={8}
                className="font-mono text-xs resize-y"
                placeholder="Generated prompt will appear here…"
              />

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="gap-1.5"
                >
                  {copied
                    ? <><Check className="w-3.5 h-3.5" />Copied!</>
                    : <><Copy className="w-3.5 h-3.5" />Copy Prompt</>}
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || saved}
                  className="gap-1.5"
                >
                  {saved
                    ? <><Check className="w-3.5 h-3.5" />Saved</>
                    : saving
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</>
                      : <><Save className="w-3.5 h-3.5" />Save Prompt</>}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Saved to{" "}
                <Link href="/generated-prompts" className="underline hover:text-foreground">
                  Generated Prompts
                </Link>
                {" "}as type <code className="font-mono">image</code> · mode <code className="font-mono">raw_idea</code> · tool <code className="font-mono">{targetTool}</code>.
              </p>
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
          brandId={null}
          calendarPostId={null}
          generatedPromptId={savedId}
          referenceImageDescription={referenceImageDescription}
          referenceImageUrl={referenceImageUrl}
        />

        {/* Generate with OpenAI / ChatGPT */}
        <OpenAIImageGenerationCard
          finalPrompt={output}
          brandId={null}
          calendarPostId={null}
          generatedPromptId={savedId}
          referenceImageUrl={referenceImageUrl}
          referenceImageDescription={referenceImageDescription}
        />
      </div>
    </div>
  );
}
