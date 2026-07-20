"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ArrowLeft, Save, Loader2, Pencil, Trash2, Plus, Check, X, AlertCircle, Sparkles,
} from "lucide-react";
import {
  CALENDAR_TABLE_VIEWS, normalizePost, serializePostForSave,
} from "@/lib/calendar-post-utils";

// ─── Date sorting helper ───────────────────────────────────────────────────────
// Sorts posts by ascending date/time while keeping a stable relative order for
// posts with identical or missing/invalid dates.
function parsePostDateTime(value) {
  if (!value || typeof value !== "string") return Number.POSITIVE_INFINITY;
  const time = Date.parse(value.trim().replace(" ", "T"));
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function sortPostsByDateTime(posts) {
  return [...posts]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const diff = parsePostDateTime(a.p.date) - parsePostDateTime(b.p.date);
      return diff !== 0 ? diff : a.i - b.i;
    })
    .map(({ p }) => p);
}

// ─── Cell value renderer ──────────────────────────────────────────────────────

function renderValue(key, value) {
  if (key === "referenceLink") {
    if (!value || typeof value !== "string") return null;
    const displayText = value.length > 45 ? value.slice(0, 42) + "…" : value;
    try {
      const url = new URL(value);
      const label = url.hostname + (url.pathname.length > 25 ? url.pathname.slice(0, 22) + "…" : url.pathname);
      return (
        <a href={value} target="_blank" rel="noopener noreferrer"
          className="underline hover:text-primary truncate block max-w-[140px]"
          title={value}>
          {label}
        </a>
      );
    } catch {
      return <span className="truncate block max-w-[140px]" title={value}>{displayText}</span>;
    }
  }
  if (key === "hashtags") {
    const arr = Array.isArray(value) ? value :
      (typeof value === "string" && value.trim() ? value.split(/\s+/).filter(Boolean) : []);
    return arr.length ? arr.join(" ") : null;
  }
  if (typeof value === "number") return String(value);
  return (typeof value === "string" && value.trim()) ? value : null;
}

// ─── Edit panel ───────────────────────────────────────────────────────────────

const EDIT_SECTIONS = [
  {
    label: "Schedule",
    fields: [
      { key: "postNumber",  label: "#",            type: "input",    col: 1 },
      { key: "date",        label: "Date",          type: "date",     col: 1 },
      { key: "platform",    label: "Platform",      type: "input",    col: 1 },
      { key: "format",      label: "Format",        type: "input",    col: 1 },
      { key: "hookTitle",   label: "Hook / Title",  type: "textarea", rows: 2, col: 2 },
      { key: "mainAngle",   label: "Main Angle",    type: "textarea", rows: 2, col: 2 },
      { key: "coreMessage", label: "Core Message",  type: "textarea", rows: 2, col: 2 },
      { key: "hashtags",    label: "Hashtags",      type: "hashtags",          col: 2 },
      { key: "caption",     label: "Caption",       type: "textarea", rows: 3, col: 3 },
    ],
  },
  {
    label: "Visual",
    fields: [
      { key: "contentStructure", label: "Content Structure",               type: "textarea", rows: 2, col: 3 },
      { key: "visualDirection",  label: "Visual Direction",                type: "textarea", rows: 6, col: 3 },
      { key: "imageText",        label: "Image Text",                      type: "textarea", rows: 6, col: 3 },
      { key: "structure",        label: "Structure",                       type: "input",             col: 1 },
      { key: "inspiration",      label: "Inspiration",                     type: "textarea", rows: 2, col: 2 },
      { key: "videoConceptTitleAndThumbnailTitleIdea", label: "Video Concept / Thumbnail", type: "textarea", rows: 2, col: 2 },
      { key: "videoRawIdea",     label: "Video Raw Idea",                  type: "textarea", rows: 2, col: 2 },
      { key: "mainIntegratedScenario", label: "Integrated Scenario",       type: "textarea", rows: 3, col: 3 },
      { key: "thumbnailIdeaForReel",   label: "Thumbnail Idea",            type: "textarea", rows: 2, col: 2 },
    ],
  },
  {
    label: "Video Production",
    fields: [
      { key: "narrationOrDialogueOfCharacterOrCharacters", label: "Narration / Dialogue",       type: "textarea", rows: 3, col: 3 },
      { key: "rawImageIdeaForFirstFrame", label: "First Frame Idea",     type: "textarea", rows: 2, col: 2 },
      { key: "whatHappens",              label: "What Happens",          type: "textarea", rows: 3, col: 3 },
      { key: "characterObjectOrEnvironmentAction", label: "Character / Object / Environment Action", type: "textarea", rows: 2, col: 2 },
      { key: "cameraMovement",           label: "Camera movement",       type: "textarea", rows: 2, col: 2 },
      { key: "speedRamp",                label: "Speed ramp",            type: "input",             col: 1 },
      { key: "camera",                   label: "Camera",                type: "input",             col: 1 },
      { key: "lens",                     label: "Lens",                  type: "input",             col: 1 },
      { key: "focalLength",              label: "Focal length",          type: "input",             col: 1 },
      { key: "aperture",                 label: "Aperture",              type: "input",             col: 1 },
      { key: "visualMood",               label: "Visual Mood",           type: "textarea", rows: 2, col: 2 },
      { key: "textOnVideo",              label: "Text on Video",         type: "textarea", rows: 2, col: 2 },
    ],
  },
];

