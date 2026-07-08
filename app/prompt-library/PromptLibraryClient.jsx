"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Save, RotateCcw, Copy, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS = {
  brand: "Brand",
  image: "Image",
  video: "Video",
  content: "Content",
  calendar: "Calendar",
};

const CATEGORY_ORDER = ["brand", "image", "video", "content", "calendar"];

function groupByCategory(templates) {
  const groups = {};
  for (const tpl of templates) {
    const cat = tpl.category ?? "other";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(tpl);
  }
  return groups;
}

export default function PromptLibraryClient({ initialTemplates }) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedId, setSelectedId] = useState(initialTemplates[0]?.id ?? null);
  const [editText, setEditText] = useState(initialTemplates[0]?.templateText ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  function selectTemplate(tpl) {
    if (dirty) {
      const ok = window.confirm("You have unsaved changes. Discard them?");
      if (!ok) return;
    }
    setSelectedId(tpl.id);
    setEditText(tpl.templateText);
    setDirty(false);
  }

  function handleEdit(e) {
    setEditText(e.target.value);
    setDirty(e.target.value !== selected.templateText);
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/prompt-templates/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateText: editText }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setDirty(false);
      toast.success("Template saved.");
    } catch {
      toast.error("Failed to save template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore() {
    if (!selected) return;
    const ok = window.confirm("Restore the default placeholder text? Your current text will be lost.");
    if (!ok) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/prompt-templates/${selected.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditText(updated.templateText);
      setDirty(false);
      toast.success("Restored default placeholder.");
    } catch {
      toast.error("Failed to restore.");
    } finally {
      setRestoring(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(editText);
    toast.success("Copied to clipboard.");
  }

  const isPlaceholder = selected && editText === selected.defaultTemplateText;
  const groups = groupByCategory(templates);
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => groups[c]),
    ...Object.keys(groups).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border overflow-y-auto">
        <div className="px-3 py-4 space-y-4">
          {orderedCategories.map((cat) => (
            <div key={cat}>
              <p className="px-2 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {CATEGORY_LABELS[cat] ?? cat}
              </p>
              <div className="space-y-0.5">
                {groups[cat].map((tpl) => {
                  const active = tpl.id === selectedId;
                  const isDefault = tpl.templateText === tpl.defaultTemplateText;
                  return (
                    <button
                      key={tpl.id}
                      onClick={() => selectTemplate(tpl)}
                      className={cn(
                        "w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <span className="truncate">{tpl.name}</span>
                      <div className="flex items-center shrink-0 gap-1">
                        {isDefault && (
                          <span className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            active ? "bg-primary-foreground/50" : "bg-muted-foreground/50"
                          )} title="Placeholder (not yet edited)" />
                        )}
                        {active && <ChevronRight className="w-3 h-3" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {selected ? (
          <>
            {/* Header */}
            <div className="shrink-0 px-6 py-4 border-b border-border">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold">{selected.name}</h2>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">
                      {selected.slug}
                    </code>
                    {selected.category && (
                      <Badge variant="secondary" className="text-xs capitalize">
                        {selected.category}
                      </Badge>
                    )}
                    {selected.outputType && (
                      <Badge variant="outline" className="text-xs">
                        output: {selected.outputType}
                      </Badge>
                    )}
                    {isPlaceholder && (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        placeholder
                      </Badge>
                    )}
                    {dirty && (
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">
                        unsaved
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5">
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRestore}
                    disabled={restoring || isPlaceholder}
                    className="gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {restoring ? "Restoring…" : "Restore Default"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || !dirty}
                    className="gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Textarea */}
            <div className="flex-1 p-6 min-h-0">
              <Textarea
                value={editText}
                onChange={handleEdit}
                className="h-full min-h-[400px] font-mono text-sm resize-none"
                placeholder="Paste your prompt template text here…"
                spellCheck={false}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Select a template to edit.
          </div>
        )}
      </div>
    </div>
  );
}
