"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, Sparkles, Loader2, AlertCircle,
  CheckSquare, Square, Trash2, ChevronDown, ChevronUp,
  Plus, RefreshCw, Save, Check,
} from "lucide-react";
import StepCalendarForm from "./StepCalendarForm";
import StepCalendarOutput from "./StepCalendarOutput";
import { ReferenceFileUpload } from "@/components/ReferenceFileUpload";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "@/lib/brand-identity-utils";

// ─── Step Indicator ───────────────────────────────────────────────────────────

const STEPS = ["Select Brand", "Post Suggestor", "Review Ideas", "Calendar Setup", "Review Calendar"];

function StepIndicator({ current }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 ${active ? "text-foreground" : done ? "text-primary" : "text-muted-foreground"}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium border ${
                active ? "border-primary bg-primary text-primary-foreground" :
                done ? "border-primary bg-primary/10 text-primary" :
                "border-border"
              }`}>
                {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className="text-sm hidden sm:inline">{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-6 sm:w-12 ${done ? "bg-primary" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Brand Selection ──────────────────────────────────────────────────

function StepSelectBrand({ initialBrandId, onNext }) {
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [identity, setIdentity] = useState(null);
  const [checkingIdentity, setCheckingIdentity] = useState(false);
  // Incrementing this forces the identity effect to re-run even for the same brand ID
  const [checkTrigger, setCheckTrigger] = useState(0);

  useEffect(() => {
    fetch("/api/brands")
      .then(r => {
        if (!r.ok) {
          return r.json().then(body => { throw new Error(body.error || "Failed to load brands"); });
        }
        return r.json();
      })
      .then(data => {
        if (!Array.isArray(data)) throw new Error("Invalid response from server");
        setBrands(data);
        // A user with exactly one assigned brand has nothing to choose, so
        // preselect it. The list is already scoped server-side, so this can
        // only ever select a brand the user belongs to.
        const preselect = initialBrandId || (data.length === 1 ? data[0].id : null);
        if (preselect) {
          setSelectedId(preselect);
          setCheckingIdentity(true);
          setIdentity(null);
          setCheckTrigger(t => t + 1);
        }
      })
      .catch(err => {
        toast.error(err.message);
        setBrands([]);
      })
      .finally(() => setLoading(false));
  }, [initialBrandId]);

  // Re-fetch identity whenever selectedId or checkTrigger changes
  useEffect(() => {
    if (!selectedId) return;
    fetch(`/api/brands/${selectedId}/identity`)
      .then(async r => {
        if (!r.ok) return [];
        return r.json();
      })
      .then(data => {
        const arr = Array.isArray(data) ? data : [];
        setIdentity(arr.length > 0 ? arr[0] : null);
      })
      .catch(() => setIdentity(null))
      .finally(() => setCheckingIdentity(false));
  }, [selectedId, checkTrigger]);

  const selected = brands.find(b => b.id === selectedId);

  function selectBrand(id) {
    setCheckingIdentity(true);
    setIdentity(null);
    if (id === selectedId) {
      // Same brand clicked — force identity recheck
      setCheckTrigger(t => t + 1);
    } else {
      setSelectedId(id);
    }
  }

  function handleContinue() {
    if (!selectedId) return toast.error("Please select a brand.");
    onNext({ brand: selected, brandIdentity: identity });
  }

  return (
    <PageContainer className="max-w-lg space-y-4">
      <PageHeader
        eyebrow="Content Calendar"
        title="Select Brand"
        description="Choose the brand this content calendar is for."
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading brands…</p>
      ) : brands.length === 0 ? (
        <div className="border border-sketch-line bg-[var(--sketch-paper-bright)] text-center px-[18px] py-4">
          <p className="text-sm text-muted-foreground mb-2">No brands yet.</p>
          <Button asChild size="sm"><Link href="/brands/new">Create a Brand</Link></Button>
        </div>
      ) : (
        <div className="space-y-2">
          {brands.map(b => (
            <button
              key={b.id}
              type="button"
              onClick={() => selectBrand(b.id)}
              className={`w-full text-left bg-[var(--sketch-paper-bright)] border transition-colors ${
                selectedId === b.id
                  ? "border-accent-vermilion"
                  : "border-sketch-line hover:border-foreground/30"
              }`}
            >
              <div className="px-[18px] py-[14px] flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{b.name}</p>
                  {b.businessType && <p className="text-xs text-muted-foreground">{b.businessType}</p>}
                </div>
                {selectedId === b.id && <Check className="w-4 h-4 text-accent-vermilion" />}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Identity status */}
      {selectedId && (
        <div className={`flex items-start gap-3 bg-[var(--sketch-paper-bright)] border px-[18px] py-4 ${
          checkingIdentity ? "border-sketch-line" :
          identity ? "border-green-500/30" : "border-amber-400/40"
        }`}>
          {checkingIdentity ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-0.5 shrink-0" />
          ) : identity ? (
            <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            {checkingIdentity ? (
              <p className="text-xs text-muted-foreground">Checking brand identity…</p>
            ) : identity ? (
              <p className="text-xs text-green-600 dark:text-green-400">
                Brand identity found — AI will use it for smarter suggestions.
              </p>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">No brand identity extracted yet.</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    You can continue, but{" "}
                    <Link href={`/brands/${selectedId}/extract-identity`} className="underline">
                      extracting the brand identity
                    </Link>{" "}
                    first gives much better results.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCheckTrigger(t => t + 1)}
                  className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
                >
                  Recheck
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button asChild variant="outline">
          <Link href="/content-calendar"><ArrowLeft className="w-4 h-4 mr-1.5" />Back</Link>
        </Button>
        <Button onClick={handleContinue} disabled={!selectedId || checkingIdentity} className="gap-1.5">
          Continue <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </PageContainer>
  );
}

// ─── Step 2: Post Suggestor Form ──────────────────────────────────────────────

const PLATFORMS = ["Instagram", "TikTok", "LinkedIn", "Facebook", "YouTube", "Pinterest", "Twitter/X"];

const OBJECTIVE_SUGGESTIONS = [
  "Increase brand awareness",
  "Generate leads",
  "Drive bookings / consultations",
  "Build trust & credibility",
  "Educate audience",
  "Boost engagement & community",
  "Promote new service / product",
  "Drive website traffic",
  "Boost sales / conversions",
  "Grow followers",
];

const OFFERS_SUGGESTIONS = [
  "Free consultation",
  "Free first session",
  "10% discount this month",
  "Limited-time bundle offer",
  "Referral bonus",
  "Free audit / assessment",
  "Seasonal sale",
  "New service launch",
  "Buy one get one free",
];

const LIMITATIONS_SUGGESTIONS = [
  "No stock photos",
  "No competitor mentions",
  "Phone camera only",
  "No price mentions",
  "Avoid political topics",
  "No hard selling",
  "English only",
  "Avoid medical / legal claims",
  "No external links in captions",
  "Max 3 hashtags",
];

const POPULAR_INDUSTRY_POST_TYPES_SUGGESTIONS = [
  "Before and after transformations",
  "Step by step tutorials",
  "Client success stories",
  "Myth vs fact",
  "FAQ posts",
  "Tips and tricks series",
  "Behind the scenes",
  "Product or service spotlights",
  "Common mistakes to avoid",
  "Comparison posts",
  "Day in the life reels",
  "Seasonal promotions",
  "Expert opinion or commentary",
  "User generated content reposts",
  "How it works explainers",
  "Checklist posts",
  "Pros and cons",
  "Case study posts",
];

// ─── LinkedIn resource-based flow ─────────────────────────────────────────────

const LINKEDIN_MAX_POSTS = 50;

function linkedInResourcesStorageKey(brandId) {
  return `content-studio:linkedin-calendar-resources:${brandId}`;
}

function loadLinkedInResources(brandId) {
  if (!brandId) return null;
  try {
    const raw = localStorage.getItem(linkedInResourcesStorageKey(brandId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      resourceUrls: Array.isArray(parsed.resourceUrls) ? parsed.resourceUrls : [""],
      numberOfPosts: parsed.numberOfPosts || "5",
    };
  } catch {
    return null;
  }
}

function saveLinkedInResources(brandId, { resourceUrls, numberOfPosts }) {
  if (!brandId) return;
  try {
    localStorage.setItem(linkedInResourcesStorageKey(brandId), JSON.stringify({ resourceUrls, numberOfPosts }));
  } catch {}
}

// Splits `total` posts as evenly as possible across `n` resources (remainder to the first ones).
function splitCountAcrossResources(total, n) {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const remainder = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

async function safeParseJsonResponse(response) {
  const text = await response.text();
  if (!text || !text.trim()) {
    throw new Error(`Empty response from server (status ${response.status}). Please try again.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    console.error("[Suggestor] Server returned non-JSON:", text.slice(0, 300));
    throw new Error("Server returned an unexpected response. Check the browser console for details.");
  }
}

