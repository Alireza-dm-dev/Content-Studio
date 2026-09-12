import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { NotAuthorized } from "@/components/NotAuthorized";
import { normalizeBrandIdentityOutput } from "@/lib/brand-identity-utils";
import { DraftStamp } from "@/components/content-report/DraftStamp";

export const dynamic = "force-dynamic";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

const HEX_RE = /^#([0-9a-fA-F]{3}){1,2}$/;
function extractHex(v) {
  if (typeof v === "string" && HEX_RE.test(v.trim())) return v.trim();
  if (typeof v === "object" && v !== null) {
    for (const k of ["approx_hex", "hex", "color", "value"]) {
      if (typeof v[k] === "string" && HEX_RE.test(v[k].trim())) return v[k].trim();
    }
  }
  return null;
}
function extractName(v, fallback) {
  if (typeof v === "object" && v !== null) {
    const n = v.name ?? v.label ?? v.title ?? null;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  if (typeof v === "string" && !HEX_RE.test(v.trim()) && v.trim()) return v.trim();
  return fallback;
}

function buildPalette(colors) {
  const groups = [
    { key: "primaryColors", prefix: "PRIMARY" },
    { key: "secondaryColors", prefix: "SECOND." },
    { key: "accentColors", prefix: "ACCENT" },
    { key: "neutralColors", prefix: "NEUTRAL" },
  ];
  const swatches = [];
  for (const g of groups) {
    const arr = colors[g.key];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const hex = extractHex(arr[i]) || "#000000";
      const name = extractName(arr[i], `${g.prefix} ${i + 1}`);
      swatches.push({ n: name, h: hex });
    }
  }
  return swatches.slice(0, 8);
}

function deriveRadar(vi, tone) {
  const stored = vi.toneRadar;
  if (stored && typeof stored === "object" && Object.keys(stored).length > 0) {
    return {
      bold: Number(stored.bold) || 50,
      tech: Number(stored.tech) || 50,
      warm: Number(stored.warm) || 50,
      minimal: Number(stored.minimal) || 50,
      premium: Number(stored.premium) || 50,
      playful: Number(stored.playful) || 50,
    };
  }
  const vals = { bold: 50, tech: 50, warm: 50, minimal: 50, premium: 50, playful: 50 };
  if (!tone) return vals;
  const words = [...(tone.brandPersonality || []), ...(tone.toneOfVoice || [])].map((w) => (w || "").toLowerCase());
  if (words.some((w) => w.includes("bold") || w.includes("confident") || w.includes("strong"))) vals.bold = 80;
  if (words.some((w) => w.includes("tech") || w.includes("innovat") || w.includes("digital"))) vals.tech = 75;
  if (words.some((w) => w.includes("warm") || w.includes("friend") || w.includes("kind"))) vals.warm = 75;
  if (words.some((w) => w.includes("minim") || w.includes("clean") || w.includes("simple"))) vals.minimal = 70;
  if (words.some((w) => w.includes("premium") || w.includes("luxur") || w.includes("exclusi"))) vals.premium = 80;
  if (words.some((w) => w.includes("playful") || w.includes("fun") || w.includes("casual"))) vals.playful = 70;
  if (words.some((w) => w.includes("professional") || w.includes("authorit") || w.includes("reliable"))) {
    vals.bold = Math.max(vals.bold, 70);
    vals.premium = Math.max(vals.premium, 65);
  }
  return vals;
}

