// Client-safe shared module defining eight new cinematic style options.
// Used by both image and video prompt generators.

export const CINEMATIC_STYLE_DEFAULT = "auto";

const STYLES = [
  {
    id: "anamorphic-blockbuster",
    label: "Anamorphic Blockbuster",
    shortDescription: "Widescreen theatrical composition with strong foreground/background separation and oval bokeh",
    compatibleMedia: ["image", "video"],
    lighting: "Dimensional production lighting with controlled horizontal lens flare when motivated; high cinematic contrast",
    lensAndOptics: "Anamorphic prime lenses; oval bokeh; natural barrel distortion edge; controlled horizontal flare",
    composition: "Widescreen theatrical framing; strong foreground/background separation; large-scale environmental framing; polished but not artificial",
    colourGrade: "Cinematic contrast with warm midtones and cool shadows; natural skin tones; restrained teal-and-orange only when scene-appropriate",
    texture: "Fine grain; subtle gate weave; natural film stock response; no fake letterbox bars",
    atmosphere: "Epic scale; cinematic weight; physically plausible grandeur; polished production value",
    imageDirection: "Widescreen theatrical composition with strong foreground/background separation. Oval bokeh. Controlled horizontal lens flare when motivated. Cinematic contrast. Dimensional production lighting. Large-scale environmental framing. Polished but not artificial.",
    videoDirection: "Deliberate cinematic movement with controlled dolly, tracking, crane, or orbit. Stable subject readability. Motivated lens flare. Clear start and landing frames. Epic but physically plausible motion.",
    cameraMovementPreferences: { families: ["dolly", "orbit", "jib", "tracking"], speedPref: "slow" },
    pacing: "Deliberate; medium-slow dwell time; controlled reveals",
    transitionGuidance: "Hard cuts or slow dissolves; no whip pans or flash transitions",
    negativeConstraints: "Avoid random flares, extreme distortion, fake letterbox bars baked into the image, every scene using teal-and-orange automatically",
  },
  {
    id: "neo-noir-thriller",
    label: "Neo-Noir Thriller",
    shortDescription: "Deep blacks, selective practical lighting, strong shadow geometry, restrained colour accents",
    compatibleMedia: ["image", "video"],
    lighting: "Selective practical lighting; deep shadows with controlled fill; motivated diegetic sources; reflective surfaces only when scene-compatible",
    lensAndOptics: "Prime lenses with moderate speed; slight veiling flare on bright sources; no anamorphic distortion",
    composition: "Asymmetric or layered composition; strong shadow geometry; psychological tension; restrained colour accents; reflective streets, glass, smoke, or rain only when scene-compatible",
    colourGrade: "Desaturated shadows with deep blacks; selective colour accents (neon red, cyan, or amber); cool shadow temperature",
    texture: "Controlled grain; subtle halation on highlights; no crushed detail in shadows",
    atmosphere: "Psychological tension; urban isolation; stylish menace; controlled dread",
    imageDirection: "Deep blacks. Selective practical lighting. Strong shadow geometry. Reflective streets, glass, smoke, or rain only when scene-compatible. Restrained colour accents. Psychological tension. Asymmetric or layered composition.",
    videoDirection: "Slow dolly. Restrained handheld. Follow-from-behind. Low tracking. Controlled reveal. Static tension shot.",
    cameraMovementPreferences: { families: ["dolly", "tracking", "handheld"], speedPref: "slow" },
    pacing: "Slow-burn; extended holds; measured reveals; deliberate pauses",
    transitionGuidance: "Slow dissolves; hard cuts on action; no rapid montage",
    negativeConstraints: "Avoid crushing all visible detail, neon added to scenes where it makes no sense, horror gore, random camera shaking",
  },
  {
    id: "vintage-35mm-film",
    label: "Vintage 35mm Film",
    shortDescription: "Organic grain, subtle halation, natural highlight roll-off, period-neutral analogue colour",
    compatibleMedia: ["image", "video"],
    lighting: "Natural or motivated practical light; slightly imperfect exposure; natural highlight roll-off; period-neutral response",
    lensAndOptics: "Spherical 35mm primes with vintage coating; natural flare; slight softness wide-open; tactile photographic texture",
    composition: "Authentic framing with imperfect but readable edges; natural depth; realistic skin and material rendering",
    colourGrade: "Period-neutral analogue colour response; organic saturation; warm midtones; natural skin tones; no digital colour grading",
    texture: "Organic grain; subtle halation; natural highlight roll-off; no artificial digital sharpness; no heavy damage overlays",
    atmosphere: "Nostalgic authenticity; tactile photographic quality; timeless documentary feel",
    imageDirection: "Organic grain. Subtle halation. Natural highlight roll-off. Slightly imperfect exposure. Period-neutral analogue colour response. Tactile photographic texture. Realistic skin and material rendering.",
    videoDirection: "Natural camera operation with subtle gate movement only when appropriate. Restrained zoom, pan, dolly, or handheld. Authentic cinematic cadence. No artificial digital sharpness.",
    cameraMovementPreferences: { families: ["static", "pan", "tilt", "dolly"], speedPref: "medium" },
    pacing: "Natural rhythm; medium pacing; authentic scene dwell time",
    transitionGuidance: "Hard cuts; occasional dissolves; no digital transitions",
    negativeConstraints: "Avoid heavy damage overlays, excessive dust and scratches, sepia as the default, unreadable blur",
  },
  {
    id: "luxury-commercial",
    label: "Luxury Commercial",
    shortDescription: "Premium product or subject presentation with precise controlled lighting and elegant negative space",
    compatibleMedia: ["image", "video"],
    lighting: "Precise controlled lighting with elegant negative space; refined reflections; clean material detail; restrained palette",
    lensAndOptics: "High-end macro or portrait primes; pristine optics; controlled flare; maximum sharpness at focus plane",
    composition: "Polished editorial composition; elegant negative space; premium product or subject presentation; refined reflections; clean material detail",
    colourGrade: "Restrained palette with deep neutrals; brand-aligned accent colours; clean highlights; natural skin tones",
    texture: "Immaculate surface rendering; controlled specular detail; no artificial texture overlay",
    atmosphere: "Premium sophistication; controlled elegance; editorial polish; aspirational calm",
    imageDirection: "Premium product or subject presentation. Precise controlled lighting. Elegant negative space. Refined reflections. Clean material detail. Restrained palette. Polished editorial composition.",
    videoDirection: "Slow slider. Elegant arc. Controlled orbit. Slow dolly. Pedestal movement. Deliberate reveal. Smooth premium pacing.",
    cameraMovementPreferences: { families: ["orbit", "dolly", "jib", "static"], speedPref: "slow" },
    pacing: "Luxurious slow pacing; extended holds; deliberate reveals; elegant timing",
    transitionGuidance: "Slow dissolves; smooth fades; no aggressive cuts",
    negativeConstraints: "Avoid aggressive handheld, crash zoom, cluttered backgrounds, cheap glow effects, excessive motion",
  },
  {
    id: "dreamlike-surrealism",
    label: "Dreamlike Surrealism",
    shortDescription: "Believable subject combined with imaginative spatial relationships and soft atmospheric depth",
    compatibleMedia: ["image", "video"],
    lighting: "Soft atmospheric depth with poetic colour transitions; floating or transformed environmental elements; dream logic illumination",
    lensAndOptics: "Dreamy vintage lenses with soft halation; variable diffusion; controlled flare for ethereal effect",
    composition: "Believable subject combined with imaginative spatial relationships; coherent focal subject; floating or transformed elements; dream logic",
    colourGrade: "Poetic colour transitions; soft pastel or muted tones; ethereal highlight treatment; colour shifts that support dream logic",
    texture: "Soft atmospheric diffusion; gentle bloom on highlights; subtle texture blend between real and imagined elements",
    atmosphere: "Dream logic; imaginative but coherent; ethereal; visually continuous; anchored by a clear focal subject",
    imageDirection: "Believable subject combined with imaginative spatial relationships. Soft atmospheric depth. Dream logic. Poetic colour transitions. Floating or transformed environmental elements. Coherent focal subject.",
    videoDirection: "Floating glide. Slow orbit. Pass-through when a visible transition surface exists. Controlled infinite zoom when a centred portal exists. Smooth temporal transformation. Visually continuous dream transition.",
    cameraMovementPreferences: { families: ["orbit", "dolly", "physical", "special"], speedPref: "slow" },
    pacing: "Hypnotic slow pacing; extended continuous takes; dreamlike temporal flow",
    transitionGuidance: "Slow dissolves; morph cuts; invisible transitions; no hard abrupt cuts",
    negativeConstraints: "Avoid random unrelated objects, unstable anatomy, incoherent scene changes, special effects without a visual anchor",
  },
  {
    id: "gritty-documentary",
    label: "Gritty Documentary",
    shortDescription: "Observational realism with natural or practical light, authentic environments, minimal artificial polish",
    compatibleMedia: ["image", "video"],
    lighting: "Natural or practical light; authentic environments; available light; no artificial fill unless scene-motivated",
    lensAndOptics: "Standard zooms or primes with natural character; modest sharpness; no pristine coating; realistic field-of-view",
    composition: "Imperfect but readable framing; human-scale perspective; observational realism; honest material texture; minimal artificial polish",
    colourGrade: "Natural colour with minimal grading; muted saturation; honest skin tones; no extreme colour treatment",
    texture: "Natural environmental texture; realistic material rendering; minimal artificial polish; honest surface detail",
    atmosphere: "Observational authenticity; grounded realism; human-scale perspective; honest unpolished presence",
    imageDirection: "Observational realism. Natural or practical light. Authentic environments. Imperfect but readable framing. Honest material texture. Minimal artificial polish. Human-scale perspective.",
    videoDirection: "Observational static shot. Subtle handheld. Follow shot. Side tracking. Walk-and-talk. Natural operator-height movement.",
    cameraMovementPreferences: { families: ["handheld", "static", "follow", "tracking"], speedPref: "medium" },
    pacing: "Natural observational pacing; variable rhythm; authentic scene duration",
    transitionGuidance: "Hard cuts; no stylized transitions; no slow motion montage",
    negativeConstraints: "Avoid staged glamour lighting, extreme colour grading, fake film damage, chaotic shake, overly cinematic slow motion by default",
  },
  {
    id: "retro-futurist-scifi",
    label: "Retro-Futurist Sci-Fi",
    shortDescription: "Optimistic or mysterious future viewed through a retro design language with practical-looking technology",
    compatibleMedia: ["image", "video"],
    lighting: "Controlled luminous interfaces with practical-looking technology; geometric production design; cinematic atmosphere",
    lensAndOptics: "Prime or anamorphic with controlled flare; clean modern optics; precise focus characteristics",
    composition: "Geometric production design; controlled luminous interfaces; cinematic atmosphere; physical materials rather than generic hologram clutter; symmetrical or ordered framing",
    colourGrade: "Cool temperature with controlled accent colours; deep blacks; luminous highlights; restrained neon palette",
    texture: "Physical material rendering with surface detail; no holographic overlay; practical texture on technology surfaces",
    atmosphere: "Optimistic or mysterious future through retro design language; practical technology; cinematic physicality",
    imageDirection: "Optimistic or mysterious future viewed through a retro design language. Practical-looking technology. Geometric production design. Controlled luminous interfaces. Cinematic atmosphere. Physical materials rather than generic hologram clutter.",
    videoDirection: "Precise tracking. Symmetrical dolly. Controlled orbit. Pass-through. Crane reveal. Motivated futuristic transitions.",
    cameraMovementPreferences: { families: ["dolly", "orbit", "jib", "static"], speedPref: "medium" },
    pacing: "Measured pacing; deliberate reveals; controlled rhythm; precise timing",
    transitionGuidance: "Hard cuts; wipe transitions when motivated; no random glitch effects",
    negativeConstraints: "Avoid unreadable UI text, excessive neon, generic cyberpunk duplication, random holograms, visually impossible camera movement",
  },
  {
    id: "epic-golden-hour",
    label: "Epic Golden Hour",
    shortDescription: "Warm low-angle sunlight with long controlled shadows, atmospheric depth, and luminous edge light",
    compatibleMedia: ["image", "video"],
    lighting: "Warm low-angle sunlight; long controlled shadows; atmospheric depth; luminous edge light; protected highlight detail",
    lensAndOptics: "Spherical primes or zooms with warm coating; controlled flare on sun source; natural light characteristics",
    composition: "Broad environmental scale; warm low-angle sunlight; long controlled shadows; luminous edge light; emotional but realistic composition",
    colourGrade: "Emotional but realistic warm colour; protected highlight detail; natural golden saturation; no orange colour cast over the entire image",
    texture: "Natural atmospheric texture; warm light scattering; highlight roll-off with detail protection; no artificial sun rays",
    atmosphere: "Emotional warmth; epic natural scale; golden luminosity; protected atmospheric depth",
    imageDirection: "Warm low-angle sunlight. Long controlled shadows. Atmospheric depth. Luminous edge light. Broad environmental scale. Emotional but realistic colour. Protected highlight detail.",
    videoDirection: "Drone pullback when environment supports it. Crane rise. Slow tracking. Dolly reveal. Panoramic movement. Restrained time-lapse when appropriate.",
    cameraMovementPreferences: { families: ["drone", "jib", "tracking", "dolly"], speedPref: "slow" },
    pacing: "Slow meditative pacing; extended golden moments; patient reveals",
    transitionGuidance: "Slow dissolves; gentle fades; no rapid cutting",
    negativeConstraints: "Avoid orange colour cast over the entire image, blown highlights, artificial sun rays, aerial movement in small interiors",
  },
];