// Returns a normalised hook for duplicate detection — lowercased alphanumeric
// with whitespace collapsed, so "5 Ways to Improve…" and "5 ways to improve…"
// are recognised as the same hook regardless of casing or punctuation.
function normaliseHook(hook) {
  return (hook || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

// Checks whether a post's hook is a near-duplicate of any already-seen hook.
// Uses exact match + bidirectional containment to catch rephrased variants.
// Very short hooks (< 15 chars normalised) only match on exact equality to
// avoid false positives on terse phrases like "Try This Tip".
function isDuplicateHook(hook, seenHooks) {
  const normalised = normaliseHook(hook);
  if (!normalised) return false;
  return seenHooks.some((existing) => {
    if (existing === normalised) return true;
    if (normalised.length >= 15 || existing.length >= 15) {
      if (existing.includes(normalised) || normalised.includes(existing)) return true;
    }
    return false;
  });
}

// Maps backend error messages to user-facing actionable guidance.
function toActionableLinkedInError(message) {
  if (/took too long|timed out|timeout/i.test(message)) {
    return {
      userMessage: "This site took too long to respond. Try a specific blog/article URL from the same site.",
      isTemplateError: false,
    };
  }
  if (/no article links could be found|could not fetch content from any candidate/i.test(message)) {
    return {
      userMessage: "We could not read article content from this page. Try pasting a direct blog/article URL.",
      isTemplateError: false,
    };
  }
  if (/template not found|linkedin-post-from-reference/i.test(message)) {
    return {
      userMessage: "LinkedIn prompt template is missing. Add linkedin-post-from-reference in Prompt Templates.",
      isTemplateError: true,
    };
  }
  return { userMessage: null, isTemplateError: false };
}

// Calls the single-resource LinkedIn suggest-posts endpoint once per resource URL,
// splitting the requested count across resources, and merges the results.
// When some resources fail, retries the shortfall against the successful ones so
// the final count stays as close to the requested number as possible.
async function fetchLinkedInSuggestions({ brandId, resourceUrls, numberOfPosts, attachmentIds = [] }) {
  const counts = splitCountAcrossResources(numberOfPosts, resourceUrls.length);
  const pairs = resourceUrls.map((url, i) => ({ url, count: counts[i] })).filter(p => p.count > 0);

  const results = await Promise.allSettled(
    pairs.map(({ url, count }) =>
      fetch("/api/content-calendar/linkedin/suggest-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, resourceUrl: url, numberOfPosts: count, attachmentIds }),
      }).then(async (res) => {
        const data = await safeParseJsonResponse(res);
        if (!res.ok || data.success === false) {
          const base = data.error ?? `Failed to generate posts for ${url}`;
          // data.details carries the specific backend reason (e.g. the exact
          // validation error from normalizeResourceUrl) — surface it alongside
          // the generic message instead of only showing the generic one.
          const message = data.details && data.details !== base ? `${base} ${data.details}` : base;
          throw new Error(message);
        }
        return { ...data, _requestUrl: url };
      })
    )
  );

  const succeeded = [];
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") succeeded.push(r.value);
    else {
      const rawMessage = r.reason?.message ?? "Request failed.";
      const { userMessage, isTemplateError } = toActionableLinkedInError(rawMessage);
      const duplicateTemplate = isTemplateError && failed.some(f => f._isTemplateError);
      failed.push({
        url: pairs[i].url,
        message: duplicateTemplate ? "LinkedIn prompt template is missing." : (userMessage || rawMessage),
        _technical: (userMessage || duplicateTemplate) ? rawMessage : undefined,
        _isTemplateError: isTemplateError,
      });
    }
  });

  // ── Merge posts from first pass, deduplicating hooks ─────────────────────
  const allPosts = [];
  const articlesUsed = [];
  const seenHooks = [];

  succeeded.forEach((data) => {
    (data.posts ?? []).forEach((p) => {
      if (!isDuplicateHook(p.suggestedHook, seenHooks)) {
        seenHooks.push(normaliseHook(p.suggestedHook));
        allPosts.push(p);
      }
    });
    (data.articlesUsed ?? []).forEach((a) => {
      if (!articlesUsed.some((existing) => existing.url === a.url)) articlesUsed.push(a);
    });
  });

  // ── Retry shortfall with successful resource URLs ─────────────────────────
  // If some resources failed and we're below the requested count, reuse the
  // URLs that did work to request the remaining ideas. Each retry distributes
  // the shortfall across all known-good URLs.
  const MAX_RETRIES = 2;
  let retryAttempt = 0;

  while (allPosts.length < numberOfPosts && succeeded.length > 0 && retryAttempt < MAX_RETRIES) {
    const shortfall = numberOfPosts - allPosts.length;
    const successUrls = succeeded.map((s) => s._requestUrl);
    const retryCounts = splitCountAcrossResources(shortfall, successUrls.length);
    const retryPairs = successUrls.map((url, i) => ({ url, count: retryCounts[i] })).filter((p) => p.count > 0);

    retryAttempt++;

    const retryResults = await Promise.allSettled(
      retryPairs.map(({ url, count }) =>
        fetch("/api/content-calendar/linkedin/suggest-posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brandId, resourceUrl: url, numberOfPosts: count, attachmentIds }),
        }).then(async (res) => {
          const data = await safeParseJsonResponse(res);
          if (!res.ok || data.success === false) {
            const base = data.error ?? `Failed to generate posts for ${url}`;
            const message = data.details && data.details !== base ? `${base} ${data.details}` : base;
            throw new Error(message);
          }
          return data;
        })
      )
    );

    retryResults.forEach((r) => {
      if (r.status === "fulfilled") {
        const data = r.value;
        (data.posts ?? []).forEach((p) => {
          if (!isDuplicateHook(p.suggestedHook, seenHooks)) {
            seenHooks.push(normaliseHook(p.suggestedHook));
            allPosts.push(p);
          }
        });
        (data.articlesUsed ?? []).forEach((a) => {
          if (!articlesUsed.some((existing) => existing.url === a.url)) articlesUsed.push(a);
        });
      }
    });
  }

  const shortfall = allPosts.length < numberOfPosts;

  if (shortfall) {
    console.warn(
      `[Suggestor] SHORTFALL: got ${allPosts.length} / ${numberOfPosts} after ${MAX_RETRIES} frontend retries` +
      (succeeded.length ? ` (${succeeded.length} succeeded)` : "") +
      (failed.length ? `, ${failed.length} failed` : "")
    );
  }

  return {
    posts: allPosts.slice(0, numberOfPosts).map((p, i) => ({ ...p, postNumber: i + 1 })),
    articlesUsed,
    model: succeeded[0]?.model,
    usage: succeeded[0]?.usage,
    failed,
    shortfall,
    shortfallMessage: shortfall
      ? `Only ${allPosts.length} of ${numberOfPosts} post ideas could be generated. Try adding more resources or reducing the requested count.`
      : undefined,
  };
}