function EditPanel({ draft, onChange, onSave, onCancel }) {
  const [openSection, setOpenSection] = useState("Schedule");

  function set(key, val) { onChange({ ...draft, [key]: val }); }

  const hashtagStr = Array.isArray(draft.hashtags)
    ? draft.hashtags.join(" ")
    : (draft.hashtags ?? "");

  function colClass(col) {
    if (col === 3) return "sm:col-span-3";
    if (col === 2) return "sm:col-span-2";
    return "";
  }

  return (
    <div className="p-4 bg-primary/5 border-t border-primary/20 space-y-4">
      {/* Section tabs */}
      <div className="flex gap-1 flex-wrap">
        {EDIT_SECTIONS.map(s => (
          <button
            key={s.label}
            type="button"
            onClick={() => setOpenSection(s.label)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              openSection === s.label
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Active section fields */}
      {EDIT_SECTIONS.filter(s => s.label === openSection).map(section => (
        <div key={section.label} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {section.fields.map(f => (
            <div key={f.key} className={colClass(f.col)}>
              <label className="text-xs font-medium text-muted-foreground block mb-1">{f.label}</label>
              {f.type === "hashtags" ? (
                <input
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm"
                  value={hashtagStr}
                  onChange={e => onChange({ ...draft, hashtags: e.target.value.split(/[\s,]+/).filter(Boolean) })}
                  placeholder="#tag1 #tag2 #tag3"
                />
              ) : f.type === "textarea" ? (
                <textarea
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-xs resize-none shadow-sm"
                  rows={f.rows}
                  value={draft[f.key] ?? ""}
                  onChange={e => set(f.key, e.target.value)}
                />
              ) : f.type === "date" ? (
                <input
                  type="date"
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm"
                  value={draft[f.key] ?? ""}
                  onChange={e => set(f.key, e.target.value)}
                />
              ) : (
                <input
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm"
                  value={draft[f.key] ?? ""}
                  onChange={e => set(f.key, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      ))}

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onSave}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90">
          <Check className="w-3 h-3" />Save Changes
        </button>
        <button type="button" onClick={onCancel}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground">
          <X className="w-3 h-3" />Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Regenerate options ───────────────────────────────────────────────────────

const REGEN_OPTIONS = [
  {
    value: "visual_only",
    label: "Visual ideas only",
    desc: "Regenerate visual direction & image text requirements",
  },
  {
    value: "entire_post",
    label: "Entire post",
    desc: "Regenerate all content, visuals, and video fields",
  },
  {
    value: "custom_instruction",
    label: "Custom instruction",
    desc: "Tell AI exactly what to change",
  },
  {
    value: "image_text_only",
    label: "Image Text only",
    desc: "Regenerate on-image text based on this post's content",
  },
];

function buildSummaryText(scope, customInstruction) {
  switch (scope) {
    case "visual_only":        return "Visual Direction, Image Text, and video production fields were regenerated.";
    case "visual_ideas_only":  return "Visual ideas and Image Text were regenerated.";
    case "image_text_only":    return "Image Text was regenerated based on the selected guidance.";
    case "entire_post":        return "Content, visuals, Image Text, and video production fields were regenerated.";
    case "custom_instruction": {
      const instr = (customInstruction || "").trim();
      const preview = instr.slice(0, 120);
      return instr
        ? `Post was updated based on your custom instruction: "${preview}${instr.length > 120 ? "…" : ""}"`
        : "Post was updated based on your custom instruction.";
    }
    default: return "Post was regenerated.";
  }
}

function RegenerateUnsavedPanel({ post, brandId, calendarContext, onDone, onCancel, allPosts, onUpdatePost, referenceAttachments }) {
  const [scope, setScope] = useState("visual_only");
  const [customInstruction, setCustomInstruction] = useState("");
  const [instructionError, setInstructionError] = useState("");
  const [guidedReasons, setGuidedReasons] = useState([]);
  const [guidedFeatures, setGuidedFeatures] = useState([]);
  const [imageTextInstruction, setImageTextInstruction] = useState("");
  const [applyToAllPosts, setApplyToAllPosts] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);

  function handleScopeChange(value) {
    setScope(value);
    setInstructionError("");
    setGuidedReasons([]);
    setGuidedFeatures([]);
    setImageTextInstruction("");
    setApplyToAllPosts(false);
    setSummary(null);
  }

  async function handleRegenerate() {
    const attachmentIds = (referenceAttachments || [])
      .map((attachment) => attachment.id)
      .filter(Boolean);

    if (scope === "custom_instruction") {
      if (!customInstruction.trim() || customInstruction.trim().length < 5) {
        setInstructionError("Please write what you want AI to change.");
        return;
      }
      setInstructionError("");
    }

    if (applyToAllPosts && allPosts?.length) {
      setLoading(true);
      let failed = 0;
      const total = allPosts.length;
      for (let i = 0; i < total; i++) {
        setBulkProgress(`Regenerating post ${i + 1} of ${total}…`);
        const p = allPosts[i];
        try {
          const res = await fetch("/api/content-calendar/regenerate-post", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              post: p, brandId, calendarContext, scope, customInstruction: customInstruction.trim(),
              attachmentIds,
              ...(scope === "image_text_only" && { guidedReasons, guidedFeatures, imageTextInstruction }),
            }),
          });
          const text = await res.text();
          let data;
          try { data = JSON.parse(text); } catch { throw new Error("Invalid JSON"); }
          if (!data.success) throw new Error(data.error ?? "Regeneration failed.");
          onUpdatePost(p._id, data.post);
        } catch (err) {
          console.error(`[RegenerateUnsaved] Post ${p._id} failed:`, err);
          failed++;
        }
      }
      setBulkProgress("");
      setLoading(false);
      if (scope === "custom_instruction") {
        if (failed === 0) toast.success(`Applied custom instruction to ${total} post${total !== 1 ? "s" : ""}.`);
        else toast.warning(`Applied custom instruction to ${total - failed} of ${total} posts. ${failed} failed.`);
      } else {
        const label = { image_text_only: "Image Text", visual_only: "Visual Direction", visual_ideas_only: "Visual ideas", entire_post: "All fields" }[scope] ?? "Post fields";
        if (failed === 0) toast.success(`Updated ${label} for ${total} post${total !== 1 ? "s" : ""}.`);
        else toast.warning(`Updated ${label} for ${total - failed} of ${total} posts. ${failed} failed.`);
      }
      onCancel();
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/content-calendar/regenerate-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post, brandId, calendarContext, scope, customInstruction: customInstruction.trim(),
          attachmentIds,
          ...(scope === "image_text_only" && { guidedReasons, guidedFeatures, imageTextInstruction }),
        }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error("Server returned invalid JSON."); }
      if (!data.success) throw new Error(data.error ?? "Regeneration failed.");
      onUpdatePost(post._id, data.post);
      setSummary(buildSummaryText(scope, customInstruction));
    } catch (err) {
      console.error("[RegenerateUnsaved]", err);
      toast.error(err.message || "Regeneration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 bg-primary/5 border-t border-primary/20 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-primary" />AI Regenerate Post
      </p>
      <div className="flex gap-2 flex-wrap">
        {REGEN_OPTIONS.map(opt => (
          <button key={opt.value} type="button"
            disabled={loading}
            onClick={() => handleScopeChange(opt.value)}
            className={`px-3 py-2 rounded-lg border text-left transition-colors disabled:opacity-60 ${
              scope === opt.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}>
            <p className="text-xs font-medium">{opt.label}</p>
            <p className="text-xs opacity-70 mt-0.5">{opt.desc}</p>
          </button>
        ))}
      </div>
      {scope === "image_text_only" && (
        <div className="space-y-3 border border-border rounded-lg p-3 bg-background">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground block">
              Why do you want to change the Image Text?{" "}
              <span className="text-muted-foreground/50">(optional)</span>
            </label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {[
                "Too generic",
                "Not aligned with the post claim",
                "Needs more specific steps or numbers",
                "Needs stronger hook",
                "Other",
              ].map(reason => (
                <label key={reason} className={`flex items-center gap-2 cursor-pointer${loading ? " opacity-60 cursor-not-allowed" : ""}`}>
                  <input
                    type="checkbox"
                    disabled={loading}
                    checked={guidedReasons.includes(reason)}
                    onChange={e => setGuidedReasons(prev =>
                      e.target.checked ? [...prev, reason] : prev.filter(r => r !== reason)
                    )}
                    className="rounded border-input"
                  />
                  <span className="text-xs">{reason}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground block">
              What should improve?{" "}
              <span className="text-muted-foreground/50">(optional)</span>
            </label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {[
                "More specific headline",
                "Show steps or numbers",
                "Better badge or label",
                "Match the visual direction",
                "More benefit-focused",
                "Shorter and cleaner copy",
              ].map(feat => (
                <label key={feat} className={`flex items-center gap-2 cursor-pointer${loading ? " opacity-60 cursor-not-allowed" : ""}`}>
                  <input
                    type="checkbox"
                    disabled={loading}
                    checked={guidedFeatures.includes(feat)}
                    onChange={e => setGuidedFeatures(prev =>
                      e.target.checked ? [...prev, feat] : prev.filter(f => f !== feat)
                    )}
                    className="rounded border-input"
                  />
                  <span className="text-xs">{feat}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground block">
              Extra instruction for Image Text{" "}
              <span className="text-muted-foreground/50">(optional)</span>
            </label>
            <textarea
              rows={3}
              disabled={loading}
              value={imageTextInstruction}
              onChange={e => setImageTextInstruction(e.target.value)}
              placeholder="Example: Make the image text clearer, more specific, and include 3 practical steps."
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-none shadow-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          </div>
        </div>
      )}
      {scope === "custom_instruction" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground block">What should AI change?</label>
          <textarea
            rows={5}
            disabled={loading}
            value={customInstruction}
            onChange={e => { setCustomInstruction(e.target.value); setInstructionError(""); }}
            placeholder="Example: Keep the same topic, but rewrite the hook and caption to sound more professional."
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-none shadow-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
          />
          {instructionError && <p className="text-xs text-destructive">{instructionError}</p>}
          <p className="text-xs text-muted-foreground/70">
            Tell AI exactly what to change. The app will keep the post number and only update the selected post.
          </p>
        </div>
      )}
      {(scope === "custom_instruction" || scope === "image_text_only") && (
        <label className={`flex items-center gap-2 cursor-pointer${loading ? " opacity-60 cursor-not-allowed" : ""}`}>
          <input
            type="checkbox"
            disabled={loading}
            checked={applyToAllPosts}
            onChange={e => setApplyToAllPosts(e.target.checked)}
            className="rounded border-input"
          />
          <span className="text-xs text-muted-foreground">
            Apply this change to all posts in the calendar
          </span>
        </label>
      )}
      {bulkProgress && (
        <p className="text-xs text-primary flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />{bulkProgress}
        </p>
      )}
      {summary ? (
        <div className="rounded-md bg-primary/10 border border-primary/20 p-3 space-y-2">
          <p className="text-xs font-semibold text-primary">Changes made</p>
          <p className="text-xs text-foreground">{summary}</p>
          <button type="button"
            onClick={() => { setSummary(null); onCancel(); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90">
            Close
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={handleRegenerate} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {loading
              ? <><Loader2 className="w-3 h-3 animate-spin" />Regenerating…</>
              : applyToAllPosts
                ? <><Sparkles className="w-3 h-3" />Regenerate All Posts</>
                : <><Sparkles className="w-3 h-3" />Regenerate Post</>}
          </button>
          <button type="button" onClick={onCancel} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-60">
            <X className="w-3 h-3" />Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Calendar table ───────────────────────────────────────────────────────────

function CalendarTable({ posts, view, onUpdatePost, onRemovePost, brandId, calendarContext, referenceAttachments }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [regenId, setRegenId] = useState(null);

  function startEdit(post) {
    setRegenId(null);
    const norm = normalizePost(post, 0);
    // norm.imageText already resolves to the best available text (manual
    // edit if present, otherwise the formatted Output Image Text
    // Requirements content) so the textarea starts from the same text the
    // table displays.
    setEditingId(post._id);
    setDraft({ ...norm, _id: post._id });
  }

  function saveEdit() {
    // outputImageTextRequirements / outputImageTextRequirementsStructured are
    // preserved unchanged from norm — only imageText may have been edited.
    onUpdatePost(editingId, draft);
    setEditingId(null);
    setDraft(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  if (posts.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No posts yet.</p>;
  }

  const tableContent = (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-muted/60">
          {view.columns.map(col => (
            <th key={col.key}
              className={`px-3 py-2 text-left text-xs font-medium text-muted-foreground border-b border-border whitespace-nowrap ${col.width}`}>
              {col.label}
            </th>
          ))}
          <th className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border w-16 text-right whitespace-nowrap">
            Actions
          </th>
        </tr>
      </thead>
      <tbody>
        {posts.map((post, idx) => {
          const norm = normalizePost(post, idx);
          const isEditing = editingId === post._id;
          const isRegening = regenId === post._id;
          return (
            <tr key={post._id}
              className={`border-b border-border/50 last:border-0 transition-colors align-top ${
                isEditing || isRegening ? "bg-primary/5" : idx % 2 === 0 ? "bg-background" : "bg-muted/20"
              }`}>
              <>
                {view.columns.map(col => {
                  const display = renderValue(col.key, norm[col.key]);
                  const isImageText = col.key === "imageText";
                  return (
                    <td key={col.key} className={`px-3 py-2 ${col.width}`}>
                      <span className={`text-xs leading-snug break-words ${isImageText ? "whitespace-pre-wrap" : ""} ${!display ? "text-muted-foreground/30 italic" : ""}`}>
                        {display ?? "—"}
                      </span>
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right">
                  {isEditing ? (
                    <button type="button" onClick={cancelEdit}
                      className="w-6 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" title="AI Regenerate"
                        onClick={() => { setRegenId(post._id); setEditingId(null); setDraft(null); }}
                        className="w-6 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10">
                        <Sparkles className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => startEdit(post)}
                        className="w-6 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted">
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => onRemovePost(post._id)}
                        className="w-6 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </td>
              </>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  // Full-width panels rendered outside the table to avoid layout issues
  const editingPost = editingId ? posts.find(p => p._id === editingId) : null;
  const regenPost = regenId ? posts.find(p => p._id === regenId) : null;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="overflow-x-auto">
        {tableContent}
      </div>
      {editingPost && draft && (
        <EditPanel
          draft={draft}
          onChange={setDraft}
          onSave={saveEdit}
          onCancel={cancelEdit}
        />
      )}
      {regenPost && (
        <RegenerateUnsavedPanel
          post={regenPost}
          brandId={brandId}
          calendarContext={calendarContext}
          allPosts={posts}
          onUpdatePost={onUpdatePost}
          onDone={regeneratedPost => { onUpdatePost(regenId, regeneratedPost); setRegenId(null); }}
          onCancel={() => setRegenId(null)}
          referenceAttachments={referenceAttachments}
        />
      )}
    </div>
  );
}

// ─── Raw output panel ─────────────────────────────────────────────────────────

function RawOutputPanel({ raw, onParsed }) {
  const [text, setText] = useState(raw);
  const [error, setError] = useState(null);

  function tryParse() {
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed :
        parsed.calendar ?? parsed.posts ?? parsed.calendarPosts ??
        Object.values(parsed).find(v => Array.isArray(v));
      if (arr?.length) {
        onParsed(arr);
        toast.success(`Parsed ${arr.length} posts.`);
      } else {
        setError("No post array found in JSON. Check the structure.");
      }
    } catch {
      setError("Invalid JSON. Edit the text and try again.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Could not parse a post list automatically. Edit the JSON below and click Parse, or add rows manually.
        </p>
      </div>
      <Textarea value={text} onChange={e => { setText(e.target.value); setError(null); }}
        className="font-mono text-xs min-h-[280px] resize-y" spellCheck={false} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button variant="outline" size="sm" onClick={tryParse}>Try Parse as JSON</Button>
    </div>
  );
}

// ─── Empty post factory ───────────────────────────────────────────────────────

function emptyPost(n) {
  return {
    _id: `new-${Date.now()}-${n}`,
    postNumber: n, date: "", platform: "", format: "",
    mainAngle: "", coreMessage: "", hookTitle: "", caption: "", hashtags: [],
    contentStructure: "", visualDirection: "", outputImageTextRequirements: "", imageText: "",
    structure: "", inspiration: "",
    videoConceptTitleAndThumbnailTitleIdea: "", videoRawIdea: "", mainIntegratedScenario: "", thumbnailIdeaForReel: "",
    narrationOrDialogueOfCharacterOrCharacters: "", rawImageIdeaForFirstFrame: "", whatHappens: "",
    characterObjectOrEnvironmentAction: "", cameraMovement: "",
    speedRamp: "Auto", camera: "Auto", lens: "Auto", focalLength: "50", aperture: "f/4 moderate",
    visualMood: "", textOnVideo: "",
    status: "Draft", contentOrigin: "original", referenceLink: "",
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StepCalendarOutput({
  brand, formData, initialPosts, rawOutput, model, usage, onBack, referenceAttachments,
}) {
  const router = useRouter();

  const [posts, setPosts] = useState(() =>
    initialPosts.length > 0
      ? sortPostsByDateTime(
          initialPosts.map((p, i) => ({ ...p, _id: p._id ?? `cal-${Date.now()}-${i}` }))
        )
      : []
  );
  const [activeView, setActiveView] = useState("schedule");
  const [showRaw, setShowRaw] = useState(initialPosts.length === 0 && !!rawOutput);
  const [calendarTitle, setCalendarTitle] = useState(
    `${brand.name} — ${formData.mainMonthlySubject || formData.platforms || "Content Calendar"}`
  );
  const [saving, setSaving] = useState(false);

  function updatePost(id, updated) {
    setPosts(prev => sortPostsByDateTime(prev.map(p => p._id === id ? { ...p, ...updated, _id: p._id } : p)));
  }

  function removePost(id) {
    setPosts(prev => {
      const filtered = prev.filter(p => p._id !== id);
      return filtered.map((p, i) => ({ ...p, postNumber: i + 1 }));
    });
  }

  function addRow() {
    setPosts(prev => [...prev, emptyPost(prev.length + 1)]);
  }

  function handleParsed(arr) {
    setPosts(sortPostsByDateTime(arr.map((p, i) => ({
      ...normalizePost(p, i),
      _id: `parsed-${Date.now()}-${i}`,
    }))));
    setShowRaw(false);
  }

  async function handleSave(status = "draft") {
    if (!calendarTitle.trim()) return toast.error("Calendar title is required.");
    if (!brand?.id) return toast.error("Please select a brand before saving.");
    if (posts.length === 0) return toast.error("Add at least one post.");
    setSaving(true);
    try {
      console.log("[SaveCalendar] Saving", posts.length, "posts for brand", brand.id, "| status:", status);
      const res = await fetch("/api/calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: calendarTitle,
          brandId: brand.id,
          platform: formData.platforms,
          timePeriod: formData.publishingFrequency,
          mainMonthlySubject: formData.mainMonthlySubject,
          mainGoal: formData.mainGoal,
          mainOfferOrMessage: formData.mainOfferOrMessage,
          sourceMaterial: formData.sourceMaterial,
          status,
          posts: posts.map(({ _id, ...p }) => {
            const norm = normalizePost(p, 0);
            return serializePostForSave(norm, formData.platforms);
          }),
        }),
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error("Server returned an unexpected response. Check logs."); }

      console.log("[SaveCalendar] Response:", res.status, data?.success, data?.error);

      if (!res.ok || data?.success === false) {
        if (data?.details) console.error("[SaveCalendar] details:", data.details);
        throw new Error(data?.error ?? "Content calendar could not be saved.");
      }

      toast.success(`Calendar saved with ${posts.length} posts!`);
      router.push(`/content-calendar/${data.id}`);
    } catch (err) {
      console.error("[SaveCalendar] Error:", err);
      toast.error(err.message ?? "Content calendar could not be saved.");
      setSaving(false);
    }
  }

  const currentView = CALENDAR_TABLE_VIEWS.find(v => v.id === activeView) ?? CALENDAR_TABLE_VIEWS[0];

  return (
    <div className="max-w-full space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-medium">
            {posts.length > 0 ? `${posts.length} posts generated` : "No posts parsed yet"}
          </p>
          {model && (
            <p className="text-xs text-muted-foreground">
              {model}{usage ? ` · ${usage.total_tokens} tokens` : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {rawOutput && (
            <Button variant="outline" size="sm" onClick={() => setShowRaw(v => !v)}>
              {showRaw ? "Show Table" : "Show Raw Output"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={addRow} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />Add Row
          </Button>
        </div>
      </div>

      {showRaw && rawOutput ? (
        <RawOutputPanel raw={rawOutput} onParsed={handleParsed} />
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex items-center gap-0 border-b border-border">
            {CALENDAR_TABLE_VIEWS.map(v => (
              <button
                key={v.id}
                type="button"
                onClick={() => setActiveView(v.id)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeView === v.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground pb-2 pr-1 hidden sm:block">
              Click ✎ to edit · edits apply across all tabs
            </span>
          </div>

          <CalendarTable
            posts={posts}
            view={currentView}
            onUpdatePost={updatePost}
            onRemovePost={removePost}
            brandId={brand.id}
            calendarContext={{
              mainMonthlySubject: formData.mainMonthlySubject,
              mainGoal: formData.mainGoal,
              mainOfferOrMessage: formData.mainOfferOrMessage,
            }}
            referenceAttachments={referenceAttachments}
          />
        </>
      )}

      <Separator />

      {/* Save */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Save Calendar</h3>
        <div className="space-y-1.5 max-w-lg">
          <Label htmlFor="calendarTitle">Calendar Title</Label>
          <Input id="calendarTitle" value={calendarTitle} onChange={e => setCalendarTitle(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />Back
          </Button>
          <Button variant="outline" onClick={() => handleSave("draft")} disabled={saving || posts.length === 0} className="gap-2">
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
              : <><Save className="w-4 h-4" />Save as Draft</>}
          </Button>
          <Button onClick={() => handleSave("approved")} disabled={saving || posts.length === 0} className="gap-2">
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
              : <><Check className="w-4 h-4" />Approve &amp; Save</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