export const CINEMATIC_STYLE_OPTIONS = [
  { value: "auto", label: "AI decides", description: "Let the AI choose the best cinematic style" },
  ...STYLES.map((s) => ({ value: s.id, label: s.label, description: s.shortDescription })),
];

const STYLE_MAP = Object.fromEntries(STYLES.map((s) => [s.id, s]));

export function getCinematicStyleById(id) {
  if (!id || id === "auto") return null;
  return STYLES.find((s) => s.id === id) || null;
}

export function validateCinematicStyle(value) {
  if (!value || value === "auto") return "auto";
  return STYLES.some((s) => s.id === value) ? value : null;
}

export function normalizeCinematicStyle(value) {
  if (!value || typeof value !== "string") return "auto";
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (trimmed === "auto") return "auto";
  if (STYLE_MAP[trimmed]) return trimmed;
  for (const s of STYLES) {
    if (s.label.toLowerCase().replace(/\s+/g, "-") === trimmed) return s.id;
  }
  return null;
}

/**
 * Single source of truth for resolving a user-supplied cinematic style.
 *
 * Returns:
 *   { style: "auto" }            when the value is missing, blank, or "auto" —
 *                                the AI decides.
 *   { style: "<valid-id>" }      for a supported preset (matched by id or
 *                                display label).
 *   { error: "<message>" }       for an explicit but unsupported value. Callers
 *                                should surface this as a 400 response rather
 *                                than silently downgrading to "auto".
 *
 * Never throws.
 */