function formatPeriod(start, end) {
  if (!start && !end) return "";
  const toDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  if (!end || start === end) {
    return start ? toDate(start).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
  }
  const s = toDate(start);
  const e = toDate(end);
  const sStr = s.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const eStr = e.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `${sStr} – ${eStr}`;
}

// Input/Textarea with multi-select suggestion chips
// - autoComplete="off" prevents browser autocomplete
// - Picked chips disappear from available list, shown as removable badges
// - append=true → newline separator (textareas); false → ", " (single-line)
function SuggestField({ id, label, hint, value, onChange, suggestions, rows, placeholder, append = false }) {
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState([]);

  const separator = append ? "\n" : ", ";
  const available = (suggestions ?? []).filter(s => !picked.includes(s));

  function selectChip(s) {
    const next = [...picked, s];
    setPicked(next);
    onChange(next.join(separator));
  }

  function removeChip(s) {
    const next = picked.filter(c => c !== s);
    setPicked(next);
    onChange(next.join(separator));
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {hint && <span className="text-muted-foreground font-normal ml-1 text-xs">— {hint}</span>}
      </Label>

      {/* Selected chips */}
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map(s => (
            <span key={s} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-primary text-primary-foreground">
              {s}
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => removeChip(s)}
                className="ml-0.5 hover:opacity-70 leading-none"
                aria-label={`Remove ${s}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {rows ? (
        <Textarea id={id} value={value} onChange={e => onChange(e.target.value)} rows={rows}
          className="resize-none" placeholder={placeholder}
          autoComplete="off"
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
      ) : (
        <Input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          autoComplete="off"
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
      )}

      {/* Available chips (focus only, excludes already-picked) */}
      {focused && available.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {available.map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => selectChip(s)}
              className="text-xs px-2.5 py-1 rounded-full border border-border bg-muted/60 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StepSuggestorForm({ brand, brandIdentity, form, setForm, onBack, onGenerated, referenceAttachments, setReferenceAttachments }) {
  const [showIdentity, setShowIdentity] = useState(false);
  const [generating, setGenerating] = useState(false);

  const isLinkedIn = form.platform === "LinkedIn";

  // ── LinkedIn resource-based fields (persisted per-brand in localStorage) ──────
  // Lazily seeded from localStorage at mount time — StepSuggestorForm remounts
  // fresh whenever the user (re-)enters this step, so a lazy initializer covers
  // both "arrived with LinkedIn already selected" and "arrived with another
  // platform selected" (the latter is (re)loaded explicitly in selectPlatform).
  const [linkedInResources, setLinkedInResources] = useState(() =>
    isLinkedIn && brand?.id ? (loadLinkedInResources(brand.id)?.resourceUrls?.length ? loadLinkedInResources(brand.id).resourceUrls : [""]) : [""]
  );
  const [linkedInNumberOfPosts, setLinkedInNumberOfPosts] = useState(() =>
    isLinkedIn && brand?.id ? (loadLinkedInResources(brand.id)?.numberOfPosts || "5") : "5"
  );
  const [linkedInErrors, setLinkedInErrors] = useState([]);
  const [linkedInLoading, setLinkedInLoading] = useState(false);

  function selectPlatform(p) {
    set("platform", p);
    if (p === "LinkedIn" && brand?.id) {
      const saved = loadLinkedInResources(brand.id);
      setLinkedInResources(saved?.resourceUrls?.length ? saved.resourceUrls : [""]);
      setLinkedInNumberOfPosts(saved?.numberOfPosts || "5");
      setLinkedInErrors([]);
    }
  }

  function persistLinkedInResources(resources, count) {
    saveLinkedInResources(brand.id, { resourceUrls: resources, numberOfPosts: count });
  }

  function updateLinkedInResource(idx, value) {
    setLinkedInResources(prev => {
      const next = prev.map((u, i) => (i === idx ? value : u));
      persistLinkedInResources(next, linkedInNumberOfPosts);
      return next;
    });
  }

  function addLinkedInResource() {
    setLinkedInResources(prev => {
      const next = [...prev, ""];
      persistLinkedInResources(next, linkedInNumberOfPosts);
      return next;
    });
  }

  function removeLinkedInResource(idx) {
    setLinkedInResources(prev => {
      const next = prev.filter((_, i) => i !== idx);
      persistLinkedInResources(next, linkedInNumberOfPosts);
      return next;
    });
  }

  function changeLinkedInNumberOfPosts(value) {
    setLinkedInNumberOfPosts(value);
    persistLinkedInResources(linkedInResources, value);
  }

  async function handleGenerateLinkedIn() {
    const nonEmpty = linkedInResources.map(u => u.trim()).filter(Boolean);
    if (!nonEmpty.length) return toast.error("Please add at least one resource URL.");
    const count = parseInt(linkedInNumberOfPosts, 10);
    if (!Number.isInteger(count) || count < 1 || count > LINKEDIN_MAX_POSTS) {
      return toast.error(`Number of posts must be between 1 and ${LINKEDIN_MAX_POSTS}.`);
    }
    setLinkedInLoading(true);
    setLinkedInErrors([]);
    try {
      const attachmentIds = referenceAttachments.map(a => a.id);
      const result = await fetchLinkedInSuggestions({ brandId: brand.id, resourceUrls: nonEmpty, numberOfPosts: count, attachmentIds });
      if (result.failed.length) {
        setLinkedInErrors(result.failed);
        result.failed.forEach(f => {
          console.error(`[Suggestor] LinkedIn resource error for ${f.url}: ${f._technical || f.message}`);
          toast.error(`${f.url}: ${f.message}`);
        });
      }
      if (!result.posts.length) {
        throw new Error("No post ideas were returned from the provided resources.");
      }
      if (result.shortfall) {
        setLinkedInErrors(prev => [...prev, { url: "(overall)", message: result.shortfallMessage }]);
        throw new Error(result.shortfallMessage);
      }
      onGenerated({
        posts: result.posts,
        seasonalDates: [],
        formData: {
          ...form,
          platform: "LinkedIn",
          resourceUrls: nonEmpty,
          articlesUsed: result.articlesUsed,
          numberOfPosts: String(count),
          calendarPeriod: "",
        },
        model: result.model,
        usage: result.usage,
        requestedCount: count,
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLinkedInLoading(false);
    }
  }

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleGenerate() {
    if (!form.monthlyObjective.trim()) return toast.error("Monthly objective is required.");
    try {
      localStorage.setItem(`suggestorDefaults:${brand.id}`, JSON.stringify({
        popularIndustryPosts:      form.popularIndustryPosts,
        importantIndustryWebsites: form.importantIndustryWebsites,
        competitorPages:           form.competitorPages,
      }));
    } catch {}
    setGenerating(true);
    try {
      const calendarPeriod = formatPeriod(form.calendarPeriodStart, form.calendarPeriodEnd);
      const attachmentIds = referenceAttachments.map(a => a.id);
      const body = {
        brandId: brand.id,
        ...form,
        calendarPeriod,
        calendarPeriodStart: form.calendarPeriodStart,
        calendarPeriodEnd: form.calendarPeriodEnd,
      };
      if (attachmentIds.length > 0) body.attachmentIds = attachmentIds;
      const res = await fetch("/api/content-calendar/suggest-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await safeParseJsonResponse(res);

      if (!res.ok || data.success === false) {
        const msg = data.error ?? "Generation failed.";
        if (data.details) console.error("[SuggestorForm] Server error details:", data.details);
        throw new Error(msg);
      }

      if (!data.posts?.length) {
        console.warn("[SuggestorForm] 0 posts returned. Raw AI output may be in server logs.");
        throw new Error("No post ideas returned. Check that the post-suggestor template has real content in the Prompt Library.");
      }

      onGenerated({
        posts: data.posts,
        seasonalDates: data.seasonalDates ?? [],
        formData: { ...form, calendarPeriod },
        model: data.model,
        usage: data.usage,
        requestedCount: data.requestedCount,
      });
    } catch (err) {
      console.error("[SuggestorForm] Generation error:", err);
      toast.error(
        err.message.includes("Unexpected") || err.message.includes("JSON")
          ? "Post idea generation failed. Please try again or reduce the number of posts."
          : err.message
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <PageContainer className="max-w-2xl space-y-4">
      <PageHeader
        eyebrow="Content Calendar"
        title="Post Suggestor"
        description="Set the source inputs and context used to generate post ideas."
      />

      {/* Brand info */}
      <div className="border border-sketch-line bg-[var(--sketch-paper-bright)] px-[18px] py-4 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{brand.name}</p>
            <p className="text-xs text-muted-foreground">{brand.businessType}{brand.businessLocation ? ` · ${brand.businessLocation}` : ""}</p>
          </div>
          {brandIdentity && (
            <button type="button" onClick={() => setShowIdentity(v => !v)} className="text-xs text-primary hover:underline flex items-center gap-1">
              Brand Identity {showIdentity ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
        {showIdentity && brandIdentity && (() => {
          const { brandVisualIdentity } = normalizeBrandIdentityOutput(brandIdentity);
          const preview = brandIdentity.editableSummary?.trim()
            || createCompactBrandVisualIdentitySummaryForImagePrompt(brandVisualIdentity)
            || "(Brand identity extracted — no preview available.)";
          return (
            <pre className="mt-2 bg-muted rounded p-2 text-xs overflow-auto max-h-40 whitespace-pre-wrap break-words">
              {preview}
            </pre>
          );
        })()}
      </div>

      {/* Platform */}
      <div className="border border-sketch-line bg-[var(--sketch-paper-bright)]">
        <div className="px-[18px] py-[12px] border-b border-[var(--sketch-line-soft)]">
          <span className="label-sketch">Platform *</span>
        </div>
        <div className="px-[18px] py-4">
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map(p => (
              <Badge
                key={p}
                variant={form.platform === p ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => selectPlatform(p)}
              >{p}</Badge>
            ))}
          </div>
        </div>
      </div>

      {isLinkedIn ? (
        <>
          {/* LinkedIn resource-based fields */}
          <div className="border border-sketch-line bg-[var(--sketch-paper-bright)]">
            <div className="px-[18px] py-[12px] border-b border-[var(--sketch-line-soft)]">
              <span className="label-sketch">Resource URLs *</span>
            </div>
            <div className="px-[18px] py-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Blog posts, articles, or pages to draw LinkedIn post ideas from — every generated post will be based on one of these resources.
              </p>
              {linkedInResources.length === 0 && (
                <p className="text-xs text-muted-foreground">No resources added yet.</p>
              )}
              <div className="space-y-2">
                {linkedInResources.map((url, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      type="url"
                      value={url}
                      onChange={e => updateLinkedInResource(idx, e.target.value)}
                      placeholder="https://example.com/blog/some-article"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => removeLinkedInResource(idx)}
                      aria-label="Remove resource"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addLinkedInResource} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" />Add resource
              </Button>
            </div>
          </div>

          <div className="border border-sketch-line bg-[var(--sketch-paper-bright)] px-[18px] py-4">
            <div className="space-y-1.5 max-w-xs">
              <Label htmlFor="linkedInNumberOfPosts">Number of Posts</Label>
              <Input
                id="linkedInNumberOfPosts"
                type="number"
                min={1}
                max={LINKEDIN_MAX_POSTS}
                value={linkedInNumberOfPosts}
                onChange={e => changeLinkedInNumberOfPosts(e.target.value)}
              />
            </div>
          </div>

          <ReferenceFileUpload
            brandId={brand.id}
            attachments={referenceAttachments}
            onAttachmentsChange={setReferenceAttachments}
            disabled={linkedInLoading}
          />

          {linkedInErrors.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 space-y-1">
              {linkedInErrors.map((f, i) => (
                <p key={i} className="text-xs text-destructive">
                  <span className="font-medium">{f.url}</span>: {f.message}
                  {f._technical && (
                    <span className="block text-muted-foreground mt-0.5 font-normal">{f._technical}</span>
                  )}
                </p>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-1.5" />Back
            </Button>
            <Button onClick={handleGenerateLinkedIn} disabled={linkedInLoading} className="gap-2">
              {linkedInLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" />Suggesting…</>
                : <><Sparkles className="w-4 h-4" />Suggest LinkedIn Posts</>}
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* Primary Fields */}
          <div className="border border-sketch-line bg-[var(--sketch-paper-bright)]">
            <div className="px-[18px] py-[12px] border-b border-[var(--sketch-line-soft)]">
              <span className="label-sketch">Primary Fields</span>
            </div>
            <div className="px-[18px] py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SuggestField
                  id="monthlyObjective"
                  label="Monthly Objective *"
                  value={form.monthlyObjective}
                  onChange={v => set("monthlyObjective", v)}
                  suggestions={OBJECTIVE_SUGGESTIONS}
                  placeholder="e.g. Increase brand awareness"
                />

                {/* Calendar period — date range picker */}
                <div className="space-y-1.5">
                  <Label>Calendar Period</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Start</span>
                      <Input
                        type="date"
                        value={form.calendarPeriodStart}
                        onChange={e => set("calendarPeriodStart", e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">End</span>
                      <Input
                        type="date"
                        value={form.calendarPeriodEnd}
                        onChange={e => set("calendarPeriodEnd", e.target.value)}
                        min={form.calendarPeriodStart || undefined}
                        className="text-sm"
                      />
                    </div>
                  </div>
                  {(form.calendarPeriodStart || form.calendarPeriodEnd) && (
                    <p className="text-xs text-muted-foreground">
                      {formatPeriod(form.calendarPeriodStart, form.calendarPeriodEnd)}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="numberOfPosts">Number of Posts</Label>
                  <Input id="numberOfPosts" type="number" min={1} max={60} value={form.numberOfPosts} onChange={e => set("numberOfPosts", e.target.value)} />
                </div>

                <SuggestField
                  id="offers"
                  label="Current Offers / Promotions"
                  value={form.offers}
                  onChange={v => set("offers", v)}
                  suggestions={OFFERS_SUGGESTIONS}
                  placeholder="e.g. Free brand audit in June"
                />
              </div>
            </div>
          </div>

          {/* Industry Research */}
          <div className="border border-sketch-line bg-[var(--sketch-paper-bright)]">
            <div className="px-[18px] py-[12px] border-b border-[var(--sketch-line-soft)]">
              <span className="label-sketch">Industry Research</span>
            </div>
            <div className="px-[18px] py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SuggestField
                  id="popularIndustryPosts"
                  label="Popular Industry Post Types"
                  value={form.popularIndustryPosts}
                  onChange={v => set("popularIndustryPosts", v)}
                  suggestions={POPULAR_INDUSTRY_POST_TYPES_SUGGESTIONS}
                  rows={2}
                  placeholder="Before and after transformations, tips series, client stories…"
                  append
                />
                <div className="space-y-1.5">
                  <Label htmlFor="importantIndustryWebsites">Key Industry Websites / Blogs</Label>
                  <Textarea id="importantIndustryWebsites" value={form.importantIndustryWebsites} onChange={e => set("importantIndustryWebsites", e.target.value)} placeholder="designmilk.com, creativebloq.com…" rows={2} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="competitorPages">Competitor Pages to Reference</Label>
                  <Textarea id="competitorPages" value={form.competitorPages} onChange={e => set("competitorPages", e.target.value)} placeholder="@competitor1, @competitor2…" rows={2} />
                </div>
              </div>
            </div>
          </div>

          {/* Campaign Context */}
          <div className="border border-sketch-line bg-[var(--sketch-paper-bright)]">
            <div className="px-[18px] py-[12px] border-b border-[var(--sketch-line-soft)]">
              <span className="label-sketch">Campaign Context</span>
            </div>
            <div className="px-[18px] py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="campaignEvents">Campaign Events</Label>
                  <Textarea id="campaignEvents" value={form.campaignEvents} onChange={e => set("campaignEvents", e.target.value)} placeholder="Brand awareness week June 10–14…" rows={2} />
                </div>
                <div className="space-y-1.5">
                  <Label>Seasonal / Important Dates</Label>
                  <p className="text-xs text-muted-foreground">
                    The app will automatically detect relevant seasonal dates from your calendar period and location — they&apos;ll appear as a separate table in the next step for you to select.
                  </p>
                </div>
                <SuggestField
                  id="contentLimitations"
                  label="Content Limitations / Restrictions"
                  value={form.contentLimitations}
                  onChange={v => set("contentLimitations", v)}
                  suggestions={LIMITATIONS_SUGGESTIONS}
                  rows={2}
                  placeholder="No stock photos, avoid competitor mentions…"
                  append
                />
              </div>
            </div>
          </div>

          {/* Additional Notes */}
          <div className="border border-sketch-line bg-[var(--sketch-paper-bright)]">
            <div className="px-[18px] py-[12px] border-b border-[var(--sketch-line-soft)]">
              <span className="label-sketch">Additional Notes</span>
            </div>
            <div className="px-[18px] py-4">
              <Textarea id="additionalNotes" value={form.additionalNotes} onChange={e => set("additionalNotes", e.target.value)} placeholder="Any other context or special instructions for the AI…" rows={3} />
            </div>
          </div>

          <ReferenceFileUpload
            brandId={brand.id}
            attachments={referenceAttachments}
            onAttachmentsChange={setReferenceAttachments}
            disabled={generating}
          />

          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-1.5" />Back
            </Button>
            <Button onClick={handleGenerate} disabled={generating} className="gap-2 flex-1 sm:flex-none">
              {generating
                ? <><Loader2 className="w-4 h-4 animate-spin" />Generating…</>
                : <><Sparkles className="w-4 h-4" />Generate {form.numberOfPosts} Post Ideas</>}
            </Button>
          </div>
        </>
      )}
    </PageContainer>
  );
}

// ─── Post Card ────────────────────────────────────────────────────────────────

function PostCard({ post, selected, onToggle, onUpdate, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post);

  function handleSave() {
    onUpdate(draft);
    setEditing(false);
  }
  function handleCancel() {
    setDraft(post);
    setEditing(false);
  }

  const hook = post.suggestedHook || `Post ${post.postNumber}`;

  return (
    <Card className={`transition-colors ${selected ? "border-primary/50 bg-primary/5" : ""}`}>
      <CardContent className="pt-4 pb-3">
        {/* Top row */}
        <div className="flex items-start gap-3">
          <button type="button" onClick={onToggle} className="mt-0.5 shrink-0">
            {selected
              ? <CheckSquare className="w-4 h-4 text-primary" />
              : <Square className="w-4 h-4 text-muted-foreground" />}
          </button>
          <div className="flex-1 min-w-0">
            {editing ? (
              <Input
                value={draft.suggestedHook}
                onChange={e => setDraft(d => ({ ...d, suggestedHook: e.target.value }))}
                className="text-sm font-medium mb-1"
                placeholder="Hook"
              />
            ) : (
              <p className="text-sm font-medium leading-snug">{hook}</p>
            )}
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              {post.platform && <Badge variant="secondary" className="text-xs">{post.platform}</Badge>}
              {post.format && <Badge variant="outline" className="text-xs">{post.format}</Badge>}
              <span className="text-xs text-muted-foreground">#{post.postNumber}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={() => { setExpanded(v => !v); setEditing(false); }} className="text-muted-foreground hover:text-foreground">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Summary row */}
        {!expanded && post.mainAngleAndCoreMessage && (
          <p className="text-xs text-muted-foreground mt-1.5 ml-7 line-clamp-2">{post.mainAngleAndCoreMessage}</p>
        )}
        {!expanded && post.referenceLink && (
          <p className="text-xs text-muted-foreground mt-1 ml-7 truncate">
            Source: <a href={post.referenceLink} target="_blank" rel="noreferrer" className="underline">{post.inspirationSource || post.referenceLink}</a>
          </p>
        )}

        {/* Expanded content */}
        {expanded && (
          <div className="mt-3 ml-7 space-y-3">
            {editing ? (
              <>
                {[
                  { key: "mainAngleAndCoreMessage", label: "Core Message" },
                  { key: "suggestedCaption", label: "Suggested Caption" },
                  { key: "visualDirection", label: "Visual Direction" },
                  { key: "contentStructure", label: "Content Structure" },
                  { key: "hashtags", label: "Hashtags" },
                ].map(({ key, label }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Textarea
                      value={draft[key] ?? ""}
                      onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                      rows={2}
                      className="text-xs"
                    />
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSave} className="gap-1"><Check className="w-3 h-3" />Save</Button>
                  <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
                </div>
              </>
            ) : (
              <>
                {[
                  { key: "mainAngleAndCoreMessage", label: "Core Message" },
                  { key: "suggestedCaption", label: "Caption" },
                  { key: "visualDirection", label: "Visual Direction" },
                  { key: "contentStructure", label: "Structure" },
                  { key: "hashtags", label: "Hashtags" },
                ].filter(f => post[f.key]).map(({ key, label }) => (
                  <div key={key}>
                    <p className="text-xs font-medium text-muted-foreground">{label}</p>
                    <p className="text-xs mt-0.5">{post[key]}</p>
                  </div>
                ))}
                {post.referenceLink && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Reference Link</p>
                    <a href={post.referenceLink} target="_blank" rel="noreferrer" className="text-xs mt-0.5 underline break-all block">
                      {post.referenceLink}
                    </a>
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={() => { setDraft(post); setEditing(true); }}>
                  Edit this post
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Step 2: Review Post Ideas ────────────────────────────────────────────────

function StepReviewAndSave({ brand, formData, initialPosts, seasonalDates = [], model, usage, requestedCount, onBack, onNextStep }) {
  const router = useRouter();
  const [posts, setPosts] = useState(() =>
    initialPosts.map((p, i) => ({ ...p, _id: `${Date.now()}-${i}` }))
  );
  const [selected, setSelected] = useState(() => new Set(posts.map(p => p._id)));
  const [calendarTitle, setCalendarTitle] = useState(`${brand.name} — ${formData.calendarPeriod || formData.platform}`);
  const [selectedDateIndices, setSelectedDateIndices] = useState(new Set());
  const [datesCollapsed, setDatesCollapsed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  function togglePost(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleDate(idx) {
    setSelectedDateIndices(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  function toggleAllDates() {
    if (selectedDateIndices.size === seasonalDates.length) setSelectedDateIndices(new Set());
    else setSelectedDateIndices(new Set(seasonalDates.map((_, i) => i)));
  }

  function toggleAll() {
    if (selected.size === posts.length) setSelected(new Set());
    else setSelected(new Set(posts.map(p => p._id)));
  }

  function removePost(id) {
    setPosts(prev => prev.filter(p => p._id !== id));
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
  }

  function updatePost(id, updated) {
    setPosts(prev => prev.map(p => p._id === id ? { ...p, ...updated } : p));
  }

  async function handleGenerateMore() {
    setGenerating(true);
    try {
      let rawPosts;
      if (formData.platform === "LinkedIn") {
        const result = await fetchLinkedInSuggestions({
          brandId: brand.id,
          resourceUrls: formData.resourceUrls ?? [],
          numberOfPosts: requestedCount || 6,
        });
        if (result.failed.length) {
          result.failed.forEach(f => {
            console.error(`[Suggestor] LinkedIn resource error for ${f.url}: ${f._technical || f.message}`);
            toast.error(`${f.url}: ${f.message}`);
          });
        }
        if (result.shortfall) {
          throw new Error(result.shortfallMessage);
        }
        rawPosts = result.posts;
      } else {
        const res = await fetch("/api/content-calendar/suggest-posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brandId: brand.id, ...formData, numberOfPosts: "6" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed.");
        rawPosts = data.posts ?? [];
      }
      const newPosts = rawPosts.map((p, i) => ({
        ...p,
        postNumber: posts.length + i + 1,
        _id: `${Date.now()}-${i}`,
      }));
      setPosts(prev => [...prev, ...newPosts]);
      setSelected(prev => {
        const next = new Set(prev);
        newPosts.forEach(p => next.add(p._id));
        return next;
      });
      toast.success(`${newPosts.length} more ideas added.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!calendarTitle.trim()) return toast.error("Calendar title is required.");
    const selectedPosts = posts.filter(p => selected.has(p._id));
    if (!selectedPosts.length) return toast.error("Select at least one post.");
    setSaving(true);
    try {
      console.log("[QuickSave] Saving", selectedPosts.length, "posts for brand", brand.id);
      const res = await fetch("/api/calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: calendarTitle,
          brandId: brand.id,
          platform: formData.platform,
          timePeriod: formData.calendarPeriod,
          mainGoal: formData.monthlyObjective,
          mainOfferOrMessage: formData.offers ?? "",
          posts: selectedPosts.map(({ _id, ...p }) => p),
        }),
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error("Server returned an unexpected response. Check logs."); }

      console.log("[QuickSave] Response:", res.status, data?.success, data?.error);

      if (!res.ok || data?.success === false) {
        if (data?.details) console.error("[QuickSave] details:", data.details);
        throw new Error(data?.error ?? "Content calendar could not be saved.");
      }

      toast.success(`Calendar saved with ${selectedPosts.length} posts!`);
      router.push(`/content-calendar/${data.id}`);
    } catch (err) {
      console.error("[QuickSave] Error:", err);
      toast.error(err.message ?? "Content calendar could not be saved.");
      setSaving(false);
    }
  }

  const selectedCount = selected.size;

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header stats */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-medium">
            {posts.length} post idea{posts.length !== 1 ? "s" : ""} generated
            {requestedCount && posts.length !== requestedCount
              ? <span className="text-xs text-amber-500 ml-1.5">(requested {requestedCount})</span>
              : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {selectedCount} selected · {brand.name}
            {model && ` · ${model}`}{usage ? ` · ${usage.total_tokens} tokens` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={toggleAll}>
            {selectedCount === posts.length ? "Deselect All" : "Select All"}
          </Button>
          <Button variant="outline" size="sm" disabled={generating} onClick={handleGenerateMore} className="gap-1.5">
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            More Ideas
          </Button>
        </div>
      </div>

      {/* Posts */}
      <div className="space-y-2">
        {posts.map(post => (
          <PostCard
            key={post._id}
            post={post}
            selected={selected.has(post._id)}
            onToggle={() => togglePost(post._id)}
            onUpdate={updated => updatePost(post._id, updated)}
            onRemove={() => removePost(post._id)}
          />
        ))}
      </div>

      {/* ── Seasonal dates section ─────────────────────────────────── */}
      {seasonalDates.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setDatesCollapsed(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Seasonal &amp; Important Dates</span>
              <Badge variant="secondary" className="text-xs">{selectedDateIndices.size} / {seasonalDates.length} selected</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Detected from your calendar period</span>
              {datesCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
            </div>
          </button>

          {!datesCollapsed && (
            <div className="border-t border-border">
              <div className="px-4 py-2 flex items-center justify-between bg-muted/10">
                <p className="text-xs text-muted-foreground">
                  Select dates to anchor content around. They&apos;ll be added as context for the calendar generator.
                </p>
                <button type="button" onClick={toggleAllDates} className="text-xs text-primary hover:underline shrink-0 ml-2">
                  {selectedDateIndices.size === seasonalDates.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="px-3 py-2 w-8"></th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-32">Date</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-40">Event</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-20">Relevance</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground flex-1">Content Angle</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-24">Post Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seasonalDates.map((d, i) => {
                      const checked = selectedDateIndices.has(i);
                      return (
                        <tr
                          key={i}
                          onClick={() => toggleDate(i)}
                          className={`border-t border-border/50 cursor-pointer transition-colors ${
                            checked ? "bg-primary/5" : i % 2 === 0 ? "bg-background" : "bg-muted/10"
                          } hover:bg-primary/5`}
                        >
                          <td className="px-3 py-2.5">
                            {checked
                              ? <CheckSquare className="w-4 h-4 text-primary" />
                              : <Square className="w-4 h-4 text-muted-foreground" />}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs font-medium">{d.date}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs">{d.name}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge
                              variant={d.relevance === "High" ? "default" : d.relevance === "Medium" ? "secondary" : "outline"}
                              className="text-xs"
                            >
                              {d.relevance}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs text-muted-foreground">{d.contentAngle}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs text-muted-foreground">{d.suggestedPostType}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <Separator />

      {/* Actions */}
      <div className="space-y-3">
        {/* Primary: generate full calendar */}
        <Button
          onClick={() => {
            const selectedPosts = posts.filter(p => selected.has(p._id));
            if (!selectedPosts.length) return toast.error("Select at least one post idea first.");
            const chosenDates = seasonalDates.filter((_, i) => selectedDateIndices.has(i));
            onNextStep({ selectedPosts, chosenSeasonalDates: chosenDates });
          }}
          disabled={!selectedCount}
          className="w-full gap-2"
          size="lg"
        >
          <Sparkles className="w-4 h-4" />
          Generate Full Calendar with {selectedCount} Idea{selectedCount !== 1 ? "s" : ""}
          <ArrowRight className="w-4 h-4" />
        </Button>

        {/* Secondary: quick save */}
        <div className="rounded-lg border border-border p-4 space-y-3">
          <p className="text-xs text-muted-foreground font-medium">Or quick-save post ideas as a basic calendar:</p>
          <div className="space-y-1.5">
            <Label htmlFor="calendarTitle">Calendar Title</Label>
            <Input
              id="calendarTitle"
              value={calendarTitle}
              onChange={e => setCalendarTitle(e.target.value)}
              placeholder="e.g. June Instagram Ideas"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack} size="sm">
              <ArrowLeft className="w-4 h-4 mr-1.5" />Back
            </Button>
            <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving || !selectedCount} className="gap-1.5">
              {saving
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</>
                : <><Save className="w-3.5 h-3.5" />Quick Save {selectedCount} Post{selectedCount !== 1 ? "s" : ""}</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function CreateCalendarInner() {
  const searchParams = useSearchParams();
  const initialBrandId = searchParams.get("brandId");

  const [step, setStep] = useState(0);
  const [brand, setBrand] = useState(null);
  const [brandIdentity, setBrandIdentity] = useState(null);
  const [suggestorForm, setSuggestorForm] = useState({
    platform: "Instagram",
    monthlyObjective: "",
    calendarPeriodStart: "",
    calendarPeriodEnd: "",
    numberOfPosts: "12",
    popularIndustryPosts: "",
    importantIndustryWebsites: "",
    competitorPages: "",
    campaignEvents: "",
    offers: "",
    contentLimitations: "",
    additionalNotes: "",
  });
  const [suggestorFormData, setSuggestorFormData] = useState(null);
  const [generatedPosts, setGeneratedPosts] = useState(null);
  const [seasonalDates, setSeasonalDates] = useState([]);
  const [suggestionMeta, setSuggestionMeta] = useState(null);
  const [referenceAttachments, setReferenceAttachments] = useState([]);
  // Step 3 → selected post ideas passed forward
  const [selectedPostIdeas, setSelectedPostIdeas] = useState([]);
  const [prefillCampaignEvents, setPrefillCampaignEvents] = useState("");
  const [selectedSeasonalDates, setSelectedSeasonalDates] = useState([]);
  const [calendarForm, setCalendarForm] = useState({
    mainMonthlySubject: "",
    mainLandingPageOrServicePage: "",
    mainGoal: "",
    mainOfferOrMessage: "",
    importantDetailsToInclude: "",
    detailsNotToInvent: "",
    sourceMaterial: "",
    priorityContentIdeas: "",
    platforms: "Instagram",
    numberOfPostsNeeded: "12",
    publishingFrequency: "",
    requiredPostFormats: "",
    videoCreationTool: "",
    videoProductionLimitation: "",
    contentStrategyRules: "",
    audienceLanguageRules: "",
    writingStyleRules: "",
    targetAudience: "",
  });
  // Step 4 → calendar generator output
  const [calendarPosts, setCalendarPosts] = useState([]);
  const [calendarRaw, setCalendarRaw] = useState("");
  const [calendarFormData, setCalendarFormData] = useState(null);
  const [calendarMeta, setCalendarMeta] = useState(null);

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/content-calendar"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <h1 className="text-xl font-semibold">Create Content Calendar</h1>
      </div>

      <StepIndicator current={step} />

      {/* Step 0 — Select Brand */}
      {step === 0 && (
        <StepSelectBrand
          initialBrandId={initialBrandId}
          onNext={({ brand: b, brandIdentity: bi }) => {
            if (brand && brand.id !== b.id) {
              setReferenceAttachments([]);
            }
            setBrand(b);
          setBrandIdentity(bi);
          try {
            const saved = localStorage.getItem(`suggestorDefaults:${b.id}`);
            if (saved) {
              const defaults = JSON.parse(saved);
              setSuggestorForm(prev => ({
                ...prev,
                popularIndustryPosts:      defaults.popularIndustryPosts      ?? prev.popularIndustryPosts,
                importantIndustryWebsites: defaults.importantIndustryWebsites ?? prev.importantIndustryWebsites,
                competitorPages:           defaults.competitorPages            ?? prev.competitorPages,
              }));
            }
          } catch {}
          try {
            const saved = localStorage.getItem(`calendarSetupDefaults:${b.id}`);
            if (saved) {
              const defaults = JSON.parse(saved);
              setCalendarForm(prev => ({
                ...prev,
                importantDetailsToInclude: defaults.importantDetailsToInclude ?? prev.importantDetailsToInclude,
                detailsNotToInvent:        defaults.detailsNotToInvent        ?? prev.detailsNotToInvent,
                sourceMaterial:            defaults.sourceMaterial            ?? prev.sourceMaterial,
                targetAudience:            defaults.targetAudience            ?? prev.targetAudience,
              }));
            }
          } catch {}
          setStep(1);
          }}
        />
      )}

      {/* Step 1 — Post Suggestor Form */}
      {step === 1 && brand && (
        <StepSuggestorForm
          brand={brand}
          brandIdentity={brandIdentity}
          form={suggestorForm}
          setForm={setSuggestorForm}
          referenceAttachments={referenceAttachments}
          setReferenceAttachments={setReferenceAttachments}
          onBack={() => setStep(0)}
          onGenerated={({ posts, seasonalDates: sd, formData, model, usage, requestedCount }) => {
            setSuggestorFormData(formData);
            setGeneratedPosts(posts);
            setSeasonalDates(sd ?? []);
            setSuggestionMeta({ model, usage, requestedCount });
            setStep(2);
          }}
        />
      )}

      {/* Step 2 — Review Post Ideas */}
      {step === 2 && brand && generatedPosts && (
        <StepReviewAndSave
          brand={brand}
          formData={suggestorFormData}
          initialPosts={generatedPosts}
          seasonalDates={seasonalDates}
          model={suggestionMeta?.model}
          usage={suggestionMeta?.usage}
          requestedCount={suggestionMeta?.requestedCount}
          onBack={() => setStep(1)}
          onNextStep={({ selectedPosts, chosenSeasonalDates }) => {
            setSelectedPostIdeas(selectedPosts);
            setSelectedSeasonalDates(chosenSeasonalDates);
            // Format chosen seasonal dates as campaign events context
            const dateLines = chosenSeasonalDates
              .map(d => `${d.name} (${d.date})${d.contentAngle ? " — " + d.contentAngle : ""}`)
              .join("\n");
            setPrefillCampaignEvents(dateLines);
            if (suggestorFormData?.platform === "LinkedIn") {
              const resourceLines = (suggestorFormData.resourceUrls ?? []).map(u => `Resource: ${u}`);
              const articleLines = (suggestorFormData.articlesUsed ?? []).map(a => `- ${a.title || a.url}: ${a.url}`);
              const sourceMaterial = [
                ...resourceLines,
                ...(articleLines.length ? ["Articles used:", ...articleLines] : []),
              ].join("\n");
              setCalendarForm(prev => ({
                ...prev,
                platforms: "LinkedIn",
                requiredPostFormats: "Static, Carousel",
                sourceMaterial,
              }));
            }
            setStep(3);
          }}
        />
      )}

      {/* Step 3 — Calendar Generator Form */}
      {step === 3 && brand && (
        <StepCalendarForm
          brand={brand}
          brandIdentity={brandIdentity}
          selectedPosts={selectedPostIdeas}
          prefillCampaignEvents={prefillCampaignEvents}
          prefillMainGoal={suggestorFormData?.monthlyObjective ?? ""}
          prefillMainOfferOrMessage={suggestorFormData?.offers ?? ""}
          calendarPeriod={suggestorFormData?.calendarPeriod ?? ""}
          calendarPeriodStart={suggestorFormData?.calendarPeriodStart ?? ""}
          calendarPeriodEnd={suggestorFormData?.calendarPeriodEnd ?? ""}
          chosenSeasonalDates={selectedSeasonalDates}
          form={calendarForm}
          setForm={setCalendarForm}
          onBack={() => setStep(2)}
          onGenerated={(data) => {
            setCalendarPosts(data.posts ?? []);
            setCalendarRaw(data.raw ?? "");
            setCalendarFormData(data.formData ?? null);
            setCalendarMeta({ model: data.model, usage: data.usage });
            setStep(4);
          }}
          brandId={brand.id}
          referenceAttachments={referenceAttachments}
          onReferenceAttachmentsChange={setReferenceAttachments}
        />
      )}

      {/* Step 4 — Review & Save Calendar */}
      {step === 4 && brand && calendarFormData && (
        <StepCalendarOutput
          brand={brand}
          formData={calendarFormData}
          initialPosts={calendarPosts}
          rawOutput={calendarRaw}
          model={calendarMeta?.model}
          usage={calendarMeta?.usage}
          onBack={() => setStep(3)}
          referenceAttachments={referenceAttachments}
        />
      )}
    </div>
  );
}

export default function CreateCalendarPage() {
  return (
    <Suspense>
      <CreateCalendarInner />
    </Suspense>
  );
}
