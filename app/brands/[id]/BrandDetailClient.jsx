"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import BrandFilesGallery from "@/components/BrandFilesGallery";
import { normalizeBrandIdentityOutput } from "@/lib/brand-identity-utils";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

const inputStyle = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 12,
  color: "var(--sketch-ink)",
  background: "var(--sketch-paper-bright)",
  border: "1px solid var(--sketch-line)",
  padding: "8px 12px",
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
  transition: "border-color 120ms ease",
};

const inkBtn = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "6px 14px",
  border: "1px solid var(--sketch-ink)",
  background: "transparent",
  color: "var(--sketch-ink-soft)",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function InkSection({ title, children }) {
  return (
    <div
      style={{
        border: "1px solid var(--sketch-line)",
        background: "var(--sketch-paper-bright)",
        marginBottom: 24,
      }}
    >
      <div
        style={{
          padding: "12px 18px",
          borderBottom: "1px solid var(--sketch-line-soft)",
          ...lbl,
          color: "var(--sketch-ink)",
        }}
      >
        {title}
      </div>
      <div style={{ padding: "16px 18px" }}>{children}</div>
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ ...lbl, display: "block", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

function FieldGrid({ children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>{children}</div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const HEX_RE = /^#([0-9a-fA-F]{3}){1,2}$/;
function toHex(v) {
  if (typeof v === "string" && HEX_RE.test(v.trim())) return v.trim();
  if (typeof v === "object" && v !== null) {
    const h = v.approx_hex ?? v.hex ?? v.color ?? v.value ?? null;
    if (typeof h === "string" && HEX_RE.test(h.trim())) return h.trim();
  }
  return "#000000";
}
function toName(v, fallback) {
  if (typeof v === "string" && !HEX_RE.test(v.trim())) return v.trim() || fallback;
  if (typeof v === "object" && v !== null) {
    const n = v.name ?? v.label ?? v.title ?? null;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  return fallback;
}

const COLOR_GROUPS = [
  { key: "primaryColors", label: "Primary" },
  { key: "secondaryColors", label: "Secondary" },
  { key: "accentColors", label: "Accent" },
  { key: "neutralColors", label: "Neutral" },
];

function flattenPalette(colors) {
  const items = [];
  for (const g of COLOR_GROUPS) {
    const arr = colors[g.key];
    if (!Array.isArray(arr)) continue;
    arr.forEach((v, i) => {
      items.push({ group: g.key, groupLabel: g.label, hex: toHex(v), name: toName(v, `${g.label} ${i + 1}`) });
    });
  }
  return items;
}

function unflattenPalette(items) {
  const out = { primaryColors: [], secondaryColors: [], accentColors: [], neutralColors: [] };
  for (const it of items) {
    if (out[it.group]) out[it.group].push(it.hex);
  }
  return out;
}

const RADAR_AXES = [
  { key: "bold", label: "BOLD" },
  { key: "tech", label: "TECH" },
  { key: "warm", label: "WARM" },
  { key: "minimal", label: "MINIMAL" },
  { key: "premium", label: "PREMIUM" },
  { key: "playful", label: "PLAYFUL" },
];

function deriveRadarDefaults(toneData) {
  const vals = { bold: 50, tech: 50, warm: 50, minimal: 50, premium: 50, playful: 50 };
  if (!toneData) return vals;
  const words = [...(toneData.brandPersonality || []), ...(toneData.toneOfVoice || [])].map((w) => (w || "").toLowerCase());
  if (words.some((w) => w.includes("bold") || w.includes("confident") || w.includes("strong"))) vals.bold = 80;
  if (words.some((w) => w.includes("tech") || w.includes("innovat") || w.includes("digital"))) vals.tech = 75;
  if (words.some((w) => w.includes("warm") || w.includes("friend") || w.includes("kind"))) vals.warm = 75;
  if (words.some((w) => w.includes("minim") || w.includes("clean") || w.includes("simple"))) vals.minimal = 70;
  if (words.some((w) => w.includes("premium") || w.includes("luxur") || w.includes("exclusi"))) vals.premium = 80;
  if (words.some((w) => w.includes("playful") || w.includes("fun") || w.includes("casual"))) vals.playful = 70;
  if (words.some((w) => w.includes("professional") || w.includes("authorit") || w.includes("reliable"))) { vals.bold = Math.max(vals.bold, 70); vals.premium = Math.max(vals.premium, 65); }
  return vals;
}

// ─── Color Palette Section ──────────────────────────────────────────────────

function ColorPaletteSection({ brandId, initialIdentities, onIdentityUpdated }) {
  const current = initialIdentities[0] ?? null;
  const normalized = useMemo(() => normalizeBrandIdentityOutput(current), [current]);
  const [items, setItems] = useState(() => flattenPalette(normalized.brandVisualIdentity.colors));
  const [savingPalette, setSavingPalette] = useState(false);

  if (!current) {
    return (
      <InkSection title="Color Palette">
        <div style={{ textAlign: "center", padding: "24px 0", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13, color: "var(--sketch-ink-faint)" }}>
          Extract brand identity first to edit the color palette.
        </div>
      </InkSection>
    );
  }

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function addItem() {
    setItems((prev) => [...prev, { group: "accentColors", groupLabel: "Accent", hex: "#B49C78", name: `Color ${prev.length + 1}` }]);
  }

  async function handleSavePalette() {
    setSavingPalette(true);
    try {
      let parsed = {};
      try { parsed = JSON.parse(current.jsonOutput || "{}"); } catch { parsed = {}; }
      if (!parsed.brandVisualIdentity) parsed.brandVisualIdentity = {};
      if (!parsed.brandVisualIdentity.colors) parsed.brandVisualIdentity.colors = {};
      const updatedColors = unflattenPalette(items);
      parsed.brandVisualIdentity.colors = { ...parsed.brandVisualIdentity.colors, ...updatedColors };
      const jsonOutput = JSON.stringify(parsed, null, 2);
      const res = await fetch(`/api/brands/${brandId}/identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonOutput }),
      });
      if (!res.ok) throw new Error();
      toast.success("Color palette saved.");
      if (onIdentityUpdated) onIdentityUpdated(jsonOutput);
    } catch {
      toast.error("Failed to save palette.");
    } finally {
      setSavingPalette(false);
    }
  }

  return (
    <InkSection title="Color Palette">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 18 }}>
        {items.map((it, idx) => (
          <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 90 }}>
            <div style={{ position: "relative", width: 72, height: 56 }}>
              <div style={{ width: "100%", height: "100%", background: it.hex, border: "1px solid rgba(28,24,18,.18)" }} />
              <input
                type="color"
                value={it.hex}
                onChange={(e) => updateItem(idx, { hex: e.target.value })}
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
                title="Pick color"
              />
            </div>
            <input
              value={it.name}
              onChange={(e) => updateItem(idx, { name: e.target.value })}
              style={{ ...inputStyle, fontSize: 9, padding: "3px 4px", textAlign: "center", width: 80 }}
            />
            <input
              value={it.hex}
              onChange={(e) => {
                const v = e.target.value;
                updateItem(idx, { hex: HEX_RE.test(v) ? v : v });
              }}
              style={{ ...inputStyle, fontSize: 8, padding: "2px 4px", textAlign: "center", width: 72, color: "var(--sketch-ink-faint)" }}
            />
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <select
                value={it.group}
                onChange={(e) => {
                  const g = COLOR_GROUPS.find((cg) => cg.key === e.target.value);
                  updateItem(idx, { group: e.target.value, groupLabel: g?.label || "" });
                }}
                style={{ ...inputStyle, fontSize: 8, padding: "1px 2px", width: 58 }}
              >
                {COLOR_GROUPS.map((g) => (
                  <option key={g.key} value={g.key}>{g.label}</option>
                ))}
              </select>
              <button type="button" onClick={() => removeItem(idx)} style={{ ...lbl, background: "none", border: "none", cursor: "pointer", color: "var(--sketch-ink-faint)", fontSize: 11 }}>&times;</button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" onClick={addItem} style={inkBtn}>+ Add Color</button>
        <button type="button" onClick={handleSavePalette} disabled={savingPalette} style={{
          ...inkBtn,
          borderColor: "var(--sketch-vermilion)",
          background: "var(--sketch-vermilion)",
          color: "var(--sketch-paper-bright)",
          opacity: savingPalette ? 0.5 : 1,
        }}>
          {savingPalette ? "Saving…" : "Save Palette"}
        </button>
      </div>
    </InkSection>
  );
}

// ─── Tone Radar SVG ─────────────────────────────────────────────────────────

function ToneRadarSvg({ values, size = 230 }) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 26;
  const pt = (i, r) => {
    const ang = (Math.PI * 2 * i) / RADAR_AXES.length - Math.PI / 2;
    return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
  };
  const ring = (frac) => RADAR_AXES.map((_, i) => pt(i, R * frac).join(",")).join(" ");
  const dataPts = RADAR_AXES.map((a, i) => pt(i, R * ((values[a.key] ?? 50) / 100)));
  const dataStr = dataPts.map((p) => p.join(",")).join(" ");

  return (
    <svg width={size} height={size} style={{ overflow: "visible" }}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="var(--sketch-line)" strokeWidth="1" />
      ))}
      {RADAR_AXES.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--sketch-line)" strokeWidth="1" />;
      })}
      <polygon points={dataStr} fill="rgba(178,62,38,0.16)" stroke="var(--sketch-vermilion)" strokeWidth="1.5" />
      {dataPts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2.6" fill="var(--sketch-vermilion)" />
      ))}
      {RADAR_AXES.map((a, i) => {
        const [x, y] = pt(i, R + 18);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            style={{ fontFamily: "var(--font-mono-ink)", fontSize: 9.5, letterSpacing: "0.08em", fill: "var(--sketch-ink-soft)" }}>
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}

// ─── Tone Radar Section ─────────────────────────────────────────────────────

function ToneRadarSection({ brandId, initialIdentities, onIdentityUpdated }) {
  const current = initialIdentities[0] ?? null;
  const normalized = useMemo(() => normalizeBrandIdentityOutput(current), [current]);

  const [values, setValues] = useState(() => {
    const existing = normalized.brandVisualIdentity.toneRadar;
    if (existing && Object.keys(existing).length > 0) return { ...deriveRadarDefaults(null), ...existing };
    return deriveRadarDefaults(normalized.brandToneInformationAndData);
  });
  const [note, setNote] = useState(() => normalized.brandVisualIdentity.toneRadarNote ?? "");
  const [savingRadar, setSavingRadar] = useState(false);

  if (!current) {
    return (
      <InkSection title="Brand Tone Radar">
        <div style={{ textAlign: "center", padding: "24px 0", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13, color: "var(--sketch-ink-faint)" }}>
          Extract brand identity first to edit the tone radar.
        </div>
      </InkSection>
    );
  }

  function setAxis(key, val) {
    setValues((prev) => ({ ...prev, [key]: Math.max(0, Math.min(100, Number(val) || 0)) }));
  }

  async function handleSaveRadar() {
    setSavingRadar(true);
    try {
      let parsed = {};
      try { parsed = JSON.parse(current.jsonOutput || "{}"); } catch { parsed = {}; }
      if (!parsed.brandVisualIdentity) parsed.brandVisualIdentity = {};
      parsed.brandVisualIdentity.toneRadar = { ...values };
      if (note.trim()) parsed.brandVisualIdentity.toneRadarNote = note.trim();
      else delete parsed.brandVisualIdentity.toneRadarNote;
      const jsonOutput = JSON.stringify(parsed, null, 2);
      const res = await fetch(`/api/brands/${brandId}/identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonOutput }),
      });
      if (!res.ok) throw new Error();
      toast.success("Tone radar saved.");
      if (onIdentityUpdated) onIdentityUpdated(jsonOutput);
    } catch {
      toast.error("Failed to save tone radar.");
    } finally {
      setSavingRadar(false);
    }
  }

  return (
    <InkSection title="Brand Tone Radar">
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 28, alignItems: "start" }}>
        {/* Radar chart */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <ToneRadarSvg values={values} />
        </div>

        {/* Sliders */}
        <div>
          {RADAR_AXES.map((a) => (
            <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div style={{ ...lbl, width: 64, flex: "0 0 64px" }}>{a.label}</div>
              <input
                type="range"
                min={0}
                max={100}
                value={values[a.key]}
                onChange={(e) => setAxis(a.key, e.target.value)}
                style={{ flex: 1, accentColor: "#B23E26" }}
              />
              <input
                type="number"
                min={0}
                max={100}
                value={values[a.key]}
                onChange={(e) => setAxis(a.key, e.target.value)}
                style={{ ...inputStyle, width: 52, padding: "4px 6px", fontSize: 11, textAlign: "center" }}
              />
            </div>
          ))}
          <FieldRow label="Notes">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional notes on brand tone adjustments…"
              rows={2}
              style={{ ...inputStyle, resize: "vertical", fontSize: 11 }}
            />
          </FieldRow>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button type="button" onClick={handleSaveRadar} disabled={savingRadar} style={{
          ...inkBtn,
          borderColor: "var(--sketch-vermilion)",
          background: "var(--sketch-vermilion)",
          color: "var(--sketch-paper-bright)",
          opacity: savingRadar ? 0.5 : 1,
        }}>
          {savingRadar ? "Saving…" : "Save Tone Radar"}
        </button>
      </div>
    </InkSection>
  );
}

// ─── Brand Identity Raw JSON Section ────────────────────────────────────────

function BrandIdentitySection({ brandId, initialIdentities }) {
  const [identities, setIdentities] = useState(initialIdentities);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(initialIdentities[0]?.jsonOutput ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const current = identities[0] ?? null;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonOutput: editText }),
      });
      if (!res.ok) throw new Error();
      const saved = await res.json();
      setIdentities((prev) => [{ ...prev[0], jsonOutput: editText, updatedAt: saved.updatedAt }, ...prev.slice(1)]);
      setEditing(false);
      toast.success("Brand identity updated.");
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!current) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/identity?identityId=${current.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setIdentities((prev) => prev.slice(1));
      setEditing(false);
      toast.success("Brand identity removed.");
    } catch {
      toast.error("Failed to delete.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <InkSection title="Brand Visual Identity">
      {!current ? (
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, color: "var(--sketch-ink-faint)", marginBottom: 12 }}>
            No identity extracted yet
          </div>
          <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13, color: "var(--sketch-ink-faint)", marginBottom: 18, maxWidth: 320, margin: "0 auto 18px" }}>
            Use AI to analyse brand files and extract a visual identity profile.
          </div>
          <Link href={`/brands/${brandId}/extract-identity`} style={{ ...inkBtn, borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)" }}>
            Extract Brand Identity
          </Link>
        </div>
      ) : editing ? (
        <div>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            style={{
              ...inputStyle,
              fontFamily: "var(--font-mono-ink)",
              fontSize: 11,
              minHeight: 280,
              resize: "vertical",
              whiteSpace: "pre-wrap",
            }}
            spellCheck={false}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button onClick={() => { setEditing(false); setEditText(current.jsonOutput ?? ""); }} style={inkBtn}>Cancel</button>
            <button disabled={saving} onClick={handleSave} style={{ ...inkBtn, borderColor: "var(--sketch-vermilion)", background: "var(--sketch-vermilion)", color: "var(--sketch-paper-bright)", opacity: saving ? 0.5 : 1 }}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Link href={`/brands/${brandId}/extract-identity`} style={{ ...inkBtn, fontSize: 9, padding: "4px 10px" }}>Re-extract</Link>
              <Link href={`/brands/${brandId}/identity-report`} style={{ ...inkBtn, fontSize: 9, padding: "4px 10px", borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)" }}>View Report</Link>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ ...lbl, fontSize: 9 }}>Extracted {formatDate(current.createdAt)}</span>
              <button onClick={() => { setEditText(current.jsonOutput ?? ""); setEditing(true); }} style={{ ...lbl, background: "none", border: "none", cursor: "pointer", color: "var(--sketch-vermilion)", fontSize: 9 }}>Edit</button>
              <button onClick={handleDelete} disabled={deleting} style={{ ...lbl, background: "none", border: "none", cursor: "pointer", color: "var(--sketch-ink-faint)", fontSize: 12 }}>&times;</button>
              <button onClick={() => setCollapsed(v => !v)} style={{ ...lbl, background: "none", border: "none", cursor: "pointer", color: "var(--sketch-ink-faint)", fontSize: 11 }}>
                {collapsed ? "▸" : "▾"}
              </button>
            </div>
          </div>
          {!collapsed && (
            <pre style={{
              background: "var(--sketch-paper-raw)",
              border: "1px solid var(--sketch-line-soft)",
              padding: 14,
              fontFamily: "var(--font-mono-ink)",
              fontSize: 11,
              lineHeight: 1.5,
              overflow: "auto",
              maxHeight: 320,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "var(--sketch-ink-soft)",
            }}>
              {current.jsonOutput}
            </pre>
          )}
        </div>
      )}
    </InkSection>
  );
}

