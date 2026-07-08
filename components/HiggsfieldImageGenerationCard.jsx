"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ImageIcon, AlertCircle, Check, Wand2, Coins } from "lucide-react";

// ── Safe JSON response helper ──────────────────────────────────────────────────
async function safeParseJson(response) {
  const text = await response.text();
  if (!text?.trim()) throw new Error(`Empty response from server (status ${response.status}).`);
  try { return JSON.parse(text); }
  catch { throw new Error("Server returned invalid JSON. Check API logs."); }
}

// ── Generate with Higgsfield ─────────────────────────────────────────────────
export default function HiggsfieldImageGenerationCard({
  finalPrompt,
  brandId,
  calendarPostId,
  generatedPromptId,
}) {
  const [higgsfieldModels, setHiggsfieldModels] = useState([]);
  const [higgsfieldModelsLoading, setHiggsfieldModelsLoading] = useState(true);
  const [selectedHiggsfieldModelId, setSelectedHiggsfieldModelId] = useState("");
  const [higgsfieldBalance, setHiggsfieldBalance] = useState(null);
  const [higgsfieldGenerating, setHiggsfieldGenerating] = useState(false);
  const [higgsfieldResult, setHiggsfieldResult] = useState(null);
  const [higgsfieldError, setHiggsfieldError] = useState(null);

  // ── Load active image models + local balance on mount ─────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadHiggsfieldData() {
      setHiggsfieldModelsLoading(true);
      try {
        const [modelsRes, balanceRes] = await Promise.all([
          fetch("/api/higgsfield/models?mediaType=image"),
          fetch("/api/higgsfield/balance"),
        ]);
        const modelsData = await safeParseJson(modelsRes);
        const balanceData = await safeParseJson(balanceRes);
        if (cancelled) return;

        const activeModels = (modelsData.models ?? []).filter(m => m.isActive);
        setHiggsfieldModels(activeModels);
        setSelectedHiggsfieldModelId(prev => prev || activeModels[0]?.id || "");
        setHiggsfieldBalance(balanceData.balance?.balance ?? 0);
      } catch (err) {
        console.error("[HiggsfieldImageGenerationCard] Higgsfield init error:", err);
      } finally {
        if (!cancelled) setHiggsfieldModelsLoading(false);
      }
    }

    loadHiggsfieldData();
    return () => { cancelled = true; };
  }, []);

  // ── Generate image from final prompt ───────────────────────────────────────
  async function handleGenerateHiggsfieldImage() {
    if (!selectedHiggsfieldModelId || !finalPrompt?.trim()) return;

    setHiggsfieldGenerating(true);
    setHiggsfieldResult(null);
    setHiggsfieldError(null);

    try {
      const res = await fetch("/api/higgsfield/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          higgsfieldModelId: selectedHiggsfieldModelId,
          prompt: finalPrompt,
          ...(generatedPromptId ? { generatedPromptId } : {}),
          ...(brandId ? { brandId } : {}),
          ...(calendarPostId ? { calendarPostId } : {}),
        }),
      });
      const data = await safeParseJson(res);

      if (!res.ok || data.error) {
        setHiggsfieldError(data);
        if (typeof data.balanceAfter === "number") setHiggsfieldBalance(data.balanceAfter);
        toast.error(data.error ?? "Higgsfield image generation failed.");
        return;
      }

      setHiggsfieldResult(data);
      if (typeof data.balanceAfter === "number") setHiggsfieldBalance(data.balanceAfter);
      toast.success("Image generated with Higgsfield!");
    } catch (err) {
      console.error("[HiggsfieldImageGenerationCard] Higgsfield generate error:", err);
      setHiggsfieldError({ error: err.message || "Higgsfield image generation failed." });
      toast.error(err.message || "Higgsfield image generation failed.");
    } finally {
      setHiggsfieldGenerating(false);
    }
  }

  // ── Selected model + balance check ───────────────────────────────────────
  const selectedHiggsfieldModel = higgsfieldModels.find(m => m.id === selectedHiggsfieldModelId) ?? null;
  const insufficientHiggsfieldBalance =
    !!selectedHiggsfieldModel && higgsfieldBalance !== null && higgsfieldBalance < selectedHiggsfieldModel.tokenCost;

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Wand2 className="w-3.5 h-3.5 text-primary" />
          Generate with Higgsfield
        </p>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Coins className="w-3 h-3" />
          {higgsfieldBalance === null ? "—" : `${higgsfieldBalance} tokens`} available
        </span>
      </div>

      {!finalPrompt && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Generate an image prompt first, then you can create the image with Higgsfield.
        </div>
      )}

      {higgsfieldModelsLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading Higgsfield models…
        </div>
      ) : higgsfieldModels.length === 0 ? (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          No active Higgsfield image model is configured. Add one to enable image generation.
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Higgsfield model</label>
            <select
              value={selectedHiggsfieldModelId}
              onChange={e => setSelectedHiggsfieldModelId(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs"
            >
              {higgsfieldModels.map(m => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.tokenCost} tokens)
                </option>
              ))}
            </select>
          </div>

          {insufficientHiggsfieldBalance && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Local Higgsfield token balance is too low.
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerateHiggsfieldImage}
            disabled={higgsfieldGenerating || !selectedHiggsfieldModelId || !finalPrompt?.trim() || insufficientHiggsfieldBalance}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {higgsfieldGenerating
              ? <><Loader2 className="w-4 h-4 animate-spin" />Generating image…</>
              : <><ImageIcon className="w-4 h-4" />Generate Image with Higgsfield</>}
          </button>
        </>
      )}

      {/* Success */}
      {higgsfieldResult && (
        <div className="space-y-2 rounded-lg border border-green-500/30 bg-green-500/5 p-3">
          <p className="text-xs text-green-400 flex items-center gap-1.5 font-medium">
            <Check className="w-3.5 h-3.5" />
            Image generated successfully.
          </p>
          {higgsfieldResult.remoteUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={higgsfieldResult.remoteUrl}
              alt="Higgsfield generated result"
              className="w-full rounded-md border border-border"
            />
          )}
          <p className="text-xs text-muted-foreground break-all">{higgsfieldResult.remoteUrl}</p>
          <Link
            href="/generated-media"
            target="_blank"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View in Generated Media
          </Link>
        </div>
      )}

      {/* Failure */}
      {higgsfieldError && (
        <div className="space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs text-destructive flex items-center gap-1.5 font-medium">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {higgsfieldError.error ?? "Higgsfield image generation failed."}
          </p>
          {higgsfieldError.detail && (
            <p className="text-xs text-muted-foreground">{higgsfieldError.detail}</p>
          )}
          {/credit/i.test(`${higgsfieldError.error ?? ""} ${higgsfieldError.detail ?? ""}`) && (
            <p className="text-xs text-muted-foreground">
              Higgsfield real account credits are insufficient. Your local app tokens were refunded.
              Add credits in Higgsfield Cloud, then try again.
            </p>
          )}
          {higgsfieldError.generatedMedia && (
            <p className="text-xs text-muted-foreground">
              Generation record status: <code className="font-mono">{higgsfieldError.generatedMedia.status}</code>
              {higgsfieldError.generatedMedia.errorMessage && (
                <> — {higgsfieldError.generatedMedia.errorMessage}</>
              )}
            </p>
          )}
          {higgsfieldError.generatedMedia && (
            <Link
              href="/generated-media"
              target="_blank"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View in Generated Media
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