export default async function IdentityReportPage({ params }) {
  const { id } = await params;

  const access = await requireBrandAccess(id);
  if (!access.ok) {
    if (access.status === 404) notFound();
    return <NotAuthorized />;
  }

  const [brand, identity] = await Promise.all([
    prisma.brand.findUnique({ where: { id } }),
    prisma.brandIdentity.findFirst({
      where: { brandId: id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!brand) notFound();

  const normalized = normalizeBrandIdentityOutput(identity);
  const vi = normalized.brandVisualIdentity;
  const tone = normalized.brandToneInformationAndData;

  const palette = buildPalette(vi.colors);
  const radar = deriveRadar(vi, tone);
  const typo = vi.typography;

  const identityDate = identity
    ? new Date(identity.createdAt).toISOString().split("T")[0]
    : "—";

  const attrs = [
    ["BRAND NAME", brand.name],
    ["INDUSTRY", tone.industry || brand.businessType || "—"],
    ["VOICE", (tone.toneOfVoice || []).join(", ") || brand.brandTone || "—"],
    ["PERSONALITY", (tone.brandPersonality || []).join(", ") || "—"],
    ["VISUAL STYLE", brand.brandVisualStyle || "—"],
    ["TARGET", tone.targetAudience || brand.targetAudience || "—"],
    ["PLATFORMS", [brand.instagramPage && "Instagram", brand.linkedinPage && "LinkedIn", brand.facebookPage && "Facebook"].filter(Boolean).join(" · ") || "—"],
    ["SERVICES", (tone.servicesOrProducts || []).join(", ") || brand.mainServicesOrProducts || "—"],
  ];

  const metadata = [
    ["MODEL", "gpt-4o"],
    ["EXTRACTION DATE", identityDate],
    ["CONFIDENCE", "—"],
    ["APPROVAL STATUS", identity ? "PENDING REVIEW" : "NOT EXTRACTED"],
  ];

  return (
    <div style={{ padding: "40px 48px 48px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr 1fr", gap: 40 }}>
        {/* LEFT — Title + palette + attributes */}
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 900,
              fontSize: 56,
              lineHeight: 0.92,
              textTransform: "uppercase",
            }}
          >
            <span style={{ color: "var(--sketch-ink)" }}>Brand</span>
            <br />
            <span style={{ color: "var(--sketch-vermilion)" }}>Identity</span>
          </h1>
          <div
            style={{
              borderBottom: "1px solid var(--sketch-line)",
              paddingBottom: 6,
              marginTop: 8,
              ...lbl,
            }}
          >
            Extraction Report &middot; Analysis Sheet
          </div>

          <div style={{ ...lbl, marginTop: 26, marginBottom: 12 }}>Color Palette</div>
          {palette.length > 0 ? (
            <div style={{ display: "flex", gap: 10 }}>
              {palette.map((c, i) => (
                <div key={i} style={{ flex: 1 }}>
                  <div
                    style={{
                      height: 58,
                      background: c.h,
                      border: "1px solid rgba(28,24,18,.18)",
                    }}
                  />
                  <div
                    style={{
                      fontFamily: "var(--font-mono-ink)",
                      fontSize: 8.5,
                      letterSpacing: "0.04em",
                      color: "var(--sketch-ink-soft)",
                      marginTop: 6,
                    }}
                  >
                    {c.n}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono-ink)",
                      fontSize: 8.5,
                      color: "var(--sketch-ink-faint)",
                    }}
                  >
                    {c.h}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13, color: "var(--sketch-ink-faint)" }}>
              No extracted colors yet
            </div>
          )}

          <div style={{ ...lbl, marginTop: 30, marginBottom: 10 }}>Identity Attributes</div>
          <div>
            {attrs.map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  gap: 16,
                  padding: "7px 0",
                  borderBottom: "1px solid var(--sketch-line-soft)",
                }}
              >
                <div style={{ ...lbl, width: 108, flex: "0 0 108px" }}>{k}</div>
                <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, color: "var(--sketch-ink)" }}>
                  {v}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CENTER — Tone radar */}
        <div>
          <div
            style={{
              ...lbl,
              textAlign: "center",
              borderBottom: "1px solid var(--sketch-line)",
              paddingBottom: 6,
            }}
          >
            Brand Tone Radar
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 30 }}>
            <ToneRadar values={radar} />
          </div>
        </div>

        {/* RIGHT — Type specimen + metadata */}
        <div>
          <div style={{ ...lbl, borderBottom: "1px solid var(--sketch-line)", paddingBottom: 6 }}>
            Typography &middot; Extracted
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ ...lbl, marginBottom: 4 }}>Font Style</div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 16, color: "var(--sketch-ink)", lineHeight: 1.3 }}>
              {typo.fontStyle || "—"}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ ...lbl, marginBottom: 4 }}>Heading Style</div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: 24,
                textTransform: "uppercase",
                color: "var(--sketch-ink)",
                lineHeight: 1,
              }}
            >
              {typo.headingStyle || "—"}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ ...lbl, marginBottom: 4 }}>Body Text Style</div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 14, color: "var(--sketch-ink-soft)", lineHeight: 1.4 }}>
              {typo.bodyTextStyle || "—"}
            </div>
          </div>

          {typo.typographyUsageRules && (
            <div style={{ marginTop: 16 }}>
              <div style={{ ...lbl, marginBottom: 4 }}>Usage Rules</div>
              <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 11, color: "var(--sketch-ink-faint)", lineHeight: 1.5 }}>
                {typo.typographyUsageRules}
              </div>
            </div>
          )}

          {/* Metadata block */}
          <div
            style={{
              position: "relative",
              marginTop: 28,
              border: "1px solid var(--sketch-stone)",
              background: "var(--sketch-paper-bright)",
              padding: "14px 16px",
            }}
          >
            <div style={{ ...lbl, color: "var(--sketch-ink)", marginBottom: 10 }}>
              AI Extraction Metadata
            </div>
            {metadata.map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "5px 0",
                  borderTop: "1px solid var(--sketch-line-soft)",
                }}
              >
                <span style={lbl}>{k}</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 11,
                    color: k === "APPROVAL STATUS" ? "var(--sketch-vermilion)" : "var(--sketch-ink)",
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -40, paddingRight: 40 }}>
        <DraftStamp primary="DRAFT" secondary="REVIEW" />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, ...lbl }}>
        <span>Content Studio &middot; Brand Identity Report</span>
        <span>Generated {identityDate} &middot; AI-Assisted</span>
      </div>
    </div>
  );
}

function ToneRadar({ values = {}, size = 230 }) {
  const axes = [
    { key: "bold", label: "BOLD" },
    { key: "tech", label: "TECH" },
    { key: "warm", label: "WARM" },
    { key: "minimal", label: "MINIMAL" },
    { key: "premium", label: "PREMIUM" },
    { key: "playful", label: "PLAYFUL" },
  ];
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 26;
  const pt = (i, r) => {
    const ang = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
  };
  const ring = (frac) =>
    axes.map((_, i) => pt(i, R * frac).join(",")).join(" ");
  const dataPts = axes.map((a, i) => pt(i, R * ((values[a.key] ?? 50) / 100)));
  const dataStr = dataPts.map((p) => p.join(",")).join(" ");

  return (
    <svg width={size} height={size} style={{ overflow: "visible" }}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="var(--sketch-line)" strokeWidth="1" />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, R);
        return (
          <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--sketch-line)" strokeWidth="1" />
        );
      })}
      <polygon
        points={dataStr}
        fill="rgba(178,62,38,0.16)"
        stroke="var(--sketch-vermilion)"
        strokeWidth="1.5"
      />
      {dataPts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2.6" fill="var(--sketch-vermilion)" />
      ))}
      {axes.map((a, i) => {
        const [x, y] = pt(i, R + 16);
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 9.5,
              letterSpacing: "0.08em",
              fill: "var(--sketch-ink-soft)",
            }}
          >
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}
