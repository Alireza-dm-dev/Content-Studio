"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft, Pencil, Trash2, Check, X, ImageIcon, Video, Sparkles, Loader2, Download, AlertCircle,
} from "lucide-react";
import {
  CALENDAR_TABLE_VIEWS, normalizePost,
} from "@/lib/calendar-post-utils";
import ImagePromptModal from "@/components/ImagePromptModal";
import VideoStoryboardModal from "@/components/VideoStoryboardModal";
import ExportCalendarModal from "@/components/ExportCalendarModal";
import { ReferenceFileUpload } from "@/components/ReferenceFileUpload";

// ─── Cell value renderer (shared) ─────────────────────────────────────────────

function renderValue(key, value, post) {
  if (key === "hashtags") {
    // New-format posts already end their caption with the 5 hashtags — don't
    // show them a second time here, or old-format posts wouldn't be able to
    // tell the difference between "no hashtags" and "hashtags are elsewhere".
    if (post?.hashtagsMergedIntoCaption) return "In caption";
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

function EditPanel({ draft, onChange, onSave, onCancel, saving }) {
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
        <button type="button" onClick={onSave} disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {saving ? "Saving…" : <><Check className="w-3 h-3" />Save Changes</>}
        </button>
        <button type="button" onClick={onCancel}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground">
          <X className="w-3 h-3" />Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Regeneration panel ───────────────────────────────────────────────────────

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

function RegeneratePanel({ postId, calendarId, brandId, onDone, onCancel, allPosts, onUpdate }) {
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
  const [postReferenceAttachments, setPostReferenceAttachments] = useState([]);
  const [loadingPostReferences, setLoadingPostReferences] = useState(false);
  const [postReferenceError, setPostReferenceError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoadingPostReferences(true);
      setPostReferenceError(null);
      try {
        const url = `/api/brands/${encodeURIComponent(brandId)}/attachments?calendarId=${encodeURIComponent(calendarId)}&calendarPostId=${encodeURIComponent(postId)}`;
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (data.success === true) {
          setPostReferenceAttachments(Array.isArray(data.attachments) ? data.attachments : []);
        } else {
          setPostReferenceError(data.error || "Post reference files could not be loaded.");
        }
      } catch (err) {
        if (err.name === "AbortError" || controller.signal.aborted) return;
        setPostReferenceError("Post reference files could not be loaded.");
      } finally {
        if (!controller.signal.aborted) {
          setLoadingPostReferences(false);
        }
      }
    }

    load();

    return () => controller.abort();
  }, [postId, calendarId, brandId, retryKey]);

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
          const res = await fetch(`/api/calendar-posts/${p.id}/regenerate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scope, brandId, calendarId, customInstruction: customInstruction.trim(),
              currentPost: p,
              ...(scope === "image_text_only" && { guidedReasons, guidedFeatures, imageTextInstruction }),
            }),
          });
          const text = await res.text();
          let data;
          try { data = JSON.parse(text); } catch { throw new Error("Invalid JSON"); }
          if (!data.success) throw new Error(data.error ?? "Regeneration failed.");
          onUpdate(p.id, data.post);
        } catch (err) {
          console.error(`[Regenerate] Post ${p.id} failed:`, err);
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
      const currentPost = allPosts?.find(p => p.id === postId) || null;
      const res = await fetch(`/api/calendar-posts/${postId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope, brandId, calendarId, customInstruction: customInstruction.trim(),
          currentPost,
          ...(scope === "image_text_only" && { guidedReasons, guidedFeatures, imageTextInstruction }),
        }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error("Server returned invalid JSON."); }

      if (!data.success) throw new Error(data.error ?? "Regeneration failed.");
      onUpdate(postId, data.post);
      setSummary(buildSummaryText(scope, customInstruction));
    } catch (err) {
      console.error("[Regenerate]", err);
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

      {/* Scope options */}
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

      {/* Image Text guided form */}
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

      {/* Custom instruction textarea */}
      {scope === "custom_instruction" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground block">
            What should AI change?
          </label>
          <textarea
            rows={5}
            disabled={loading}
            value={customInstruction}
            onChange={e => { setCustomInstruction(e.target.value); setInstructionError(""); }}
            placeholder="Example: Keep the same topic, but rewrite the hook and caption to sound more professional. Also make the visual direction more minimal and add clearer slide by slide output image text requirements."
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-none shadow-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
          />
          {instructionError && (
            <p className="text-xs text-destructive">{instructionError}</p>
          )}
          <p className="text-xs text-muted-foreground/70">
            Tell AI exactly what to change. The app will keep the post number and only update the selected post.
          </p>
        </div>
      )}

      {/* Apply to all / progress */}
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

      {/* Post-specific reference files */}
      <div className="space-y-2">
        {loadingPostReferences && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2" aria-live="polite">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Loading post reference files…</span>
          </div>
        )}
        {postReferenceError && (
          <div className="flex items-center gap-2 text-xs text-destructive py-1" role="alert" aria-live="polite">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{postReferenceError}</span>
            <button
              type="button"
              onClick={() => setRetryKey(k => k + 1)}
              className="underline hover:no-underline ml-1"
            >
              Retry
            </button>
          </div>
        )}
        {!loadingPostReferences && (
          <ReferenceFileUpload
            brandId={brandId}
            calendarId={calendarId}
            calendarPostId={postId}
            attachments={postReferenceAttachments}
            onAttachmentsChange={setPostReferenceAttachments}
            allowRemove={false}
            disabled={loading || loadingPostReferences}
            maxFiles={5}
            title="Post-specific reference files"
            description="Upload supporting files for this post's AI regeneration. These temporary references apply only to this saved post. Calendar-level references are also used automatically."
          />
        )}
      </div>

      {/* Actions / summary */}
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

