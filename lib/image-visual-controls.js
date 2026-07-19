// Shared image "Visual Production Controls" for the raw-idea image flow.
//
// Safe to import from BOTH client components and API routes — this module has
// no server-only or React dependencies. It only defines option maps, presets,
// the default state, a normalizer/validator, and a prompt serializer.

// ── Option maps (stable lowercase values + readable labels) ──────────────────
// Each control's allowed values. Anything outside these is treated as "auto"
// by the normalizer.

export const COMPOSITION_OPTIONS = [
  { value: "auto", label: "AI decides" },
  { value: "centered-hero", label: "Centered hero" },
  { value: "rule-of-thirds", label: "Rule of thirds" },
  { value: "symmetrical", label: "Symmetrical" },
  { value: "wide-environmental", label: "Wide environmental" },
  { value: "close-up-detail", label: "Close-up detail" },
  { value: "negative-space-ad", label: "Negative-space ad" },
  { value: "top-down-flat-lay", label: "Top-down flat lay" },
];

export const PERSPECTIVE_OPTIONS = [
  { value: "auto", label: "AI decides" },
  { value: "eye-level", label: "Eye level" },
  { value: "low-angle", label: "Low angle" },
  { value: "high-angle", label: "High angle" },
  { value: "top-down", label: "Top down" },
  { value: "three-quarter", label: "Three-quarter" },
  { value: "isometric", label: "Isometric" },
  { value: "macro-detail", label: "Macro detail" },
];

export const LENS_OPTIONS = [
  { value: "auto", label: "AI decides" },
  { value: "wide-24mm", label: "Wide 24mm" },
  { value: "natural-35mm", label: "Natural 35mm" },
  { value: "standard-50mm", label: "Standard 50mm" },
  { value: "portrait-85mm", label: "Portrait 85mm" },
  { value: "telephoto-135mm", label: "Telephoto 135mm" },
  { value: "macro-100mm", label: "Macro 100mm" },
];

export const DEPTH_OF_FIELD_OPTIONS = [
  { value: "auto", label: "AI decides" },
  { value: "deep-focus", label: "Deep focus" },
  { value: "moderate", label: "Moderate" },
  { value: "shallow", label: "Shallow" },
  { value: "ultra-shallow", label: "Ultra-shallow" },
];

export const LIGHTING_OPTIONS = [
  { value: "auto", label: "AI decides" },
  { value: "soft-daylight", label: "Soft daylight" },
  { value: "golden-hour", label: "Golden hour" },
  { value: "studio-softbox", label: "Studio softbox" },
  { value: "high-contrast-cinematic", label: "High-contrast cinematic" },
  { value: "neon-night", label: "Neon night" },
  { value: "dramatic-rim-light", label: "Dramatic rim light" },
  { value: "overcast-diffused", label: "Overcast diffused" },
];

export const STYLE_OPTIONS = [
  { value: "auto", label: "AI decides" },
  { value: "photorealistic", label: "Photorealistic" },
  { value: "editorial", label: "Editorial" },
  { value: "commercial-product", label: "Commercial product" },
  { value: "cinematic-film-still", label: "Cinematic film still" },
  { value: "documentary", label: "Documentary" },
  { value: "premium-3d", label: "Premium 3D" },
  { value: "clean-graphic", label: "Clean graphic" },
];

export const COLOR_TREATMENT_OPTIONS = [
  { value: "auto", label: "AI decides" },
  { value: "natural-neutral", label: "Natural neutral" },
  { value: "warm-cinematic", label: "Warm cinematic" },
  { value: "cool-modern", label: "Cool modern" },
  { value: "muted-editorial", label: "Muted editorial" },
  { value: "high-contrast", label: "High contrast" },
  { value: "monochrome", label: "Monochrome" },
  { value: "brand-led", label: "Brand led" },
];

