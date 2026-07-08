"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload, ImageIcon, Loader2, Check, RefreshCw, X, AlertCircle, ChevronDown, ChevronUp,
} from "lucide-react";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * ReferenceImageUploader
 *
 * Props:
 *   sourceFlow          "create_image_reference_mode" | "calendar_post_image_creation"
 *   brandId?            string
 *   calendarId?         string
 *   calendarPostId?     string
 *   onAnalysisApproved  ({ id, analysisJson, editedJson, imageUrl }) => void
 *   onAnalysisSaved?    ({ id, editedJson }) => void
 *   onClose?            () => void
 */
export default function ReferenceImageUploader({
  sourceFlow = "create_image_reference_mode",
  brandId,
  calendarId,
  calendarPostId,
  onAnalysisApproved,
  onAnalysisSaved,
  onClose,
}) {
  const inputRef = useRef(null);

  // File + preview
  const [file, setFile]         = useState(null);
  const [previewUrl, setPreview] = useState(null);

  // API states
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [approving, setApproving] = useState(false);

  // Result
  const [analysis, setAnalysis]       = useState(null); // { id, imageUrl, analysisJson, ... }
  const [jsonText, setJsonText]       = useState("");
  const [jsonError, setJsonError]     = useState(null);

  // Focus / emphasis
  const [focusInstruction, setFocusInstruction] = useState("");

  // UI
  const [collapsed, setCollapsed] = useState(false);
  const [fileError, setFileError] = useState(null);

  // ── File selection ──────────────────────────────────────────────────────────
  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    selectFile(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) selectFile(f);
  }

  function selectFile(f) {
    setFileError(null);
    setAnalysis(null);
    setJsonText("");
    setJsonError(null);

    if (!ALLOWED_TYPES.includes(f.type)) {
      setFileError("Please upload a JPG, PNG, or WEBP image under 10MB.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError("Please upload a JPG, PNG, or WEBP image under 10MB.");
      return;
    }

    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  // ── Analyze ─────────────────────────────────────────────────────────────────
  async function handleAnalyze(imageFileOverride) {
    const imageFile = imageFileOverride || file;
    if (!imageFile) return;

    setAnalyzing(true);
    setAnalysis(null);
    setJsonText("");
    setJsonError(null);

    try {
      const fd = new FormData();
      fd.append("image", imageFile);
      fd.append("sourceFlow", sourceFlow);
      if (brandId)       fd.append("brandId", brandId);
      if (calendarId)    fd.append("calendarId", calendarId);
      if (calendarPostId) fd.append("calendarPostId", calendarPostId);
      if (focusInstruction.trim()) fd.append("focusInstruction", focusInstruction.trim());

      const res  = await fetch("/api/reference-image/analyze", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({ success: false, error: "Invalid server response." }));

      if (!data.success) {
        toast.error(data.error ?? "Analysis failed.");
        return;
      }

      const ria = data.referenceImageAnalysis;
      setAnalysis(ria);
      setJsonText(JSON.stringify(ria.analysisJson, null, 2));
      toast.success("Image analyzed. Review and approve the result.");
    } catch (err) {
      console.error("[ReferenceImageUploader] analyze error:", err);
      toast.error("Analysis failed. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Validate JSON text ──────────────────────────────────────────────────────
  function parseJsonText() {
    try {
      return { ok: true, parsed: JSON.parse(jsonText) };
    } catch {
      return { ok: false };
    }
  }

  function handleJsonChange(v) {
    setJsonText(v);
    setJsonError(null);
  }

  // ── Save edited JSON ────────────────────────────────────────────────────────
  async function handleSave() {
    const { ok, parsed } = parseJsonText();
    if (!ok) { setJsonError("Invalid JSON. Fix the syntax before saving."); return; }

    setSaving(true);
    try {
      const res  = await fetch(`/api/reference-image/analysis/${analysis.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editedJson: parsed, status: "draft" }),
      });
      const data = await res.json().catch(() => ({ success: false, error: "Invalid server response." }));

      if (!data.success) { toast.error(data.error ?? "Save failed."); return; }

      setAnalysis(prev => ({ ...prev, editedJson: parsed, status: "draft" }));
      onAnalysisSaved?.({ id: analysis.id, editedJson: parsed });
      toast.success("Analysis saved.");
    } catch (err) {
      console.error("[ReferenceImageUploader] save error:", err);
      toast.error("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Approve ─────────────────────────────────────────────────────────────────
  async function handleApprove() {
    const { ok, parsed } = parseJsonText();
    if (!ok) { setJsonError("Invalid JSON. Fix the syntax before approving."); return; }

    setApproving(true);
    try {
      const original  = JSON.stringify(analysis.analysisJson, null, 2);
      const isEdited  = jsonText.trim() !== original.trim();
      const body      = { status: "approved", ...(isEdited ? { editedJson: parsed } : {}) };

      const res  = await fetch(`/api/reference-image/analysis/${analysis.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ success: false, error: "Invalid server response." }));

      if (!data.success) { toast.error(data.error ?? "Approval failed."); return; }

      const ria = data.referenceImageAnalysis;
      setAnalysis(prev => ({ ...prev, status: "approved" }));
      toast.success("Reference image analysis approved.");
      onAnalysisApproved?.({
        id:          ria.id,
        imageUrl:    ria.imageUrl ?? analysis.imageUrl,
        analysisJson: ria.editedJson ?? ria.analysisJson,
        editedJson:  ria.editedJson,
      });
    } catch (err) {
      console.error("[ReferenceImageUploader] approve error:", err);
      toast.error("Approval failed. Please try again.");
    } finally {
      setApproving(false);
    }
  }

  // ── Reset ────────────────────────────────────────────────────────────────────
  function handleReset() {
    setFile(null);
    setPreview(null);
    setAnalysis(null);
    setJsonText("");
    setJsonError(null);
    setFileError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const isApproved = analysis?.status === "approved";

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">Reference Image</span>
          {isApproved && (
            <Badge variant="default" className="text-xs gap-1">
              <Check className="w-2.5 h-2.5" />Approved
            </Badge>
          )}
          {analysis && !isApproved && (
            <Badge variant="secondary" className="text-xs">Analyzed — pending approval</Badge>
          )}
        </div>
        {collapsed
          ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
          : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="p-4 space-y-4 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Upload a reference image so AI can extract its visual style, composition, lighting, colors, and reusable generation details.
          </p>

          {/* ── Upload zone ── */}
          {!analysis && (
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              className="rounded-lg border-2 border-dashed border-border hover:border-primary/40 transition-colors"
            >
              <label className="flex flex-col items-center justify-center gap-3 py-8 cursor-pointer">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <Upload className="w-5 h-5 text-muted-foreground" />
                </div>
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="max-h-40 max-w-full rounded-lg object-contain"
                  />
                ) : (
                  <div className="text-center">
                    <p className="text-sm font-medium">Click to upload or drag and drop</p>
                    <p className="text-xs text-muted-foreground mt-0.5">JPG, PNG, WEBP — max 10 MB</p>
                  </div>
                )}
                {file && !previewUrl && (
                  <p className="text-xs text-muted-foreground">{file.name}</p>
                )}
                {file && previewUrl && (
                  <p className="text-xs text-muted-foreground">{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            </div>
          )}

          {/* File validation error */}
          {fileError && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />{fileError}
            </div>
          )}

          {/* Focus instruction (before analysis) */}
          {file && !analysis && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground block">
                What should AI focus on from this image?
                <span className="ml-1 font-normal text-muted-foreground/60">(optional)</span>
              </label>
              <Textarea
                value={focusInstruction}
                onChange={e => setFocusInstruction(e.target.value)}
                placeholder="Focus on the composition, color palette, and headline style."
                rows={2}
                className="text-xs resize-y"
              />
              <p className="text-xs text-muted-foreground/60">
                Tell AI which parts of the image matter most for extraction and final output.
              </p>
            </div>
          )}

          {/* Analyze button (before result) */}
          {file && !analysis && (
            <Button
              onClick={() => handleAnalyze()}
              disabled={analyzing}
              size="sm"
              className="gap-2"
            >
              {analyzing
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Analyzing image…</>
                : <><ImageIcon className="w-3.5 h-3.5" />Analyze Image</>}
            </Button>
          )}

          {/* ── Result panel ── */}
          {analysis && (
            <div className="space-y-4">
              {/* Image + status */}
              <div className="flex items-start gap-3">
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt="Reference"
                    className="w-20 h-20 rounded-lg object-cover border border-border shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">Reference Image Analysis</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {file?.name} · {isApproved ? "Approved" : "Review and edit before approving"}
                  </p>
                  {isApproved && (
                    <Badge variant="default" className="mt-1.5 text-xs gap-1">
                      <Check className="w-2.5 h-2.5" />Analysis approved — will be used in prompt generation
                    </Badge>
                  )}
                </div>
              </div>

              {/* JSON editor */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground block">
                  Extracted JSON {isApproved && "(read-only after approval)"}
                </label>
                <Textarea
                  value={jsonText}
                  onChange={e => handleJsonChange(e.target.value)}
                  rows={14}
                  className="font-mono text-xs resize-y"
                  spellCheck={false}
                  readOnly={isApproved}
                />
                {jsonError && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />{jsonError}
                  </p>
                )}
              </div>

              {/* Action buttons */}
              {!isApproved && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={handleApprove}
                    disabled={approving || saving}
                    className="gap-1.5"
                  >
                    {approving
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Approving…</>
                      : <><Check className="w-3.5 h-3.5" />Approve Analysis</>}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || approving}
                    className="gap-1.5"
                  >
                    {saving
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</>
                      : "Save Edited Analysis"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleAnalyze(file)}
                    disabled={analyzing || saving || approving}
                    className="gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />Reanalyze
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReset}
                    disabled={analyzing || saving || approving}
                    className="gap-1.5 text-muted-foreground"
                  >
                    <X className="w-3.5 h-3.5" />Cancel
                  </Button>
                </div>
              )}

              {/* Post-approval: allow reset */}
              {isApproved && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    className="gap-1.5 text-muted-foreground"
                  >
                    <X className="w-3.5 h-3.5" />Remove Reference Image
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