export default function BrandDetailClient({ brand: initialBrand, initialFiles, initialIdentities = [] }) {
  const router = useRouter();

  const [form, setForm] = useState({
    name: initialBrand.name ?? "",
    website: initialBrand.website ?? "",
    instagramPage: initialBrand.instagramPage ?? "",
    linkedinPage: initialBrand.linkedinPage ?? "",
    facebookPage: initialBrand.facebookPage ?? "",
    businessLocation: initialBrand.businessLocation ?? "",
    businessType: initialBrand.businessType ?? "",
    mainServicesOrProducts: initialBrand.mainServicesOrProducts ?? "",
    targetAudience: initialBrand.targetAudience ?? "",
    brandTone: initialBrand.brandTone ?? "",
    brandVisualStyle: initialBrand.brandVisualStyle ?? "",
  });

  const [saving, setSaving] = useState(false);
  const [deletingBrand, setDeletingBrand] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Brand name is required.");
    setSaving(true);
    try {
      const res = await fetch(`/api/brands/${initialBrand.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast.success("Brand saved.");
      router.refresh();
    } catch {
      toast.error("Failed to save brand.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBrand() {
    setDeletingBrand(true);
    try {
      const res = await fetch(`/api/brands/${initialBrand.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Brand deleted.");
      router.push("/brands");
      router.refresh();
    } catch {
      toast.error("Failed to delete brand.");
      setDeletingBrand(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div style={{ padding: "36px 44px 48px", maxWidth: 820 }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ ...lbl, fontSize: 9 }}>
          <Link href="/brands" style={{ color: "var(--sketch-ink-faint)", textDecoration: "none" }}>Brands</Link>
          {" · "}Edit Profile
        </div>
        <div style={{ ...lbl, fontSize: 9 }}>System Ready &middot; Local</div>
      </div>
      <div style={{ borderBottom: "1px solid var(--sketch-ink)", marginBottom: 24 }} />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 900,
            fontSize: 48,
            lineHeight: 0.92,
            textTransform: "uppercase",
            color: "var(--sketch-ink)",
          }}>
            {form.name || "Edit Brand"}
          </h1>
          <div style={{ borderBottom: "2px solid var(--sketch-vermilion)", width: 200, marginTop: 8 }} />
          <div style={{ ...lbl, marginTop: 8 }}>
            {form.businessType || "Brand Profile"} {form.businessLocation ? `· ${form.businessLocation}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <Link href={`/brand-workspace?brandId=${initialBrand.id}`} style={inkBtn}>Workspace</Link>
          <button onClick={handleSave} disabled={saving} style={{
            ...inkBtn,
            borderColor: "var(--sketch-vermilion)",
            background: "var(--sketch-vermilion)",
            color: "var(--sketch-paper-bright)",
            opacity: saving ? 0.5 : 1,
          }}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      <form onSubmit={handleSave}>
        {/* Business Information */}
        <InkSection title="Business Information">
          <FieldGrid>
            <FieldRow label="Brand Name *">
              <input name="name" value={form.name} onChange={handleChange} placeholder="Bloom Studio" required style={inputStyle} />
            </FieldRow>
            <FieldRow label="Business Type">
              <input name="businessType" value={form.businessType} onChange={handleChange} placeholder="Creative Agency" style={inputStyle} />
            </FieldRow>
          </FieldGrid>
          <FieldGrid>
            <FieldRow label="Location">
              <input name="businessLocation" value={form.businessLocation} onChange={handleChange} placeholder="Austin, TX" style={inputStyle} />
            </FieldRow>
            <FieldRow label="Website">
              <input name="website" value={form.website} onChange={handleChange} placeholder="https://..." style={inputStyle} />
            </FieldRow>
          </FieldGrid>
        </InkSection>

        {/* Social Media */}
        <InkSection title="Social Media">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <FieldRow label="Instagram">
              <input name="instagramPage" value={form.instagramPage} onChange={handleChange} placeholder="@handle" style={inputStyle} />
            </FieldRow>
            <FieldRow label="LinkedIn">
              <input name="linkedinPage" value={form.linkedinPage} onChange={handleChange} placeholder="linkedin.com/..." style={inputStyle} />
            </FieldRow>
            <FieldRow label="Facebook">
              <input name="facebookPage" value={form.facebookPage} onChange={handleChange} placeholder="facebook.com/..." style={inputStyle} />
            </FieldRow>
          </div>
        </InkSection>

        {/* Brand Identity Fields */}
        <InkSection title="Brand Identity">
          <FieldRow label="Services / Products">
            <textarea name="mainServicesOrProducts" value={form.mainServicesOrProducts} onChange={handleChange} placeholder="Describe the main services or products offered" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </FieldRow>
          <FieldRow label="Target Audience">
            <textarea name="targetAudience" value={form.targetAudience} onChange={handleChange} placeholder="Who is the ideal customer?" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </FieldRow>
          <FieldGrid>
            <FieldRow label="Brand Tone">
              <input name="brandTone" value={form.brandTone} onChange={handleChange} placeholder="Warm and approachable" style={inputStyle} />
            </FieldRow>
            <FieldRow label="Visual Style">
              <input name="brandVisualStyle" value={form.brandVisualStyle} onChange={handleChange} placeholder="Clean minimalism" style={inputStyle} />
            </FieldRow>
          </FieldGrid>
        </InkSection>

        {/* Brand Files */}
        <BrandFilesGallery brandId={initialBrand.id} initialFiles={initialFiles} />

        {/* Color Palette */}
        <ColorPaletteSection brandId={initialBrand.id} initialIdentities={initialIdentities} />

        {/* Brand Tone Radar */}
        <ToneRadarSection brandId={initialBrand.id} initialIdentities={initialIdentities} />

        {/* Brand Visual Identity */}
        <BrandIdentitySection brandId={initialBrand.id} initialIdentities={initialIdentities} />

        {/* Danger Zone */}
        <div style={{
          border: "1px solid var(--sketch-vermilion)",
          background: "var(--sketch-paper-bright)",
          opacity: 0.85,
        }}>
          <div style={{
            padding: "12px 18px",
            borderBottom: "1px solid var(--sketch-vermilion)",
            ...lbl,
            color: "var(--sketch-vermilion)",
          }}>
            Danger Zone
          </div>
          <div style={{ padding: "16px 18px" }}>
            {!confirmDelete ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, fontWeight: 500, color: "var(--sketch-ink)" }}>Delete this brand</div>
                  <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 10, color: "var(--sketch-ink-faint)", marginTop: 3 }}>Permanently removes the brand and all its uploaded images.</div>
                </div>
                <button type="button" onClick={() => setConfirmDelete(true)} style={{
                  ...inkBtn,
                  borderColor: "var(--sketch-vermilion)",
                  color: "var(--sketch-vermilion)",
                }}>
                  Delete Brand
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, color: "var(--sketch-ink)" }}>
                  Delete <strong>{form.name}</strong>? This cannot be undone.
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button type="button" onClick={handleDeleteBrand} disabled={deletingBrand} style={{
                    ...inkBtn,
                    borderColor: "var(--sketch-vermilion)",
                    background: "var(--sketch-vermilion)",
                    color: "var(--sketch-paper-bright)",
                    opacity: deletingBrand ? 0.5 : 1,
                  }}>
                    {deletingBrand ? "Deleting…" : "Yes, Delete"}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} disabled={deletingBrand} style={inkBtn}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </form>

      {/* Footer */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        marginTop: 32,
        ...lbl,
        borderTop: "1px solid var(--sketch-line)",
        paddingTop: 14,
      }}>
        <span>Content Studio &middot; Brand Edit</span>
        <span>Ink Cartography System</span>
      </div>
    </div>
  );
}