const STATUS_VARIANT = { draft: "secondary", active: "default", completed: "outline", approved: "default" };

function CalendarTable({ posts, view, calendarId, brandId, onUpdate, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [regenId, setRegenId] = useState(null); // postId being regenerated
  const [activeModal, setActiveModal] = useState(null); // { type: "image"|"video", post }

  function startEdit(post) {
    setRegenId(null);
    const norm = normalizePost(post, 0);
    // norm.imageText already resolves to the best available text (manual
    // edit if present, otherwise the formatted Output Image Text
    // Requirements content) so the textarea starts from the same text the
    // table displays.
    setEditingId(post.id);
    setDraft({ ...norm, _dbId: post.id });
  }

  function startRegen(postId) {
    setRegenId(postId);
    setEditingId(null);
    setDraft(null);
  }

  async function saveEdit() {
    setSaving(true);
    try {
      // outputImageTextRequirements / outputImageTextRequirementsStructured are
      // preserved unchanged from norm — only imageText may have been edited.
      const res = await fetch(`/api/calendar-posts/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error();
      onUpdate(editingId, draft);
      setEditingId(null);
      setDraft(null);
      toast.success("Post updated.");
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function deletePost(postId) {
    setDeletingId(postId);
    try {
      const res = await fetch(`/api/calendar-posts/${postId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onDelete(postId);
      toast.success("Post removed.");
    } catch {
      toast.error("Failed to delete.");
    } finally {
      setDeletingId(null);
    }
  }

  if (posts.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-10">No posts in this calendar yet.</p>;
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
          <th className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border w-24 text-right whitespace-nowrap">
            Actions
          </th>
        </tr>
      </thead>
      <tbody>
        {posts.map((post, idx) => {
          const norm = normalizePost(post, idx);
          const isEditing = editingId === post.id;
          return (
            <tr key={post.id}
              className={`border-b border-border/50 last:border-0 transition-colors align-top ${
                isEditing ? "bg-primary/5" : idx % 2 === 0 ? "bg-background" : "bg-muted/20"
              }`}>
              {view.columns.map(col => {
                const display = renderValue(col.key, norm[col.key], norm);
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
                {isEditing || regenId === post.id ? (
                  <button type="button" onClick={() => { setEditingId(null); setDraft(null); setRegenId(null); }}
                    className="w-6 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted">
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <div className="flex items-center justify-end gap-1">
                    {brandId && (
                      <>
                        <button type="button"
                          title="Create Image Prompt"
                          onClick={() => setActiveModal({ type: "image", post })}
                          className="w-6 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted">
                          <ImageIcon className="w-3 h-3" />
                        </button>
                        <button type="button"
                          title="Create Video Prompt"
                          onClick={() => setActiveModal({ type: "video", post })}
                          className="w-6 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-purple-400 hover:bg-purple-500/10">
                          <Video className="w-3 h-3" />
                        </button>
                        <button type="button"
                          title="AI Regenerate"
                          onClick={() => startRegen(post.id)}
                          className="w-6 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10">
                          <Sparkles className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    <button type="button" onClick={() => startEdit(post)}
                      className="w-6 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button type="button" onClick={() => deletePost(post.id)}
                      disabled={deletingId === post.id}
                      className="w-6 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const editingPost = editingId ? posts.find(p => p.id === editingId) : null;
  const regenPost   = regenId   ? posts.find(p => p.id === regenId)   : null;

  return (
    <>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          {tableContent}
        </div>
        {editingPost && draft && (
          <EditPanel
            draft={draft}
            onChange={setDraft}
            onSave={saveEdit}
            onCancel={() => { setEditingId(null); setDraft(null); }}
            saving={saving}
          />
        )}
        {regenPost && brandId && (
          <RegeneratePanel
            postId={regenPost.id}
            calendarId={calendarId}
            brandId={brandId}
            allPosts={posts}
            onUpdate={onUpdate}
            onDone={(updatedPost) => {
              onUpdate(regenPost.id, updatedPost);
              setRegenId(null);
            }}
            onCancel={() => setRegenId(null)}
          />
        )}
      </div>

      {activeModal?.type === "image" && (
        <ImagePromptModal
          post={activeModal.post}
          calendarId={calendarId}
          brandId={brandId}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal?.type === "video" && (
        <VideoStoryboardModal
          post={activeModal.post}
          calendarId={calendarId}
          brandId={brandId}
          onClose={() => setActiveModal(null)}
        />
      )}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CalendarDetailClient({ calendar, isAdmin = false }) {
  const [posts, setPosts] = useState(calendar.posts);
  const [activeView, setActiveView] = useState("schedule");
  const [showExport, setShowExport] = useState(false);
  const [calStatus, setCalStatus] = useState(calendar.status);
  const [approving, setApproving] = useState(false);

  async function handleApprove() {
    setApproving(true);
    try {
      const res = await fetch(`/api/calendars/${calendar.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });

      if (!res.ok) {
        let message = `Approval failed (HTTP ${res.status}).`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // response was not JSON — leave the generic HTTP-status message
        }
        throw new Error(message);
      }

      setCalStatus("approved");
      toast.success("Calendar approved.");
    } catch (err) {
      if (err instanceof TypeError) {
        // Network-level failure: the browser received no HTTP response
        // (e.g. request blocked/aborted before reaching the server).
        toast.error("Could not reach the server. Check that the app is running and retry.");
      } else {
        toast.error(err.message || "Could not approve calendar.");
      }
    } finally {
      setApproving(false);
    }
  }

  const backHref = calendar.brandId
    ? `/brand-workspace?brandId=${calendar.brandId}`
    : "/content-calendar";

  function handleUpdate(postId, updated) {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, ...updated } : p));
  }

  function handleDelete(postId) {
    setPosts(prev => prev.filter(p => p.id !== postId));
  }

  const currentView = CALENDAR_TABLE_VIEWS.find(v => v.id === activeView) ?? CALENDAR_TABLE_VIEWS[0];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href={backHref}><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold truncate">{calendar.title}</h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {calendar.brand && <span className="text-sm text-muted-foreground">{calendar.brand.name}</span>}
            {calendar.platform && <Badge variant="secondary" className="text-xs">{calendar.platform}</Badge>}
            <Badge variant={STATUS_VARIANT[calStatus] ?? "outline"} className="text-xs capitalize">{calStatus}</Badge>
            {calendar.timePeriod && <span className="text-xs text-muted-foreground">{calendar.timePeriod}</span>}
            <span className="text-xs text-muted-foreground">{posts.length} posts</span>
          </div>
        </div>
        {isAdmin && calStatus !== "approved" && (
          <Button size="sm" onClick={handleApprove} disabled={approving} className="gap-1.5 shrink-0">
            {approving
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Approving…</>
              : <><Check className="w-3.5 h-3.5" />Approve</>}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowExport(true)}
          className="gap-1.5 shrink-0">
          <Download className="w-3.5 h-3.5" />Export
        </Button>
        {calendar.brandId && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/brand-workspace?brandId=${calendar.brandId}`}>← Workspace</Link>
          </Button>
        )}
      </div>

      {/* Meta strip */}
      {(calendar.mainGoal || calendar.mainMonthlySubject || calendar.mainOfferOrMessage) && (
        <div className="ml-10 grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5 mt-3">
          {[
            { label: "Monthly Subject", value: calendar.mainMonthlySubject },
            { label: "Main Goal",       value: calendar.mainGoal },
            { label: "Offer / Message", value: calendar.mainOfferOrMessage },
          ].filter(m => m.value).map(m => (
            <div key={m.label} className="rounded-lg bg-muted/50 px-3 py-2">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-sm mt-0.5">{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tab bar + table */}
      <div className="ml-10">
        <div className="flex items-center gap-0 border-b border-border mb-4">
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
            Click ✎ to edit · Changes sync across all tabs
          </span>
        </div>

        <CalendarTable
          posts={posts}
          view={currentView}
          calendarId={calendar.id}
          brandId={calendar.brandId}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      </div>

      {showExport && (
        <ExportCalendarModal
          calendar={{ ...calendar, posts }}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
