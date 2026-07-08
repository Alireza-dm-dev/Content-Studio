"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ArrowLeft, Sparkles, Save, Loader2, AlertCircle,
  CheckSquare, Square, ImageIcon, ChevronDown, ChevronUp,
  Clock, Trash2, Palette, MessageSquare, Upload, X,
} from "lucide-react";
import { FILE_PURPOSES } from "@/lib/uploads";
import { normalizeBrandIdentityOutput } from "@/lib/brand-identity-utils";

// ─── helpers ─────────────────────────────────────────────────────────────────

function purposeLabel(slug) {
  return FILE_PURPOSES.find((p) => p.slug === slug)?.label ?? slug;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Two-section toggle (Visual Identity / Tone & Data) ──────────────────────

const SECTIONS = [
  { key: "visual", label: "Visual Identity", icon: Palette },
  { key: "tone", label: "Tone & Data", icon: MessageSquare },
];

function SectionToggle({ active, onChange, size = "default" }) {
  const padding = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-xs";
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
      {SECTIONS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`flex items-center gap-1.5 rounded-md font-medium transition-colors ${padding} ${
            active === key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── File selector grouped by purpose ────────────────────────────────────────

function FileSelectorSection({ files, selectedIds, onChange }) {
  const byPurpose = {};
  for (const f of files) {
    if (!byPurpose[f.purpose]) byPurpose[f.purpose] = [];
    byPurpose[f.purpose].push(f);
  }

  const purposeOrder = FILE_PURPOSES.map((p) => p.slug);
  const orderedPurposes = [
    ...purposeOrder.filter((s) => byPurpose[s]),
    ...Object.keys(byPurpose).filter((s) => !purposeOrder.includes(s)),
  ];

  function togglePurpose(slug) {
    const purposeIds = byPurpose[slug].map((f) => f.id);
    const allSelected = purposeIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) {
      purposeIds.forEach((id) => next.delete(id));
    } else {
      purposeIds.forEach((id) => next.add(id));
    }
    onChange(next);
  }

  function toggleFile(fileId) {
    const next = new Set(selectedIds);
    if (next.has(fileId)) next.delete(fileId);
    else next.add(fileId);
    onChange(next);
  }

  if (files.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 rounded-lg border border-dashed border-border text-muted-foreground">
        <ImageIcon className="w-4 h-4 shrink-0" />
        <p className="text-sm">No files uploaded yet. Upload brand files in the workspace first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orderedPurposes.map((slug) => {
        const purposeFiles = byPurpose[slug];
        const imageFiles = purposeFiles.filter((f) => f.fileType?.startsWith("image/"));
        const allSelected = imageFiles.every((f) => selectedIds.has(f.id));
        const someSelected = imageFiles.some((f) => selectedIds.has(f.id));

        return (
          <div key={slug} className="rounded-lg border border-border overflow-hidden">
            {/* Purpose header */}
            <button
              type="button"
              onClick={() => imageFiles.length > 0 && togglePurpose(slug)}
              disabled={imageFiles.length === 0}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-2">
                {imageFiles.length > 0 ? (
                  allSelected
                    ? <CheckSquare className="w-4 h-4 text-primary" />
                    : someSelected
                      ? <CheckSquare className="w-4 h-4 text-muted-foreground" />
                      : <Square className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground/40" />
                )}
                <span className="text-sm font-medium">{purposeLabel(slug)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {imageFiles.length} image{imageFiles.length !== 1 ? "s" : ""}
                </Badge>
                {someSelected && (
                  <span className="text-xs text-primary">{imageFiles.filter((f) => selectedIds.has(f.id)).length} selected</span>
                )}
              </div>
            </button>

            {/* Image thumbnails */}
            {imageFiles.length > 0 && (
              <div className="flex gap-2 p-3 flex-wrap">
                {imageFiles.map((file) => {
                  const isSel = selectedIds.has(file.id);
                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => toggleFile(file.id)}
                      className={`relative w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors flex-shrink-0 ${
                        isSel ? "border-primary" : "border-border"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={file.filePath} alt={file.fileName} className="w-full h-full object-cover" />
                      {isSel && (
                        <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                          <CheckSquare className="w-4 h-4 text-primary drop-shadow" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Read-only split view of a saved identity (Visual Identity / Tone & Data) ─

function SplitIdentityView({ identity, defaultSection = "visual", compact = false }) {
  const [section, setSection] = useState(defaultSection);
  const { brandVisualIdentity, brandToneInformationAndData } = normalizeBrandIdentityOutput(identity);
  const data = section === "visual" ? brandVisualIdentity : brandToneInformationAndData;

  return (
    <div className="space-y-2">
      <SectionToggle active={section} onChange={setSection} size={compact ? "sm" : "default"} />
      <pre className={`bg-muted rounded-lg p-3 text-xs overflow-auto whitespace-pre-wrap break-words ${compact ? "max-h-40 bg-muted/50 text-muted-foreground" : "max-h-80"}`}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

// ─── Saved Identity (single active + optional history) ───────────────────────

function SavedIdentitySection({ identities, brandId, onDeleted }) {
  const [showHistory, setShowHistory] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [deleting, setDeleting] = useState(null);

  async function handleDelete(identityId) {
    setDeleting(identityId);
    try {
      const res = await fetch(`/api/brands/${brandId}/identity?identityId=${identityId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      onDeleted(identityId);
      toast.success("Identity deleted.");
    } catch {
      toast.error("Failed to delete.");
    } finally {
      setDeleting(null);
    }
  }

  if (identities.length === 0) return null;

  const current = identities[0];
  const history = identities.slice(1);

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" />Saved Identity
      </p>

      {/* Active identity */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-primary">Active</span>
            <span className="text-xs text-muted-foreground">{formatDate(current.createdAt)}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleDelete(current.id)}
              disabled={deleting === current.id}
              className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(v => !v)}
              className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>
        {!collapsed && (
          <div className="px-4 pb-4 pt-3 border-t border-border">
            <SplitIdentityView identity={current} />
          </div>
        )}
      </div>

      {/* History — only shown if there are older extractions */}
      {history.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showHistory ? "Hide" : "Show"} {history.length} older extraction{history.length > 1 ? "s" : ""}
          </button>
          {showHistory && (
            <div className="mt-2 space-y-2">
              {history.map((identity) => (
                <div key={identity.id} className="rounded-lg border border-border/50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-muted/20">
                    <span className="text-xs text-muted-foreground">{formatDate(identity.createdAt)}</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(identity.id)}
                      disabled={deleting === identity.id}
                      className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="px-4 pb-3 pt-2 border-t border-border/50">
                    <SplitIdentityView identity={identity} compact />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExtractIdentityClient({ brand, uploadedFiles, existingIdentities }) {
  const router = useRouter();

  // Pre-select all image files
  const allImageIds = new Set(
    uploadedFiles.filter((f) => f.fileType?.startsWith("image/")).map((f) => f.id)
  );
  const [selectedIds, setSelectedIds] = useState(allImageIds);
  const [manualNotes, setManualNotes] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);       // raw result from API
  const [activeResultSection, setActiveResultSection] = useState("visual");
  const [editedVisualJson, setEditedVisualJson] = useState("");
  const [editedToneJson, setEditedToneJson] = useState("");
  const [visualParseError, setVisualParseError] = useState(null);
  const [toneParseError, setToneParseError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [identities, setIdentities] = useState(existingIdentities);
  const [feedback, setFeedback] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [resultSource, setResultSource] = useState(null); // "extract" | "regenerate"
  const [submittedFeedback, setSubmittedFeedback] = useState("");
  const [regenerationFiles, setRegenerationFiles] = useState([]);
  const [uploadingRegenFiles, setUploadingRegenFiles] = useState(false);
  const regenFileInputRef = useRef(null);

  const logoFiles = uploadedFiles.filter((f) => f.purpose === "brand-logo");
  const hasLogo = logoFiles.length > 0;

  function resetResultState() {
    setResult(null);
    setEditedVisualJson("");
    setEditedToneJson("");
    setVisualParseError(null);
    setToneParseError(null);
    setActiveResultSection("visual");
    setResultSource(null);
    setSubmittedFeedback("");
  }

  async function handleExtract() {
    setRunning(true);
    resetResultState();

    try {
      const res = await fetch(`/api/brands/${brand.id}/extract-identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedFileIds: [...selectedIds],
          manualNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Extraction failed.");
      setResult(data);
      setResultSource("extract");

      // Split the AI output into the two sections so each can be reviewed/edited separately
      const contentJsonString = typeof data.content === "object"
        ? JSON.stringify(data.content)
        : (data.content ?? "");
      const { brandVisualIdentity, brandToneInformationAndData } =
        normalizeBrandIdentityOutput({ jsonOutput: contentJsonString });

      setEditedVisualJson(JSON.stringify(brandVisualIdentity, null, 2));
      setEditedToneJson(JSON.stringify(brandToneInformationAndData, null, 2));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  }

  async function handleRegenUpload(e) {
    const selected = Array.from(e.target.files ?? []);
    if (!selected.length) return;
    setUploadingRegenFiles(true);
    const added = [];
    for (const file of selected) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("purpose", "reference-image");
      try {
        const res = await fetch(`/api/brands/${brand.id}/files`, { method: "POST", body: fd });
        if (!res.ok) {
          const err = await res.json();
          toast.error(`${file.name}: ${err.error ?? "Upload failed"}`);
        } else {
          added.push(await res.json());
        }
      } catch {
        toast.error(`${file.name}: Upload failed`);
      }
    }
    if (added.length) {
      setRegenerationFiles((prev) => [...prev, ...added]);
      toast.success(`${added.length} reference image${added.length > 1 ? "s" : ""} added.`);
    }
    setUploadingRegenFiles(false);
    if (regenFileInputRef.current) regenFileInputRef.current.value = "";
  }

  function removeRegenFile(fileId) {
    setRegenerationFiles((prev) => prev.filter((f) => f.id !== fileId));
  }

  async function handleRegenerate() {
    const hasFeedback = feedback.trim().length > 0;
    const hasImages = regenerationFiles.length > 0;
    if (!hasFeedback && !hasImages) {
      return toast.error("Enter feedback or upload reference images.");
    }
    setRegenerating(true);
    resetResultState();

    try {
      const res = await fetch(`/api/brands/${brand.id}/regenerate-identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback,
          referenceImageIds: regenerationFiles.map((f) => f.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Regeneration failed.");
      setResult(data);
      setResultSource("regenerate");
      setSubmittedFeedback(feedback.trim());

      // Split the AI output into the two sections so each can be reviewed/edited separately
      const contentJsonString = typeof data.content === "object"
        ? JSON.stringify(data.content)
        : (data.content ?? "");
      const { brandVisualIdentity, brandToneInformationAndData } =
        normalizeBrandIdentityOutput({ jsonOutput: contentJsonString });

      setEditedVisualJson(JSON.stringify(brandVisualIdentity, null, 2));
      setEditedToneJson(JSON.stringify(brandToneInformationAndData, null, 2));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRegenerating(false);
    }
  }

  function handleVisualEdit(val) {
    setEditedVisualJson(val);
    try {
      JSON.parse(val);
      setVisualParseError(null);
    } catch {
      setVisualParseError("Invalid JSON — fix before saving.");
    }
  }

  function handleToneEdit(val) {
    setEditedToneJson(val);
    try {
      JSON.parse(val);
      setToneParseError(null);
    } catch {
      setToneParseError("Invalid JSON — fix before saving.");
    }
  }

  async function handleSave() {
    if (visualParseError || toneParseError) {
      return toast.error("Fix the JSON errors before saving.");
    }
    setSaving(true);
    try {
      const combined = {
        brandVisualIdentity: JSON.parse(editedVisualJson || "{}"),
        brandToneInformationAndData: JSON.parse(editedToneJson || "{}"),
      };
      const res = await fetch(`/api/brands/${brand.id}/identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonOutput: JSON.stringify(combined, null, 2) }),
      });
      if (!res.ok) throw new Error();
      const saved = await res.json();
      setIdentities((prev) => [saved, ...prev]);
      resetResultState();
      toast.success("Brand Identity saved.");
      router.refresh();
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  function handleIdentityDeleted(id) {
    setIdentities((prev) => prev.filter((i) => i.id !== id));
  }

  const selectedImageCount = uploadedFiles.filter(
    (f) => f.fileType?.startsWith("image/") && selectedIds.has(f.id)
  ).length;

  const activeJson = activeResultSection === "visual" ? editedVisualJson : editedToneJson;
  const activeError = activeResultSection === "visual" ? visualParseError : toneParseError;
  const activeOnChange = activeResultSection === "visual" ? handleVisualEdit : handleToneEdit;
  const hasAnyParseError = !!visualParseError || !!toneParseError;

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/brand-workspace?brandId=${brand.id}`}>
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Extract Brand Visual Identity</h1>
          <p className="text-sm text-muted-foreground">{brand.name}</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Brand info summary */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Brand Information</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/brands/${brand.id}`}>Edit</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {[
                { label: "Name", value: brand.name, required: true },
                { label: "Business Type", value: brand.businessType },
                { label: "Location", value: brand.businessLocation },
                { label: "Website", value: brand.website },
                { label: "Instagram", value: brand.instagramPage },
                { label: "Brand Tone", value: brand.brandTone },
                { label: "Visual Style", value: brand.brandVisualStyle },
                { label: "Target Audience", value: brand.targetAudience },
              ].map(({ label, value, required }) => (
                <div key={label} className="flex items-start gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground shrink-0 w-28">{label}</span>
                  {value ? (
                    <span className="text-xs truncate">{value}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground/50 italic">
                      {required ? "Required — add in Edit" : "Not set"}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Logo warning */}
            {!hasLogo && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 mt-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  No logo uploaded. Upload a brand logo in the workspace for best results.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* File selector */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Files to Analyse</CardTitle>
              <span className="text-xs text-muted-foreground">
                {selectedImageCount} image{selectedImageCount !== 1 ? "s" : ""} selected
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <FileSelectorSection
              files={uploadedFiles}
              selectedIds={selectedIds}
              onChange={setSelectedIds}
            />
          </CardContent>
        </Card>

        {/* Manual notes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Manual Notes <span className="font-normal text-muted-foreground">(optional)</span></CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
              placeholder="Add any extra context for the AI: brand values, competitor references, visual preferences, dos and don'ts, specific goals..."
              rows={4}
            />
          </CardContent>
        </Card>

        {/* Extract button */}
        <Button
          onClick={handleExtract}
          disabled={running || regenerating}
          className="w-full gap-2"
          size="lg"
        >
          {running ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Extracting Brand Identity…</>
          ) : (
            <><Sparkles className="w-4 h-4" />Extract Brand Visual Identity{selectedImageCount > 0 ? ` (${selectedImageCount} image${selectedImageCount > 1 ? "s" : ""})` : ""}</>
          )}
        </Button>

        {/* Regenerate with feedback — only when an identity already exists */}
        {identities.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                <CardTitle className="text-sm">Regenerate with Feedback</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Describe what should change about the current brand identity and/or upload reference
                images — then regenerate. The result will appear below for review and editing before
                saving.
              </p>
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="e.g. Make the tone more premium. Use less red and a more minimal visual style."
                rows={3}
              />

              {/* Reference image upload */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Reference Images <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    disabled={uploadingRegenFiles || regenerating}
                    onClick={() => regenFileInputRef.current?.click()}
                  >
                    {uploadingRegenFiles ? (
                      <><Loader2 className="w-3 h-3 animate-spin" />Uploading…</>
                    ) : (
                      <><Upload className="w-3 h-3" />Upload</>
                    )}
                  </Button>
                  <input
                    ref={regenFileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleRegenUpload}
                  />
                </div>

                {regenerationFiles.length > 0 ? (
                  <div className="flex gap-2 flex-wrap">
                    {regenerationFiles.map((file) => (
                      <div
                        key={file.id}
                        className="relative w-16 h-16 rounded-lg overflow-hidden border border-border group"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={file.filePath} alt={file.fileName} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeRegenFile(file.id)}
                          className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    onClick={() => !uploadingRegenFiles && !regenerating && regenFileInputRef.current?.click()}
                    className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors cursor-pointer"
                  >
                    <ImageIcon className="w-4 h-4 shrink-0" />
                    <p className="text-xs">Upload reference images to guide the visual identity regeneration.</p>
                  </div>
                )}
              </div>

              <Button
                onClick={handleRegenerate}
                disabled={running || regenerating || uploadingRegenFiles}
                variant="outline"
                className="w-full gap-2"
              >
                {regenerating ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Regenerating Brand Identity…</>
                ) : (
                  <><Sparkles className="w-4 h-4" />Regenerate Brand Identity{regenerationFiles.length > 0 ? ` (${regenerationFiles.length} image${regenerationFiles.length > 1 ? "s" : ""})` : ""}</>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Result */}
        {result && (
          <>
            <Separator />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">AI Output — Review before saving</h2>
                  {resultSource === "regenerate" && (
                    <Badge variant="secondary" className="text-xs">Regenerated draft — review before saving</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {result.usage && (
                    <span className="text-xs text-muted-foreground">
                      {result.usage.total_tokens} tokens
                    </span>
                  )}
                  <Badge variant="outline" className="text-xs">{result.model}</Badge>
                  {result.imagesUsed > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {result.imagesUsed} image{result.imagesUsed > 1 ? "s" : ""} analysed
                    </Badge>
                  )}
                </div>
              </div>

              {resultSource === "regenerate" && submittedFeedback && (
                <div className="rounded-md bg-muted/50 border border-border px-3 py-2 text-xs">
                  <span className="font-medium text-foreground">Requested changes: </span>
                  <span className="text-muted-foreground">{submittedFeedback}</span>
                </div>
              )}

              {result.unreplacedVariables?.length > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  Unreplaced template variables: {result.unreplacedVariables.map((v) => `{{${v}}}`).join(", ")}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                The brand identity is split into two sections — review and edit each separately.
                Both are saved together when you click Save. Saving creates a new active brand
                identity — the previous identity remains in history unless deleted.
              </p>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <SectionToggle active={activeResultSection} onChange={setActiveResultSection} />
                  {activeError && (
                    <span className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />{activeError}
                    </span>
                  )}
                </div>
                <Label className="text-xs text-muted-foreground">
                  {activeResultSection === "visual"
                    ? "Visual Identity JSON — colors, typography, logo, layout, image/video style, visual mood, do/don't rules"
                    : "Tone & Data JSON — brand name, industry, audience, personality, tone of voice, content style, goals, offers, contact info"}
                </Label>
                <Textarea
                  key={activeResultSection}
                  value={activeJson}
                  onChange={(e) => activeOnChange(e.target.value)}
                  className="font-mono text-xs min-h-[320px] resize-y"
                  spellCheck={false}
                />
              </div>

              <Button
                onClick={handleSave}
                disabled={saving || hasAnyParseError || (!editedVisualJson && !editedToneJson)}
                className="w-full gap-2"
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
                ) : (
                  <><Save className="w-4 h-4" />Save Brand Identity</>
                )}
              </Button>
            </div>
          </>
        )}

        {/* Saved identity */}
        {identities.length > 0 && (
          <>
            <Separator />
            <SavedIdentitySection
              identities={identities}
              brandId={brand.id}
              onDeleted={handleIdentityDeleted}
            />
          </>
        )}
      </div>
    </div>
  );
}
