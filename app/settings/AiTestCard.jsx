"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Play, Loader2, AlertCircle, ChevronDown, ImageIcon, CheckSquare, Square } from "lucide-react";
import { extractVariables, isPlaceholder } from "@/lib/template-utils";
import { TEMPLATE_VARIABLES } from "@/lib/template-variables";

const CATEGORY_ORDER = ["brand", "image", "video", "content", "calendar"];

// ─── Template-specific sections ──────────────────────────────────────────────

/**
 * Case 1: Brand Visual Identity Extractor
 * Shows brand selector + image grid with checkboxes.
 * Calls onImagesChange([{ filePath, mediaType }]) when selection changes.
 */
function BrandImageSelector({ onImagesChange }) {
  const [brands, setBrands] = useState([]);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loadingFiles, setLoadingFiles] = useState(false);

  useEffect(() => {
    fetch("/api/brands").then((r) => r.json()).then(setBrands).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedBrandId) return;
    fetch(`/api/brands/${selectedBrandId}/files`)
      .then((r) => r.json())
      .then((data) => {
        const imageFiles = data.filter((f) => f.fileType?.startsWith("image/"));
        setFiles(imageFiles);
        // Pre-select all
        const all = new Set(imageFiles.map((f) => f.id));
        setSelected(all);
        onImagesChange(imageFiles.map((f) => ({ filePath: f.filePath, mediaType: f.fileType })));
      })
      .catch(() => {})
      .finally(() => setLoadingFiles(false));
  }, [selectedBrandId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleFile(file) {
    const next = new Set(selected);
    if (next.has(file.id)) next.delete(file.id);
    else next.add(file.id);
    setSelected(next);
    const selectedFiles = files.filter((f) => next.has(f.id));
    onImagesChange(selectedFiles.map((f) => ({ filePath: f.filePath, mediaType: f.fileType })));
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/30">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Vision Input — Brand Screenshots</p>
      <div className="space-y-1.5">
        <Label>Select Brand</Label>
        <div className="relative">
          <select
            value={selectedBrandId}
            onChange={(e) => {
              const id = e.target.value;
              setSelectedBrandId(id);
              if (id) setLoadingFiles(true);
            }}
            className="w-full appearance-none h-9 rounded-md border border-input bg-background px-3 py-1 pr-8 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Choose a brand…</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {selectedBrandId && (
        loadingFiles ? (
          <p className="text-xs text-muted-foreground">Loading images…</p>
        ) : files.length === 0 ? (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <ImageIcon className="w-4 h-4" />
            No images uploaded for this brand yet. Upload them in the Brand edit page.
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Select images to include ({selected.size}/{files.length})</Label>
              <button
                type="button"
                onClick={() => {
                  if (selected.size === files.length) {
                    setSelected(new Set());
                    onImagesChange([]);
                  } else {
                    const all = new Set(files.map((f) => f.id));
                    setSelected(all);
                    onImagesChange(files.map((f) => ({ filePath: f.filePath, mediaType: f.fileType })));
                  }
                }}
                className="text-xs text-primary hover:underline"
              >
                {selected.size === files.length ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {files.map((file) => {
                const isSelected = selected.has(file.id);
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => toggleFile(file)}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                      isSelected ? "border-primary" : "border-border"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={file.filePath} alt={file.fileName} className="w-full h-full object-cover" />
                    <div className={`absolute top-1 right-1 ${isSelected ? "text-primary" : "text-muted-foreground/60"}`}>
                      {isSelected
                        ? <CheckSquare className="w-4 h-4 bg-background rounded" />
                        : <Square className="w-4 h-4 bg-background/60 rounded" />}
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-1 py-0.5">
                      <p className="text-white text-xs truncate">{file.purpose?.replace(/-/g, " ")}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            {selected.size === 0 && (
              <p className="text-xs text-amber-600">Select at least one image to include in the prompt.</p>
            )}
          </div>
        )
      )}
    </div>
  );
}

/**
 * Reusable brand selector that fills different variable sets depending on mode:
 *   "identity" — fills brandVisualStyle, brandTone, brandIdentitySummary
 *   "basic"    — fills brandName, brandTone, targetAudience
 */
function BrandFillSection({ onFill, mode = "basic" }) {
  const [brands, setBrands] = useState([]);
  const [brandIdentities, setBrandIdentities] = useState([]);
  const [selectedBrandId, setSelectedBrandId] = useState("");

  useEffect(() => {
    fetch("/api/brands").then((r) => r.json()).then(setBrands).catch(() => {});
    if (mode === "identity") {
      fetch("/api/brand-identities").then((r) => r.json()).then(setBrandIdentities).catch(() => {});
    }
  }, [mode]);

  function handleBrandChange(brandId) {
    setSelectedBrandId(brandId);
    if (!brandId) return;
    const brand = brands.find((b) => b.id === brandId);
    if (!brand) return;

    if (mode === "identity") {
      const identity = brandIdentities.find((bi) => bi.brandId === brandId);
      const summary = identity?.editableSummary
        || (identity?.jsonOutput ?? null)
        || `Brand: ${brand.name}. Type: ${brand.businessType ?? ""}. Tone: ${brand.brandTone ?? ""}. Visual style: ${brand.brandVisualStyle ?? ""}. Target audience: ${brand.targetAudience ?? ""}.`;
      onFill({
        brandVisualStyle: brand.brandVisualStyle ?? "",
        brandTone: brand.brandTone ?? "",
        brandIdentitySummary: summary,
      });
    } else {
      // mode === "basic"
      onFill({
        brandName: brand.name ?? "",
        brandTone: brand.brandTone ?? "",
        targetAudience: brand.targetAudience ?? "",
      });
    }
  }

  const filledFields = mode === "identity"
    ? ["brandVisualStyle", "brandTone", "brandIdentitySummary"]
    : ["brandName", "brandTone", "targetAudience"];

  return (
    <div className="space-y-2 rounded-lg border border-border p-4 bg-muted/30">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Auto-fill from Brand</p>
      <div className="space-y-1.5">
        <Label>Select Brand</Label>
        <div className="relative">
          <select
            value={selectedBrandId}
            onChange={(e) => handleBrandChange(e.target.value)}
            className="w-full appearance-none h-9 rounded-md border border-input bg-background px-3 py-1 pr-8 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Choose a brand…</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
        </div>
        <p className="text-xs text-muted-foreground">
          Fills{" "}
          {filledFields.map((f, i) => (
            <span key={f}>
              <code className="font-mono">{f}</code>
              {i < filledFields.length - 1 ? ", " : ""}
            </span>
          ))}{" "}
          from the selected brand.
          {mode === "identity" && brandIdentities.length === 0 && " (No saved Brand Identities — using basic fields.)"}
        </p>
      </div>
    </div>
  );
}

/**
 * Case 3: Image Reference & Brand Identity Combiner
 * Two selectors: BrandIdentity + ReferenceImageAnalysis.
 * Fills brandIdentitySummary and referenceImageAnalysis in variables.
 */
function CombinerSourceSection({ onFill }) {
  const [brandIdentities, setBrandIdentities] = useState([]);
  const [refAnalyses, setRefAnalyses] = useState([]);
  const [loadingBi, setLoadingBi] = useState(true);
  const [loadingRa, setLoadingRa] = useState(true);
  const [selectedBiId, setSelectedBiId] = useState("");
  const [selectedRaId, setSelectedRaId] = useState("");

  useEffect(() => {
    fetch("/api/brand-identities")
      .then((r) => r.json()).then(setBrandIdentities).catch(() => {}).finally(() => setLoadingBi(false));
    fetch("/api/reference-analyses")
      .then((r) => r.json()).then(setRefAnalyses).catch(() => {}).finally(() => setLoadingRa(false));
  }, []);

  function handleBiChange(id) {
    setSelectedBiId(id);
    emitFill(id, selectedRaId);
  }

  function handleRaChange(id) {
    setSelectedRaId(id);
    emitFill(selectedBiId, id);
  }

  function emitFill(biId, raId) {
    const bi = brandIdentities.find((b) => b.id === biId);
    const ra = refAnalyses.find((r) => r.id === raId);
    if (!bi && !ra) return;
    const fills = {};
    if (bi) {
      fills.brandIdentitySummary = bi.editableSummary || bi.jsonOutput || `Brand: ${bi.brand?.name}`;
    }
    if (ra) {
      fills.referenceImageAnalysis = ra.jsonOutput || "";
    }
    onFill(fills);
  }

  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString() : "";

  return (
    <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/30">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Source Data</p>

      {/* Brand Identity */}
      <div className="space-y-1.5">
        <Label>Brand Identity</Label>
        {loadingBi ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : brandIdentities.length === 0 ? (
          <p className="text-xs text-amber-600">
            No saved Brand Identities yet. Run the <strong>Brand Visual Identity Extractor</strong> template first and save the result.
          </p>
        ) : (
          <div className="relative">
            <select
              value={selectedBiId}
              onChange={(e) => handleBiChange(e.target.value)}
              className="w-full appearance-none h-9 rounded-md border border-input bg-background px-3 py-1 pr-8 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Choose a brand identity…</option>
              {brandIdentities.map((bi) => (
                <option key={bi.id} value={bi.id}>
                  {bi.brand?.name ?? "Unknown brand"} — {fmt(bi.createdAt)}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
        )}
      </div>

      {/* Reference Image Analysis */}
      <div className="space-y-1.5">
        <Label>Reference Image Analysis</Label>
        {loadingRa ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : refAnalyses.length === 0 ? (
          <p className="text-xs text-amber-600">
            No saved Reference Image Analyses yet. Run the <strong>Reference Image Information Extractor</strong> template first and save the result.
          </p>
        ) : (
          <div className="relative">
            <select
              value={selectedRaId}
              onChange={(e) => handleRaChange(e.target.value)}
              className="w-full appearance-none h-9 rounded-md border border-input bg-background px-3 py-1 pr-8 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Choose a reference analysis…</option>
              {refAnalyses.map((ra) => (
                <option key={ra.id} value={ra.id}>
                  {ra.brand?.name ?? "No brand"} — {ra.uploadedFile?.fileName ?? "unknown file"} — {fmt(ra.createdAt)}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main AiTestCard ──────────────────────────────────────────────────────────

export default function AiTestCard() {
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [prevSelectedSlug, setPrevSelectedSlug] = useState("");
  const [variablesJson, setVariablesJson] = useState("{}");
  const [jsonError, setJsonError] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  // Vision: selected images for brand-visual-identity-extractor
  const [selectedImages, setSelectedImages] = useState([]);

  useEffect(() => {
    fetch("/api/prompt-templates")
      .then((r) => r.json())
      .then((data) => {
        setTemplates(data);
        if (data.length > 0) setSelectedSlug(data[0].slug);
      })
      .catch(() => toast.error("Failed to load templates."))
      .finally(() => setLoadingTemplates(false));
  }, []);

  const selected = templates.find((t) => t.slug === selectedSlug) ?? null;
  const knownMeta = selectedSlug ? TEMPLATE_VARIABLES[selectedSlug] : null;

  // When template changes, rebuild variables JSON from known map or extracted vars
  // and reset result/error/prompt-visibility/selected-images.
  if (selectedSlug !== prevSelectedSlug) {
    setPrevSelectedSlug(selectedSlug);

    if (selected) {
      const skeleton =
        knownMeta?.variables ??
        Object.fromEntries(extractVariables(selected.templateText).map((v) => [v, ""]));
      setVariablesJson(JSON.stringify(skeleton, null, 2));
    }

    setResult(null);
    setError(null);
    setShowPrompt(false);
    setSelectedImages([]);
  }

  // Merge fills from template-specific inputs into variables JSON
  function mergeVariables(fills) {
    try {
      const current = JSON.parse(variablesJson);
      const merged = { ...current, ...fills };
      setVariablesJson(JSON.stringify(merged, null, 2));
      setJsonError(null);
    } catch {
      // If current JSON is broken, just replace with fills
      setVariablesJson(JSON.stringify(fills, null, 2));
      setJsonError(null);
    }
  }

  function handleJsonChange(e) {
    setVariablesJson(e.target.value);
    try { JSON.parse(e.target.value); setJsonError(null); }
    catch { setJsonError("Invalid JSON"); }
  }

  async function handleRun() {
    if (jsonError) return toast.error("Fix the JSON error first.");
    let variables;
    try { variables = JSON.parse(variablesJson); }
    catch { return toast.error("Invalid JSON in variables."); }

    if (selectedSlug === "brand-visual-identity-extractor" && selectedImages.length === 0) {
      return toast.error("Select at least one brand image to include.");
    }

    setRunning(true);
    setResult(null);
    setError(null);

    try {
      const body = {
        templateSlug: selectedSlug,
        variables,
        ...(selectedImages.length > 0 ? { images: selectedImages } : {}),
      };
      const res = await fetch("/api/generate/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed.");
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const detectedVars = selected
    ? extractVariables(selected.templateText).length > 0
      ? extractVariables(selected.templateText)
      : Object.keys(knownMeta?.variables ?? {})
    : [];
  const templateIsPlaceholder = selected ? isPlaceholder(selected.templateText) : false;

  // Group templates
  const groups = {};
  for (const tpl of templates) {
    const cat = tpl.category ?? "other";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(tpl);
  }
  const orderedCats = [
    ...CATEGORY_ORDER.filter((c) => groups[c]),
    ...Object.keys(groups).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI Test</CardTitle>
        <CardDescription className="text-xs">
          Select a template, fill in variables, and run a live generation against OpenAI.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* Template selector */}
        <div className="space-y-1.5">
          <Label>Template</Label>
          {loadingTemplates ? (
            <p className="text-sm text-muted-foreground">Loading templates…</p>
          ) : (
            <div className="relative">
              <select
                value={selectedSlug}
                onChange={(e) => setSelectedSlug(e.target.value)}
                className="w-full appearance-none h-9 rounded-md border border-input bg-background px-3 py-1 pr-8 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {orderedCats.map((cat) => (
                  <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                    {groups[cat].map((tpl) => (
                      <option key={tpl.slug} value={tpl.slug}>{tpl.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          )}
          {selected && (
            <div className="space-y-1.5 mt-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">{selected.slug}</code>
                {selected.category && <Badge variant="secondary" className="text-xs capitalize">{selected.category}</Badge>}
                {selected.outputType && <Badge variant="outline" className="text-xs">output: {selected.outputType}</Badge>}
                {templateIsPlaceholder && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">
                    placeholder — edit in Prompt Library first
                  </Badge>
                )}
              </div>
              {knownMeta?.description && (
                <p className="text-xs text-muted-foreground">{knownMeta.description}</p>
              )}
            </div>
          )}
        </div>

        {/* ── Template-specific input sections ── */}
        {selectedSlug === "brand-visual-identity-extractor" && (
          <BrandImageSelector onImagesChange={setSelectedImages} />
        )}
        {(selectedSlug === "post-suggestor" || selectedSlug === "content-calendar-generator") && (
          <BrandFillSection mode="basic" onFill={mergeVariables} />
        )}
        {selectedSlug === "image-prompt-from-brand-and-post-without-reference" && (
          <BrandFillSection mode="identity" onFill={mergeVariables} />
        )}
        {selectedSlug === "image-reference-and-brand-identity-combiner" && (
          <CombinerSourceSection onFill={mergeVariables} />
        )}

        {/* Detected variables */}
        {detectedVars.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Detected placeholders</Label>
            <div className="flex flex-wrap gap-1">
              {detectedVars.map((v) => (
                <code key={v} className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{`{{${v}}}`}</code>
              ))}
            </div>
          </div>
        )}

        {/* Variables JSON */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="variables">Variables (JSON)</Label>
              {knownMeta?.variables && (
                <span className="text-xs text-muted-foreground ml-2">— pre-filled with examples, edit as needed</span>
              )}
            </div>
            {jsonError && (
              <span className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />{jsonError}
              </span>
            )}
          </div>
          <Textarea
            id="variables"
            value={variablesJson}
            onChange={handleJsonChange}
            className="font-mono text-sm min-h-[140px] resize-y"
            spellCheck={false}
          />
        </div>

        {/* Run button */}
        <Button
          onClick={handleRun}
          disabled={running || !selectedSlug || !!jsonError}
          className="gap-2 w-full"
        >
          {running
            ? <><Loader2 className="w-4 h-4 animate-spin" />Running…</>
            : <><Play className="w-4 h-4" />Run Generation{selectedImages.length > 0 ? ` (${selectedImages.length} image${selectedImages.length > 1 ? "s" : ""})` : ""}</>
          }
        </Button>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-3">
            <Separator />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Output</h3>
              <div className="flex items-center gap-2">
                {result.usage && (
                  <span className="text-xs text-muted-foreground">
                    {result.usage.total_tokens} tokens ({result.usage.prompt_tokens} in / {result.usage.completion_tokens} out)
                  </span>
                )}
                <Badge variant="outline" className="text-xs">{result.model}</Badge>
              </div>
            </div>
            {result.unreplacedVariables?.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                Unreplaced variables: {result.unreplacedVariables.map((v) => `{{${v}}}`).join(", ")}
              </div>
            )}
            <pre className="bg-muted rounded-lg p-4 text-xs overflow-auto max-h-[500px] whitespace-pre-wrap break-words">
              {typeof result.content === "object"
                ? JSON.stringify(result.content, null, 2)
                : result.content}
            </pre>
            <button
              type="button"
              onClick={() => setShowPrompt((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              {showPrompt ? "Hide" : "Show"} assembled prompt
            </button>
            {showPrompt && (
              <pre className="bg-muted/50 rounded-lg p-4 text-xs overflow-auto max-h-[200px] whitespace-pre-wrap break-words border border-border">
                {result.prompt}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