export function resolveCinematicStyle(value) {
  if (value === undefined || value === null) return { style: CINEMATIC_STYLE_DEFAULT };
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === "auto") return { style: CINEMATIC_STYLE_DEFAULT };
  const normalized = normalizeCinematicStyle(trimmed);
  if (!normalized) {
    return {
      error:
        `Unsupported cinematic style: "${trimmed}". ` +
        `Choose one of the supported styles or set it to "auto" to let the AI decide.`,
    };
  }
  return { style: normalized };
}

function blockLine(label, value) {
  return `${label}:\n${value}`;
}

function blockSection(title, lines) {
  return `${title}\n${lines.join("\n")}`;
}

export function buildImageStyleBlock(styleId) {
  const style = getCinematicStyleById(styleId);
  if (!style) return "";

  return [
    "CINEMATIC VISUAL STYLE",
    "",
    blockLine("Selected style", style.label),
    "",
    blockLine("Lighting", style.lighting),
    "",
    blockLine("Lens and optics", style.lensAndOptics),
    "",
    blockLine("Composition", style.composition),
    "",
    blockLine("Colour grade", style.colourGrade),
    "",
    blockLine("Texture and finish", style.texture),
    "",
    blockLine("Atmosphere", style.atmosphere),
    "",
    blockLine("Style constraints", style.negativeConstraints),
  ].join("\n");
}

export function buildVideoStyleBlock(styleId) {
  const style = getCinematicStyleById(styleId);
  if (!style) return "";

  return [
    "CINEMATIC VISUAL STYLE",
    "",
    blockLine("Selected style", style.label),
    "",
    blockLine("Lighting", style.lighting),
    "",
    blockLine("Lens and optics", style.lensAndOptics),
    "",
    blockLine("Composition", style.composition),
    "",
    blockLine("Colour grade", style.colourGrade),
    "",
    blockLine("Texture", style.texture),
    "",
    blockLine("Atmosphere", style.atmosphere),
    "",
    blockLine("Motion character", style.videoDirection),
    "",
    blockLine("Pacing", style.pacing),
    "",
    blockLine("Style constraints", style.negativeConstraints),
  ].join("\n");
}

export const CINEMATIC_STYLE_MOVEMENT_MAP = Object.fromEntries(
  STYLES.map((s) => [
    s.id,
    {
      families: s.cameraMovementPreferences.families,
      speedPref: s.cameraMovementPreferences.speedPref,
      label: s.label,
    },
  ]),
);