export const ASPECT_RATIO_OPTIONS = [
  { value: "auto", label: "AI decides" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
];

// The eight production controls (preset is UI-only and excluded from the
// serialized prompt block).
export const CONTROL_KEYS = [
  "composition",
  "perspective",
  "lens",
  "depthOfField",
  "lighting",
  "style",
  "colorTreatment",
  "aspectRatio",
];

export const OPTION_MAP = {
  composition: COMPOSITION_OPTIONS,
  perspective: PERSPECTIVE_OPTIONS,
  lens: LENS_OPTIONS,
  depthOfField: DEPTH_OF_FIELD_OPTIONS,
  lighting: LIGHTING_OPTIONS,
  style: STYLE_OPTIONS,
  colorTreatment: COLOR_TREATMENT_OPTIONS,
  aspectRatio: ASPECT_RATIO_OPTIONS,
};

// Order + label used when serializing to the prompt.
export const FIELD_DEFS = [
  { key: "composition", label: "Composition / framing" },
  { key: "perspective", label: "Camera / perspective" },
  { key: "lens", label: "Lens / focal character" },
  { key: "depthOfField", label: "Depth of field" },
  { key: "lighting", label: "Lighting" },
  { key: "style", label: "Style / rendering" },
  { key: "colorTreatment", label: "Color treatment" },
  { key: "aspectRatio", label: "Aspect ratio / format" },
];

// ── Presets ────────────────────────────────────────────────────────────────────

export const IMAGE_PRESETS = [
  {
    value: "custom",
    label: "Custom / AI decides",
    controls: {
      composition: "auto",
      perspective: "auto",
      lens: "auto",
      depthOfField: "auto",
      lighting: "auto",
      style: "auto",
      colorTreatment: "auto",
      aspectRatio: "auto",
    },
  },
  {
    value: "cinematic-night",
    label: "Cinematic Night",
    controls: {
      composition: "rule-of-thirds",
      perspective: "low-angle",
      lens: "natural-35mm",
      depthOfField: "shallow",
      lighting: "neon-night",
      style: "cinematic-film-still",
      colorTreatment: "cool-modern",
      aspectRatio: "16:9",
    },
  },
  {
    value: "premium-product",
    label: "Premium Product",
    controls: {
      composition: "centered-hero",
      perspective: "three-quarter",
      lens: "portrait-85mm",
      depthOfField: "moderate",
      lighting: "studio-softbox",
      style: "commercial-product",
      colorTreatment: "natural-neutral",
      aspectRatio: "4:5",
    },
  },
  {
    value: "natural-lifestyle",
    label: "Natural Lifestyle",
    controls: {
      composition: "wide-environmental",
      perspective: "eye-level",
      lens: "natural-35mm",
      depthOfField: "deep-focus",
      lighting: "soft-daylight",
      style: "photorealistic",
      colorTreatment: "natural-neutral",
      aspectRatio: "1:1",
    },
  },
  {
    value: "editorial-documentary",
    label: "Editorial Documentary",
    controls: {
      composition: "rule-of-thirds",
      perspective: "three-quarter",
      lens: "standard-50mm",
      depthOfField: "moderate",
      lighting: "overcast-diffused",
      style: "documentary",
      colorTreatment: "muted-editorial",
      aspectRatio: "3:2",
    },
  },
  {
    value: "clean-social-ad",
    label: "Clean Social Ad",
    controls: {
      composition: "negative-space-ad",
      perspective: "eye-level",
      lens: "standard-50mm",
      depthOfField: "moderate",
      lighting: "studio-softbox",
      style: "commercial-product",
      colorTreatment: "brand-led",
      aspectRatio: "1:1",
    },
  },
  {
    value: "dramatic-portrait",
    label: "Dramatic Portrait",
    controls: {
      composition: "close-up-detail",
      perspective: "low-angle",
      lens: "portrait-85mm",
      depthOfField: "ultra-shallow",
      lighting: "dramatic-rim-light",
      style: "cinematic-film-still",
      colorTreatment: "high-contrast",
      aspectRatio: "4:5",
    },
  },
];

// ── Default state + normalizer ───────────────────────────────────────────────────

export function defaultVisualControls() {
  return {
    preset: "custom",
    composition: "auto",
    perspective: "auto",
    lens: "auto",
    depthOfField: "auto",
    lighting: "auto",
    style: "auto",
    colorTreatment: "auto",
    aspectRatio: "auto",
  };
}

// Coerce untrusted client input into a safe control object. Unknown or
// invalid values collapse to "auto". Never throws on bad input.
export function normalizeVisualControls(input) {
  const out = {};
  for (const key of CONTROL_KEYS) {
    const allowed = OPTION_MAP[key].map((o) => o.value);
    const v = input?.[key];
    out[key] = typeof v === "string" && allowed.includes(v) ? v : "auto";
  }
  // Preset is carried through for UI state but not used in serialization.
  const preset =
    typeof input?.preset === "string" &&
    IMAGE_PRESETS.some((p) => p.value === input.preset)
      ? input.preset
      : "custom";
  out.preset = preset;
  return out;
}

export function applyPreset(presetValue) {
  const preset = IMAGE_PRESETS.find((p) => p.value === presetValue);
  if (!preset) return defaultVisualControls();
  return { preset: preset.value, ...preset.controls };
}

// ── Serializer ────────────────────────────────────────────────────────────────

// Produce the "Selected Visual Production Controls:" block from non-auto
// selections only. Returns "" when every control is auto. Never emits the
// word "Auto" (auto values are omitted, not written).
export function serializeVisualControls(controls) {
  const lines = [];
  for (const { key, label } of FIELD_DEFS) {
    const v = controls?.[key];
    if (!v || v === "auto") continue;
    const opt = OPTION_MAP[key].find((o) => o.value === v);
    const readable = opt ? opt.label : v;
    lines.push(`- ${label}: ${readable}`);
  }
  return lines.length
    ? `Selected Visual Production Controls:\n${lines.join("\n")}`
    : "";
}
