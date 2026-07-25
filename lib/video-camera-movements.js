// Shared video "Camera Movement" knowledge module.
//
// Provides a deterministic movement selector, a taxonomy of 46+ movements across
// seven reference categories, genre/style/scene/subject mappings, compatibility
// validation, storyboard variation, and prompt formatters. Safe to import from
// both client and server — no React or server-only dependencies.
//
// Reference: https://aicameramovements.com/#finder
//
// ── Seven reference categories ───────────────────────────────────────────────
// PAN_TILT, ZOOM_LENS, DOLLY_TRACK, PHYSICAL_MOVES, HUMAN_CAMERA,
// DRONE_CRANE, SPECIALS

export const REFERENCE_CATEGORIES = [
  "PAN_TILT",
  "ZOOM_LENS",
  "DOLLY_TRACK",
  "PHYSICAL_MOVES",
  "HUMAN_CAMERA",
  "DRONE_CRANE",
  "SPECIALS",
];

// ── Internal families (for grouping within the module) ──────────────────────

export const MOVEMENT_FAMILIES = {
  static:       { label: "Static / Locked",    order: 0 },
  pan:          { label: "Pan",                order: 1 },
  tilt:         { label: "Tilt",               order: 2 },
  zoom:         { label: "Zoom",               order: 3 },
  dolly:        { label: "Dolly / Track",      order: 4 },
  handheld:     { label: "Handheld",           order: 5 },
  jib:          { label: "Jib / Crane",        order: 6 },
  drone:        { label: "Drone / Aerial",     order: 7 },
  orbit:        { label: "Orbit / Circular",   order: 8 },
  roll:         { label: "Roll",               order: 9 },
  follow:       { label: "Follow / Tracking",  order: 10 },
  complex:      { label: "Complex / Combined", order: 11 },
  physical:     { label: "Physical / Studio",  order: 12 },
  special:      { label: "Special / Effect",   order: 13 },
  human:        { label: "Human-Mounted",      order: 14 },
};

// ── Movement catalogue ──────────────────────────────────────────────────────
// Each movement exposes:
//   id, displayName, referenceCategory, internalFamily (family),
//   instruction, compatibleGenres, compatibleStyles, compatibleSubjects,
//   compatibleScenes, emotionalEffect, defaultSpeed, framingRule, endFrameRule,
//   requiredConditions, incompatibleConditions
// Retained legacy fields: label, family, direction, speedRange, execution,
//   framing (alias for framingRule), endFrame (alias for endFrameRule),
//   actionLevel, description

export const MOVEMENTS = [

  // ── PAN / TILT ─────────────────────────────────────────────────────────
  {
    id: "static",
    displayName: "Static shot",
    referenceCategory: "PAN_TILT",
    family: "static",
    label: "Static",
    direction: "none",
    speedRange: ["still"],
    execution: "tripod-locked",
    framing: ["wide", "medium", "close-up"],
    framingRule: "wide, medium, or close-up — subject fills desired portion of frame; no camera motion at all",
    endFrame: "same-as-start",
    endFrameRule: "identical frame — no change in position, angle, or focal length",
    actionLevel: ["low", "medium"],
    description: "Camera is locked on a tripod with no movement. The frame is perfectly still.",
    instruction: "Lock camera on a tripod. Do not move the camera at any point. The frame must remain completely static throughout the shot.",
    compatibleGenres: ["talking-head", "interview", "testimonial", "educational", "tutorial", "corporate", "suspense"],
    compatibleStyles: ["cinematic", "documentary", "commercial", "social-media"],
    compatibleSubjects: ["human", "product", "animal", "landscape", "food", "abstract"],
    compatibleScenes: ["dialogue", "close-up", "interior", "interview", "product-showcase"],
    emotionalEffect: "calm, authoritative, intentional, grounded",
    defaultSpeed: "still",
    requiredConditions: [],
    incompatibleConditions: ["subject requires dynamic reframing", "scene demands energy or urgency"],
  },
  {
    id: "static-handheld",
    displayName: "Static handheld",
    referenceCategory: "PAN_TILT",
    family: "static",
    label: "Static — Handheld",
    direction: "none",
    speedRange: ["still"],
    execution: "handheld-steady",
    framing: ["medium", "close-up"],
    framingRule: "medium to close-up — human-scale framing with subtle organic micro-movement",
    endFrame: "same-as-start",
    endFrameRule: "same frame composition, but with continuous micro-motion from breathing",
    actionLevel: ["low", "medium", "high"],
    description: "Camera is held steady but has a subtle human breathing quality. Not completely locked off.",
    instruction: "Hold camera by hand. Keep frame pointed at the subject. Do not reframe or move — allow only natural micro-motion from breathing and muscle tremor. The shot should feel present and human, not robotic.",
    compatibleGenres: ["vlog", "documentary", "behind-the-scenes", "talking-head", "interview"],
    compatibleStyles: ["documentary", "social-media", "vlog"],
    compatibleSubjects: ["human", "animal"],
    compatibleScenes: ["dialogue", "close-up", "interview", "confessional"],
    emotionalEffect: "intimate, present, authentic, unpolished",
    defaultSpeed: "still",
    requiredConditions: [],
    incompatibleConditions: ["shot requires absolute stillness", "product shot needing sterile precision"],
  },
  {
    id: "pan-left",
    displayName: "Pan left",
    referenceCategory: "PAN_TILT",
    family: "pan",
    label: "Pan Left",
    direction: "left",
    speedRange: ["slow", "medium", "fast"],
    execution: "tripod-smooth",
    framing: ["wide", "medium"],
    framingRule: "wide or medium — start with subject off-screen right, end with subject off-screen left, or reveal space",
    endFrame: "opposite-direction",
    endFrameRule: "frame faces opposite horizontal direction; new content enters from the right",
    actionLevel: ["low", "medium"],
    description: "Camera rotates horizontally to the left on a fixed axis. Reveals space or follows lateral movement.",
    instruction: "Mount camera on a tripod or fluid head. Rotate the camera body horizontally to the left. Keep the axis fixed — do not translate the camera position. Speed and distance depend on how much of the environment needs to be revealed.",
    compatibleGenres: ["educational", "travel", "documentary", "real-estate", "nature", "corporate"],
    compatibleStyles: ["cinematic", "documentary", "commercial"],
    compatibleSubjects: ["landscape", "architecture", "interior", "group"],
    compatibleScenes: ["establishing", "interior", "exterior", "reveal", "walk-and-talk"],
    emotionalEffect: "observational, exploratory, measured",
    defaultSpeed: "medium",
    requiredConditions: [],
    incompatibleConditions: [],
  },
  {
    id: "pan-right",
    displayName: "Pan right",
    referenceCategory: "PAN_TILT",
    family: "pan",
    label: "Pan Right",
    direction: "right",
    speedRange: ["slow", "medium", "fast"],
    execution: "tripod-smooth",
    framing: ["wide", "medium"],
    framingRule: "wide or medium — start with subject off-screen left, end with subject off-screen right",
    endFrame: "opposite-direction",
    endFrameRule: "frame faces opposite horizontal direction; new content enters from the left",
    actionLevel: ["low", "medium"],
    description: "Camera rotates horizontally to the right on a fixed axis. Reveals space or follows lateral movement.",
    instruction: "Mount camera on a tripod or fluid head. Rotate the camera body horizontally to the right. Keep the axis fixed — do not translate the camera position.",
    compatibleGenres: ["educational", "travel", "documentary", "real-estate", "nature", "corporate"],
    compatibleStyles: ["cinematic", "documentary", "commercial"],
    compatibleSubjects: ["landscape", "architecture", "interior", "group"],
    compatibleScenes: ["establishing", "interior", "exterior", "reveal", "walk-and-talk"],
    emotionalEffect: "observational, exploratory, measured",
    defaultSpeed: "medium",
    requiredConditions: [],
    incompatibleConditions: [],
  },
  {
    id: "whip-pan-left",
    displayName: "Whip pan left",
    referenceCategory: "PAN_TILT",
    family: "pan",
    label: "Whip Pan Left",
    direction: "left",
    speedRange: ["very-fast"],
    execution: "tripod-fast",
    framing: ["wide", "medium"],
    framingRule: "wide or medium — motion blur intentionally obscures detail; used as a transition",
    endFrame: "different-scene",
    endFrameRule: "lands on a completely different subject or scene; the blur masks the cut",
    actionLevel: ["high"],
    description: "Extremely fast horizontal pan to the left. Motion blur obscures the transition between scenes or subjects.",
    instruction: "Execute an extremely fast horizontal rotation to the left. The speed must be fast enough to create significant motion blur. Use as a dynamic transition between two scenes or subjects. The blur masks the edit.",
    compatibleGenres: ["music-video", "action", "social-media-reel", "tiktok", "commercial-ad"],
    compatibleStyles: ["social-media", "action"],
    compatibleSubjects: ["human", "landscape"],
    compatibleScenes: ["transition", "action"],
    emotionalEffect: "energetic, disorienting, dynamic, transitional",
    defaultSpeed: "very-fast",
    requiredConditions: ["transition between two distinct scenes or subjects"],
    incompatibleConditions: ["single continuous scene", "slow-paced content", "meditative or calm tone"],
  },
  {
    id: "whip-pan-right",
    displayName: "Whip pan right",
    referenceCategory: "PAN_TILT",
    family: "pan",
    label: "Whip Pan Right",
    direction: "right",
    speedRange: ["very-fast"],
    execution: "tripod-fast",
    framing: ["wide", "medium"],
    framingRule: "wide or medium — motion blur intentionally obscures detail; used as a transition",
    endFrame: "different-scene",
    endFrameRule: "lands on a completely different subject or scene; the blur masks the cut",
    actionLevel: ["high"],
    description: "Extremely fast horizontal pan to the right. Motion blur obscures the transition between scenes or subjects.",
    instruction: "Execute an extremely fast horizontal rotation to the right. The speed must create significant motion blur. Use as a dynamic transition between two scenes or subjects.",
    compatibleGenres: ["music-video", "action", "social-media-reel", "tiktok", "commercial-ad"],
    compatibleStyles: ["social-media", "action"],
    compatibleSubjects: ["human", "landscape"],
    compatibleScenes: ["transition", "action"],
    emotionalEffect: "energetic, disorienting, dynamic, transitional",
    defaultSpeed: "very-fast",
    requiredConditions: ["transition between two distinct scenes or subjects"],
    incompatibleConditions: ["single continuous scene", "slow-paced content", "meditative or calm tone"],
  },
  {
    id: "tilt-up",
    displayName: "Tilt up",
    referenceCategory: "PAN_TILT",
    family: "tilt",
    label: "Tilt Up",
    direction: "up",
    speedRange: ["slow", "medium"],
    execution: "tripod-smooth",
    framing: ["medium", "close-up"],
    framingRule: "medium to close-up — start on a lower detail, reveal height or scale",
    endFrame: "opposite-direction",
    endFrameRule: "frame points upward; reveals what is above the starting point",
    actionLevel: ["low", "medium"],
    description: "Camera tilts upward on a fixed axis. Reveals height, scale, or vertical subject movement.",
    instruction: "Mount camera on a tripod. Rotate the camera body vertically upward. Useful for revealing tall subjects, architecture, or following upward movement.",
    compatibleGenres: ["cinematic-narrative", "corporate", "real-estate", "fashion"],
    compatibleStyles: ["cinematic", "commercial", "documentary"],
    compatibleSubjects: ["human", "architecture", "landscape", "product"],
    compatibleScenes: ["reveal", "establishing", "interior"],
    emotionalEffect: "awe, scale, aspiration, reverence",
    defaultSpeed: "slow",
    requiredConditions: [],
    incompatibleConditions: [],
  },
  {
    id: "tilt-down",
    displayName: "Tilt down",
    referenceCategory: "PAN_TILT",
    family: "tilt",
    label: "Tilt Down",
    direction: "down",
    speedRange: ["slow", "medium"],
    execution: "tripod-smooth",
    framing: ["medium", "close-up"],
    framingRule: "medium to close-up — start on a higher detail, reveal ground or context below",
    endFrame: "opposite-direction",
    endFrameRule: "frame points downward; reveals what is below the starting point",
    actionLevel: ["low", "medium"],
    description: "Camera tilts downward on a fixed axis. Reveals ground, context, or downward movement.",
    instruction: "Mount camera on a tripod. Rotate the camera body vertically downward. Useful for revealing ground-level detail, following descending action, or showing scale from above.",
    compatibleGenres: ["cinematic-narrative", "documentary", "food", "product-demo"],
    compatibleStyles: ["cinematic", "documentary", "commercial"],
    compatibleSubjects: ["human", "food", "product", "landscape"],
    compatibleScenes: ["reveal", "close-up", "interior"],
    emotionalEffect: "grounding, vulnerability, inspection, context",
    defaultSpeed: "slow",
    requiredConditions: [],
    incompatibleConditions: [],
  },

  // ── ZOOM / LENS ────────────────────────────────────────────────────────
  // Generic zoom-in/zoom-out kept for backward compatibility; speed-specific
  // variants added below.
  {
    id: "zoom-in",
    displayName: "Zoom in",
    referenceCategory: "ZOOM_LENS",
    family: "zoom",
    label: "Zoom In",
    direction: "inward",
    speedRange: ["slow", "medium", "fast", "crash"],
    execution: "lens-based",
    framing: ["wide", "medium", "close-up"],
    framingRule: "any starting frame — focal length increases to magnify the subject",
    endFrame: "tighter",
    endFrameRule: "frame is significantly tighter than start; subject occupies more of the frame",
    actionLevel: ["low", "medium", "high"],
    description: "Lens focal length increases, magnifying the subject without physical camera movement.",
    instruction: "Adjust the lens focal length from wide to telephoto. The camera body does not move — only the lens changes. The subject grows larger in the frame while the background compresses.",
    compatibleGenres: ["talking-head", "tutorial", "suspense", "educational", "documentary"],
    compatibleStyles: ["cinematic", "documentary", "social-media", "commercial"],
    compatibleSubjects: ["human", "product", "animal", "food"],
    compatibleScenes: ["close-up", "dialogue", "interview", "reveal"],
    emotionalEffect: "intimacy, focus, intensity, claustrophobia (if slow)",
    defaultSpeed: "medium",
    requiredConditions: [],
    incompatibleConditions: [],
  },
  {
    id: "zoom-out",
    displayName: "Zoom out",
    referenceCategory: "ZOOM_LENS",
    family: "zoom",
    label: "Zoom Out",
    direction: "outward",
    speedRange: ["slow", "medium", "fast"],
    execution: "lens-based",
    framing: ["wide", "medium", "close-up"],
    framingRule: "any starting frame — focal length decreases to reveal more environment",
    endFrame: "wider",
    endFrameRule: "frame is significantly wider than start; more environment is visible",
    actionLevel: ["low", "medium"],
    description: "Lens focal length decreases, revealing more environment without physical camera movement.",
    instruction: "Adjust the lens focal length from telephoto to wide. The camera body does not move — only the lens changes. The subject shrinks in the frame as the background expands.",
    compatibleGenres: ["real-estate", "travel", "documentary", "educational"],
    compatibleStyles: ["cinematic", "documentary", "commercial"],
    compatibleSubjects: ["landscape", "architecture", "interior", "group"],
    compatibleScenes: ["reveal", "establishing", "exterior", "interior"],
    emotionalEffect: "context, isolation, revelation, vulnerability",
    defaultSpeed: "medium",
    requiredConditions: [],
    incompatibleConditions: [],
  },
  {
    id: "slow-zoom-in",
    displayName: "Slow zoom in",
    referenceCategory: "ZOOM_LENS",
    family: "zoom",
    label: "Slow Zoom In",
    direction: "inward",
    speedRange: ["slow"],
    execution: "lens-based",
    framing: ["wide", "medium"],
    framingRule: "wide or medium start — very gradual focal length increase over 8+ seconds",
    endFrame: "tighter",
    endFrameRule: "subtly tighter frame; the zoom should be nearly imperceptible moment-to-moment",
    actionLevel: ["low"],
    description: "Very gradual zoom in over an extended duration. The movement is almost imperceptible.",
    instruction: "Increase focal length at an extremely slow rate over 8 or more seconds. The zoom must be so gradual that the viewer does not consciously register the movement — only the growing sense of focus.",
    compatibleGenres: ["cinematic-narrative", "suspense", "drama", "portrait"],
    compatibleStyles: ["cinematic"],
    compatibleSubjects: ["human", "landscape"],
    compatibleScenes: ["close-up", "dialogue", "meditation"],
    emotionalEffect: "hypnotic, intensifying, psychological pressure, inevitability",
    defaultSpeed: "slow",
    requiredConditions: ["minimum 8-second duration", "tripod or locked-off camera"],
    incompatibleConditions: ["action sequence", "fast-paced editing", "handheld camera"],
  },
  {
    id: "slow-zoom-out",
    displayName: "Slow zoom out",
    referenceCategory: "ZOOM_LENS",
    family: "zoom",
    label: "Slow Zoom Out",
    direction: "outward",
    speedRange: ["slow"],
    execution: "lens-based",
    framing: ["close-up", "medium"],
    framingRule: "close-up or medium start — very gradual focal length decrease over 8+ seconds",
    endFrame: "wider",
    endFrameRule: "subtly wider frame; slowly reveals environment almost imperceptibly",
    actionLevel: ["low"],
    description: "Very gradual zoom out over an extended duration. Slowly reveals the environment.",
    instruction: "Decrease focal length at an extremely slow rate over 8 or more seconds. The zoom must be nearly imperceptible. The environment and context slowly creep into the frame.",
    compatibleGenres: ["cinematic-narrative", "drama", "documentary"],
    compatibleStyles: ["cinematic", "documentary"],
    compatibleSubjects: ["human", "landscape"],
    compatibleScenes: ["reveal", "establishing", "reflection"],
    emotionalEffect: "isolation, perspective, loneliness, contemplation",
    defaultSpeed: "slow",
    requiredConditions: ["minimum 8-second duration"],
    incompatibleConditions: ["action sequence", "fast-paced editing"],
  },
  {
    id: "fast-zoom-in",
    displayName: "Fast zoom in",
    referenceCategory: "ZOOM_LENS",
    family: "zoom",
    label: "Fast Zoom In",
    direction: "inward",
    speedRange: ["fast"],
    execution: "lens-based",
    framing: ["wide", "medium"],
    framingRule: "wide or medium start — quick focal length increase in under 1 second",
    endFrame: "tighter",
    endFrameRule: "significantly tighter frame achieved rapidly; may overshoot slightly",
    actionLevel: ["medium", "high"],
    description: "Quick, intentional zoom in to emphasize a specific detail or reaction.",
    instruction: "Increase focal length rapidly (under 1 second) to punch into a subject or detail. The movement is intentional and controlled — not a crash zoom. Use to emphasize a reaction, reveal, or key detail.",
    compatibleGenres: ["sports", "action", "reaction", "documentary"],
    compatibleStyles: ["documentary", "social-media", "action"],
    compatibleSubjects: ["human", "animal", "product"],
    compatibleScenes: ["action", "reaction", "close-up"],
    emotionalEffect: "emphasis, surprise, punctuation, energy",
    defaultSpeed: "fast",
    requiredConditions: [],
    incompatibleConditions: ["meditative pace", "slow, contemplative content"],
  },
  {
    id: "fast-zoom-out",
    displayName: "Fast zoom out",
    referenceCategory: "ZOOM_LENS",
    family: "zoom",
    label: "Fast Zoom Out",
    direction: "outward",
    speedRange: ["fast"],
    execution: "lens-based",
    framing: ["close-up", "medium"],
    framingRule: "close-up or medium start — quick focal length decrease in under 1 second",
    endFrame: "wider",
    endFrameRule: "significantly wider frame achieved rapidly; reveals context suddenly",
    actionLevel: ["medium", "high"],
    description: "Quick zoom out to reveal context or a wider scene suddenly.",
    instruction: "Decrease focal length rapidly (under 1 second) to pull out from a detail to a wider view. Creates a sudden reveal of the environment. Use for comedic reveals, surprise context shifts, or energetic punctuation.",
    compatibleGenres: ["comedy", "reaction", "travel", "music-video"],
    compatibleStyles: ["social-media", "documentary", "action"],
    compatibleSubjects: ["human", "landscape"],
    compatibleScenes: ["reveal", "reaction", "comedy-beat"],
    emotionalEffect: "surprise, comedy, revelation, energy",
    defaultSpeed: "fast",
    requiredConditions: [],
    incompatibleConditions: ["serious dramatic tone", "meditative content"],
  },
  {
    id: "crash-zoom-in",
    displayName: "Crash zoom in",
    referenceCategory: "ZOOM_LENS",
    family: "zoom",
    label: "Crash Zoom In",
    direction: "inward",
    speedRange: ["crash"],
    execution: "lens-based",
    framing: ["wide", "medium"],
    framingRule: "wide or medium start — violently fast zoom that may overshoot and briefly lose focus",
    endFrame: "tighter",
    endFrameRule: "extremely tight frame achieved instantly; may overshoot and pull back slightly",
    actionLevel: ["high"],
    description: "Aggressively fast zoom in. Often overshoots briefly. Creates a jarring, intentional impact.",
    instruction: "Crank the zoom ring from wide to telephoto as fast as physically possible. The shot may briefly overshoot or lose focus before settling. The effect is intentionally jarring and impactful.",
    compatibleGenres: ["action", "horror", "music-video", "comedy"],
    compatibleStyles: ["action", "social-media"],
    compatibleSubjects: ["human", "animal"],
    compatibleScenes: ["action", "horror-reveal", "comedy-beat", "shock-moment"],
    emotionalEffect: "shock, aggression, disorientation, impact",
    defaultSpeed: "crash",
    requiredConditions: ["moment of high impact or surprise"],
    incompatibleConditions: ["slow-paced narrative", "calm or serene content", "documentary realism"],
  },
  {
    id: "crash-zoom-out",
    displayName: "Crash zoom out",
    referenceCategory: "ZOOM_LENS",
    family: "zoom",
    label: "Crash Zoom Out",
    direction: "outward",
    speedRange: ["crash"],
    execution: "lens-based",
    framing: ["close-up", "medium"],
    framingRule: "close-up or medium start — violently fast zoom out that disorients",
    endFrame: "wider",
    endFrameRule: "extremely wide frame achieved instantly; environment suddenly fully visible",
    actionLevel: ["high"],
    description: "Aggressively fast zoom out. Jarring reveal of the full environment.",
    instruction: "Crank the zoom ring from telephoto to wide as fast as possible. The sudden environmental reveal is intentionally disorienting. Often used for comedic reveals or shock value.",
    compatibleGenres: ["comedy", "horror", "music-video", "action"],
    compatibleStyles: ["action", "social-media"],
    compatibleSubjects: ["human", "landscape"],
    compatibleScenes: ["reveal", "comedy-beat", "horror-reveal"],
    emotionalEffect: "shock, comedy, disorientation, grand reveal",
    defaultSpeed: "crash",
    requiredConditions: ["moment of high impact or surprise"],
    incompatibleConditions: ["slow-paced narrative", "calm content", "documentary realism"],
  },

  // ── DOLLY / TRACK ──────────────────────────────────────────────────────
  {
    id: "dolly-in",
    displayName: "Dolly in",
    referenceCategory: "DOLLY_TRACK",
    family: "dolly",
    label: "Dolly In",
    direction: "forward",
    speedRange: ["slow", "medium", "fast"],
    execution: "tracked-smooth",
    framing: ["medium", "close-up"],
    framingRule: "medium or close-up start — camera physically moves toward subject; background expands around them",
    endFrame: "tighter",
    endFrameRule: "subject fills more of the frame; background perspective changes (unlike zoom)",
    actionLevel: ["low", "medium", "high"],
    description: "Camera physically moves toward the subject on tracks or wheels. Creates depth and immersion.",
    instruction: "Place camera on a dolly, tracks, or wheels. Physically push the camera forward toward the subject. The background perspective changes naturally — unlike a zoom, which compresses the background. Creates a sense of entering the scene.",
    compatibleGenres: ["cinematic-narrative", "interview", "testimonial", "suspense", "corporate", "food", "fashion"],
    compatibleStyles: ["cinematic", "commercial", "documentary"],
    compatibleSubjects: ["human", "product", "food", "animal"],
    compatibleScenes: ["dialogue", "interview", "close-up", "interior", "reveal"],
    emotionalEffect: "intimacy, immersion, discovery, intensity",
    defaultSpeed: "slow",
    requiredConditions: [],
    incompatibleConditions: [],
  },
  {
    id: "dolly-out",
    displayName: "Dolly out",
    referenceCategory: "DOLLY_TRACK",
    family: "dolly",
    label: "Dolly Out",
    direction: "backward",
    speedRange: ["slow", "medium", "fast"],
    execution: "tracked-smooth",
    framing: ["close-up", "medium", "wide"],
    framingRule: "close-up or medium start — camera physically moves away; subject shrinks, environment expands",
    endFrame: "wider",
    endFrameRule: "subject is smaller; more environment is visible; background perspective deepens",
    actionLevel: ["low", "medium"],
    description: "Camera physically moves away from the subject. Reveals environment and context.",
    instruction: "Place camera on a dolly and pull it backward away from the subject. The environment behind and around the subject becomes increasingly visible. Creates a sense of departure or expanding context.",
    compatibleGenres: ["cinematic-narrative", "real-estate", "travel", "documentary"],
    compatibleStyles: ["cinematic", "documentary", "commercial"],
    compatibleSubjects: ["human", "landscape", "architecture", "interior"],
    compatibleScenes: ["reveal", "establishing", "exterior", "interior"],
    emotionalEffect: "isolation, context, departure, loneliness",
    defaultSpeed: "slow",
    requiredConditions: [],
    incompatibleConditions: [],
  },
  {
    id: "tracking-shot",
    displayName: "Tracking shot",
    referenceCategory: "DOLLY_TRACK",
    family: "follow",
    label: "Tracking Shot",
    direction: "forward",
    speedRange: ["slow", "medium", "fast"],
    execution: "tracked-smooth",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera moves alongside a moving subject, maintaining consistent distance",
    endFrame: "same-distance",
    endFrameRule: "camera maintains the same distance and framing relationship to the subject throughout",
    actionLevel: ["medium", "high"],
    description: "Camera moves alongside a moving subject, keeping a consistent distance and framing.",
    instruction: "Mount camera on a dolly, gimbal, or stabilizer. Move parallel to the subject as they walk, run, or travel. Maintain consistent distance and framing. The subject moves through the environment while the camera flows alongside.",
    compatibleGenres: ["action", "sports", "travel", "cinematic-narrative", "vlog"],
    compatibleStyles: ["cinematic", "documentary", "action"],
    compatibleSubjects: ["human", "animal", "vehicle"],
    compatibleScenes: ["action", "walk-and-talk", "travel", "sports"],
    emotionalEffect: "immersion, momentum, journey, companionship",
    defaultSpeed: "medium",
    requiredConditions: ["moving subject", "sufficient space for camera movement"],
    incompatibleConditions: ["stationary subject", "confined space"],
  },
  {
    id: "follow-over-shoulder",
    displayName: "Follow / Over-the-shoulder",
    referenceCategory: "DOLLY_TRACK",
    family: "follow",
    label: "Follow — Over-the-Shoulder",
    direction: "forward",
    speedRange: ["slow", "medium"],
    execution: "tracked-smooth",
    framing: ["close-up", "medium"],
    framingRule: "close-up or medium — camera positioned just behind and to the side of a subject's shoulder",
    endFrame: "same-distance",
    endFrameRule: "camera maintains over-the-shoulder position relative to the subject",
    actionLevel: ["low", "medium"],
    description: "Camera follows from just behind and to the side of a subject, capturing their perspective from behind.",
    instruction: "Position the camera behind and slightly to the side of the subject, at shoulder height. Move with the subject, maintaining the over-the-shoulder framing. The viewer sees what the subject sees, with the subject's shoulder/head in the foreground.",
    compatibleGenres: ["cinematic-narrative", "documentary", "walk-and-talk", "vlog"],
    compatibleStyles: ["cinematic", "documentary"],
    compatibleSubjects: ["human"],
    compatibleScenes: ["walk-and-talk", "dialogue", "action", "exploration"],
    emotionalEffect: "intimacy, subjective connection, presence",
    defaultSpeed: "medium",
    requiredConditions: ["human subject walking or moving forward"],
    incompatibleConditions: ["stationary subject", "product shot", "landscape only"],
  },
  {
    id: "reverse-tracking",
    displayName: "Reverse tracking / Walk-and-talk",
    referenceCategory: "DOLLY_TRACK",
    family: "follow",
    label: "Reverse Tracking",
    direction: "backward",
    speedRange: ["slow", "medium", "fast"],
    execution: "tracked-smooth",
    framing: ["medium", "close-up"],
    framingRule: "medium or close-up — camera moves backward ahead of subject, facing them",
    endFrame: "same-distance",
    endFrameRule: "camera maintains consistent distance ahead of the subject throughout",
    actionLevel: ["medium", "high"],
    description: "Camera moves backward ahead of a subject, facing them as they walk forward. Classic walk-and-talk.",
    instruction: "Walk backward ahead of the subject while facing them. The camera leads the subject, who walks toward the lens. Maintain consistent distance. Common in dialogue scenes and walk-and-talk sequences.",
    compatibleGenres: ["cinematic-narrative", "vlog", "documentary", "walk-and-talk"],
    compatibleStyles: ["cinematic", "documentary"],
    compatibleSubjects: ["human"],
    compatibleScenes: ["walk-and-talk", "dialogue", "travel"],
    emotionalEffect: "engagement, momentum, conversation, journey",
    defaultSpeed: "medium",
    requiredConditions: ["human subject walking forward"],
    incompatibleConditions: ["stationary subject", "backward movement unsafe in environment"],
  },
  {
    id: "side-tracking",
    displayName: "Side tracking",
    referenceCategory: "DOLLY_TRACK",
    family: "dolly",
    label: "Side Tracking",
    direction: "lateral",
    speedRange: ["slow", "medium", "fast"],
    execution: "tracked-smooth",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — subject in profile; camera moves perpendicular to subject's movement",
    endFrame: "shifted-lateral",
    endFrameRule: "camera has moved laterally; subject position in frame remains constant",
    actionLevel: ["low", "medium", "high"],
    description: "Camera tracks laterally alongside a subject who moves parallel to the camera path.",
    instruction: "Move the camera sideways on a dolly or slider, parallel to the subject's movement path. The subject remains in profile as both camera and subject move in the same direction. The background flows behind them.",
    compatibleGenres: ["cinematic-narrative", "travel", "fashion", "action"],
    compatibleStyles: ["cinematic", "commercial", "action"],
    compatibleSubjects: ["human", "vehicle", "animal"],
    compatibleScenes: ["action", "travel", "fashion-walk"],
    emotionalEffect: "elegance, momentum, observation, fluidity",
    defaultSpeed: "medium",
    requiredConditions: ["subject moving laterally"],
    incompatibleConditions: ["stationary subject"],
  },
  {
    id: "low-tracking",
    displayName: "Low tracking",
    referenceCategory: "DOLLY_TRACK",
    family: "dolly",
    label: "Low Tracking",
    direction: "forward",
    speedRange: ["slow", "medium", "fast"],
    execution: "tracked-smooth",
    framing: ["low", "medium"],
    framingRule: "low angle — camera near ground level, tracking alongside or toward subject",
    endFrame: "same-distance",
    endFrameRule: "camera remains low, maintaining consistent ground-level framing",
    actionLevel: ["medium", "high"],
    description: "Camera tracks at ground level, creating a low-angle perspective while moving.",
    instruction: "Mount camera close to the ground (wheeled platform or low dolly). Track forward or alongside the subject from a low angle. The ground-level perspective makes subjects appear more imposing or dynamic.",
    compatibleGenres: ["action", "sports", "cinematic-narrative", "fashion"],
    compatibleStyles: ["cinematic", "action"],
    compatibleSubjects: ["human", "animal", "vehicle"],
    compatibleScenes: ["action", "sports", "walk-and-talk", "fashion-walk"],
    emotionalEffect: "power, dynamism, intensity, scale",
    defaultSpeed: "medium",
    requiredConditions: ["smooth ground surface", "low-angle framing desirable"],
    incompatibleConditions: ["uneven terrain", "aerial or high-angle scene"],
  },
  {
    id: "vehicle-tracking",
    displayName: "Vehicle tracking",
    referenceCategory: "DOLLY_TRACK",
    family: "follow",
    label: "Vehicle Tracking",
    direction: "forward",
    speedRange: ["fast"],
    execution: "vehicle-mounted",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera mounted on or alongside a moving vehicle",
    endFrame: "variable",
    endFrameRule: "depends on vehicle path; camera maintains vehicle-relative position",
    actionLevel: ["high"],
    description: "Camera mounted on or alongside a moving vehicle. High-speed dynamic tracking.",
    instruction: "Mount the camera on a vehicle (car, motorcycle, boat) using a rig, or use a camera car alongside the subject vehicle. The camera moves at vehicle speed. Used for high-speed chases, travel sequences, or dynamic establishing shots.",
    compatibleGenres: ["action", "travel", "cinematic-narrative", "commercial-ad"],
    compatibleStyles: ["cinematic", "action"],
    compatibleSubjects: ["vehicle", "human"],
    compatibleScenes: ["action", "travel", "chase", "establishing"],
    emotionalEffect: "speed, adrenaline, scale, journey",
    defaultSpeed: "fast",
    requiredConditions: ["moving vehicle", "safe mounting equipment", "open road or track"],
    incompatibleConditions: ["indoor scene", "pedestrian environment", "stationary subject"],
  },
  {
    id: "chase-shot",
    displayName: "Chase shot",
    referenceCategory: "DOLLY_TRACK",
    family: "follow",
    label: "Chase Shot",
    direction: "forward",
    speedRange: ["fast"],
    execution: "handheld-run",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera runs behind or alongside a fleeing subject or pursuer",
    endFrame: "variable",
    endFrameRule: "framing may fluctuate as operator runs; energy and momentum are prioritized over precision",
    actionLevel: ["high"],
    description: "Camera runs behind or alongside a fleeing or pursuing subject. High-energy, immersive urgency.",
    instruction: "The operator runs with the camera, pursuing or keeping pace with a subject. The movement is intentionally rough and bouncy. Framing is secondary to energy and urgency. Creates visceral immersion in a chase.",
    compatibleGenres: ["action", "horror", "sports"],
    compatibleStyles: ["action"],
    compatibleSubjects: ["human"],
    compatibleScenes: ["action", "chase", "escape", "pursuit"],
    emotionalEffect: "urgency, adrenaline, fear, excitement",
    defaultSpeed: "fast",
    requiredConditions: ["running or fast-moving subject", "space to run safely"],
    incompatibleConditions: ["stationary subject", "tripod-only requirement", "slow-paced content"],
  },

  // ── PHYSICAL MOVES ─────────────────────────────────────────────────────
  // dolly-left / dolly-right kept for backward compat — they map to truck
  {
    id: "dolly-left",
    displayName: "Truck left",
    referenceCategory: "PHYSICAL_MOVES",
    family: "physical",
    label: "Truck Left",
    direction: "left",
    speedRange: ["slow", "medium", "fast"],
    execution: "tracked-smooth",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera moves laterally left; subject remains in frame; background slides right",
    endFrame: "shifted-left",
    endFrameRule: "camera position is left of start; subject may be reframed toward the right",
    actionLevel: ["low", "medium", "high"],
    description: "Camera moves laterally to the left (truck). Different from a pan — the camera position changes, not just the angle.",
    instruction: "Move the entire camera rig horizontally to the left on a dolly or slider. Unlike a pan (which rotates), the camera physically translates. The parallax effect reveals depth as foreground moves faster than background.",
    compatibleGenres: ["cinematic-narrative", "travel", "real-estate", "corporate"],
    compatibleStyles: ["cinematic", "commercial", "documentary"],
    compatibleSubjects: ["human", "interior", "landscape", "architecture"],
    compatibleScenes: ["interior", "establishing", "dialogue", "reveal"],
    emotionalEffect: "smoothness, revelation, parallax depth",
    defaultSpeed: "slow",
    requiredConditions: [],
    incompatibleConditions: [],
  },
  {
    id: "dolly-right",
    displayName: "Truck right",
    referenceCategory: "PHYSICAL_MOVES",
    family: "physical",
    label: "Truck Right",
    direction: "right",
    speedRange: ["slow", "medium", "fast"],
    execution: "tracked-smooth",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera moves laterally right; background slides left",
    endFrame: "shifted-right",
    endFrameRule: "camera position is right of start; subject may be reframed toward the left",
    actionLevel: ["low", "medium", "high"],
    description: "Camera moves laterally to the right (truck). Physical translation, not rotation.",
    instruction: "Move the entire camera rig horizontally to the right on a dolly or slider. Physical translation creates natural parallax. Foreground elements move faster than background.",
    compatibleGenres: ["cinematic-narrative", "travel", "real-estate", "corporate"],
    compatibleStyles: ["cinematic", "commercial", "documentary"],
    compatibleSubjects: ["human", "interior", "landscape", "architecture"],
    compatibleScenes: ["interior", "establishing", "dialogue", "reveal"],
    emotionalEffect: "smoothness, revelation, parallax depth",
    defaultSpeed: "slow",
    requiredConditions: [],
    incompatibleConditions: [],
  },
  {
    id: "pedestal-up",
    displayName: "Pedestal up",
    referenceCategory: "PHYSICAL_MOVES",
    family: "jib",
    label: "Pedestal Up",
    direction: "up",
    speedRange: ["slow", "medium"],
    execution: "vertical-lift",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera rises vertically on a pedestal or elevator column",
    endFrame: "higher",
    endFrameRule: "camera ends higher than start; angle tilts down to maintain subject in frame",
    actionLevel: ["low", "medium"],
    description: "Camera rises vertically on a pedestal or column. Unlike a jib, the camera stays level.",
    instruction: "Raise the entire camera rig vertically using a pedestal column or elevator. The camera stays level (unlike a jib which swings). Use to smoothly change height without changing horizontal position.",
    compatibleGenres: ["corporate", "real-estate", "cinematic-narrative", "fashion"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["human", "architecture", "interior"],
    compatibleScenes: ["establishing", "interior", "reveal"],
    emotionalEffect: "elevation, reveal, ascension, authority",
    defaultSpeed: "slow",
    requiredConditions: ["pedestal or vertical lift equipment"],
    incompatibleConditions: [],
  },
  {
    id: "pedestal-down",
    displayName: "Pedestal down",
    referenceCategory: "PHYSICAL_MOVES",
    family: "jib",
    label: "Pedestal Down",
    direction: "down",
    speedRange: ["slow", "medium"],
    execution: "vertical-lift",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera descends vertically while staying level",
    endFrame: "lower",
    endFrameRule: "camera ends lower than start; angle tilts up to maintain subject in frame",
    actionLevel: ["low", "medium"],
    description: "Camera descends vertically on a pedestal. Stays level throughout the move.",
    instruction: "Lower the entire camera rig vertically using a pedestal column. Camera stays level. Use to smoothly descend to a lower vantage point.",
    compatibleGenres: ["corporate", "cinematic-narrative", "fashion", "real-estate"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["human", "architecture", "interior"],
    compatibleScenes: ["reveal", "interior", "establishing"],
    emotionalEffect: "descent, grounding, humility, context",
    defaultSpeed: "slow",
    requiredConditions: ["pedestal or vertical lift equipment"],
    incompatibleConditions: [],
  },
  {
    id: "slider-left",
    displayName: "Slider left",
    referenceCategory: "PHYSICAL_MOVES",
    family: "physical",
    label: "Slider Left",
    direction: "left",
    speedRange: ["slow", "medium"],
    execution: "slider-smooth",
    framing: ["medium", "close-up"],
    framingRule: "medium or close-up — short lateral movement on a tabletop or compact slider",
    endFrame: "shifted-left",
    endFrameRule: "subtle leftward shift; subject reframed slightly right in the composition",
    actionLevel: ["low"],
    description: "Short lateral movement on a compact slider. Adds subtle production value to static scenes.",
    instruction: "Mount camera on a compact slider (1-3 feet travel). Push the camera smoothly to the left. The short travel distance makes this suitable for tabletops, product shots, and intimate scenes where a full dolly is impractical.",
    compatibleGenres: ["food", "product-demo", "unboxing", "tutorial", "fashion"],
    compatibleStyles: ["commercial", "social-media", "cinematic"],
    compatibleSubjects: ["product", "food", "human"],
    compatibleScenes: ["close-up", "product-showcase", "tabletop"],
    emotionalEffect: "refinement, polish, subtle production value",
    defaultSpeed: "slow",
    requiredConditions: ["compact slider", "stable surface"],
    incompatibleConditions: ["wide landscape", "extensive travel needed"],
  },
  {
    id: "slider-right",
    displayName: "Slider right",
    referenceCategory: "PHYSICAL_MOVES",
    family: "physical",
    label: "Slider Right",
    direction: "right",
    speedRange: ["slow", "medium"],
    execution: "slider-smooth",
    framing: ["medium", "close-up"],
    framingRule: "medium or close-up — short lateral movement on a compact slider to the right",
    endFrame: "shifted-right",
    endFrameRule: "subtle rightward shift; subject reframed slightly left in the composition",
    actionLevel: ["low"],
    description: "Short lateral movement on a compact slider to the right. Adds subtle production value.",
    instruction: "Mount camera on a compact slider. Push the camera smoothly to the right. Ideal for product shots and tabletop scenes where full dolly movement is impractical.",
    compatibleGenres: ["food", "product-demo", "unboxing", "tutorial", "fashion"],
    compatibleStyles: ["commercial", "social-media", "cinematic"],
    compatibleSubjects: ["product", "food", "human"],
    compatibleScenes: ["close-up", "product-showcase", "tabletop"],
    emotionalEffect: "refinement, polish, subtle production value",
    defaultSpeed: "slow",
    requiredConditions: ["compact slider", "stable surface"],
    incompatibleConditions: ["wide landscape", "extensive travel needed"],
  },
  {
    id: "push-past",
    displayName: "Push-past / Pass-by",
    referenceCategory: "PHYSICAL_MOVES",
    family: "dolly",
    label: "Push Past",
    direction: "forward-then-past",
    speedRange: ["medium", "fast"],
    execution: "tracked-smooth",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera pushes past a foreground subject, revealing what's behind them",
    endFrame: "past-subject",
    endFrameRule: "subject is now behind the camera or off-frame; background/environment is now the focus",
    actionLevel: ["medium", "high"],
    description: "Camera pushes past a foreground subject or object, revealing the space or subject behind.",
    instruction: "Start with a foreground subject/object between camera and the main subject. Push the camera past the foreground element, revealing the main subject or environment behind it. The foreground element exits frame left/right.",
    compatibleGenres: ["cinematic-narrative", "commercial-ad", "music-video", "travel"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["human", "product", "landscape"],
    compatibleScenes: ["reveal", "establishing", "transition"],
    emotionalEffect: "revelation, discovery, transition, depth",
    defaultSpeed: "medium",
    requiredConditions: ["foreground element to push past", "sufficient depth in scene"],
    incompatibleConditions: ["flat scene lacking depth", "no foreground element"],
  },
  {
    id: "arc-left",
    displayName: "Arc left",
    referenceCategory: "PHYSICAL_MOVES",
    family: "orbit",
    label: "Arc Left",
    direction: "arc-left",
    speedRange: ["slow", "medium"],
    execution: "arc-smooth",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera follows a partial circular path to the left around the subject",
    endFrame: "shifted-side",
    endFrameRule: "camera ends at a new angle left of the starting position; subject angle has shifted",
    actionLevel: ["low", "medium"],
    description: "Camera follows a partial circular arc to the left around the subject. Less than 360 degrees.",
    instruction: "Move the camera in a partial circular arc around the subject, curving to the left. The camera maintains a consistent distance from the subject while changing viewing angle. Covers 45-180 degrees of rotation.",
    compatibleGenres: ["cinematic-narrative", "fashion", "music-video", "product-demo"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["human", "product", "vehicle"],
    compatibleScenes: ["reveal", "product-showcase", "dialogue", "fashion-walk"],
    emotionalEffect: "elegance, revelation, dynamism, exploration",
    defaultSpeed: "slow",
    requiredConditions: ["space to arc around subject"],
    incompatibleConditions: ["subject against a wall", "confined space"],
  },
  {
    id: "arc-right",
    displayName: "Arc right",
    referenceCategory: "PHYSICAL_MOVES",
    family: "orbit",
    label: "Arc Right",
    direction: "arc-right",
    speedRange: ["slow", "medium"],
    execution: "arc-smooth",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera follows a partial circular path to the right around the subject",
    endFrame: "shifted-side",
    endFrameRule: "camera ends at a new angle right of the starting position",
    actionLevel: ["low", "medium"],
    description: "Camera follows a partial circular arc to the right around the subject.",
    instruction: "Move the camera in a partial circular arc around the subject, curving to the right. Maintains consistent distance from the subject. Covers 45-180 degrees of rotation.",
    compatibleGenres: ["cinematic-narrative", "fashion", "music-video", "product-demo"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["human", "product", "vehicle"],
    compatibleScenes: ["reveal", "product-showcase", "dialogue", "fashion-walk"],
    emotionalEffect: "elegance, revelation, dynamism, exploration",
    defaultSpeed: "slow",
    requiredConditions: ["space to arc around subject"],
    incompatibleConditions: ["subject against a wall", "confined space"],
  },
  {
    id: "orbit-clockwise",
    displayName: "Orbit clockwise",
    referenceCategory: "PHYSICAL_MOVES",
    family: "orbit",
    label: "Orbit Clockwise",
    direction: "clockwise",
    speedRange: ["slow", "medium"],
    execution: "arc-smooth",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera completes a full 360-degree clockwise path around the subject",
    endFrame: "same-as-start",
    endFrameRule: "camera returns to its starting position after a full rotation; all angles of subject revealed",
    actionLevel: ["low", "medium"],
    description: "Full 360-degree clockwise orbit around a subject. Reveals every angle.",
    instruction: "Move the camera in a complete circle around the subject in a clockwise direction. Maintain consistent distance and camera angle throughout the rotation. The subject remains centered as the background rotates fully.",
    compatibleGenres: ["music-video", "fashion", "cinematic-narrative", "product-demo", "commercial-ad"],
    compatibleStyles: ["cinematic", "commercial", "social-media"],
    compatibleSubjects: ["human", "product", "vehicle"],
    compatibleScenes: ["reveal", "product-showcase", "fashion-walk", "dramatic-moment"],
    emotionalEffect: "360-degree revelation, drama, completeness, scrutiny",
    defaultSpeed: "slow",
    requiredConditions: ["open space around subject", "clear circular path"],
    incompatibleConditions: ["subject against wall", "confined space", "subject must never change angle"],
  },
  {
    id: "orbit-counterclockwise",
    displayName: "Orbit counterclockwise",
    referenceCategory: "PHYSICAL_MOVES",
    family: "orbit",
    label: "Orbit Counterclockwise",
    direction: "counterclockwise",
    speedRange: ["slow", "medium"],
    execution: "arc-smooth",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera completes a full 360-degree counterclockwise path around the subject",
    endFrame: "same-as-start",
    endFrameRule: "camera returns to its starting position after a full counterclockwise rotation",
    actionLevel: ["low", "medium"],
    description: "Full 360-degree counterclockwise orbit around a subject.",
    instruction: "Move the camera in a complete circle around the subject in a counterclockwise direction. Maintain consistent distance and angle. All angles of the subject are revealed.",
    compatibleGenres: ["music-video", "fashion", "cinematic-narrative", "product-demo"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["human", "product", "vehicle"],
    compatibleScenes: ["reveal", "product-showcase", "fashion-walk", "dramatic-moment"],
    emotionalEffect: "360-degree revelation, drama, completeness, scrutiny",
    defaultSpeed: "slow",
    requiredConditions: ["open space around subject", "clear circular path"],
    incompatibleConditions: ["subject against wall", "confined space", "subject must never change angle"],
  },

  // ── HUMAN CAMERA ───────────────────────────────────────────────────────
  {
    id: "handheld",
    displayName: "Handheld shot",
    referenceCategory: "HUMAN_CAMERA",
    family: "handheld",
    label: "Handheld",
    direction: "variable",
    speedRange: ["slow", "medium", "fast"],
    execution: "handheld-organic",
    framing: ["close-up", "medium", "wide"],
    framingRule: "any framing — camera is carried by operator; movement has human quality",
    endFrame: "variable",
    endFrameRule: "unpredictable; operator steers to intended final composition",
    actionLevel: ["medium", "high"],
    description: "Camera is carried by an operator. Organic, breathing movement with intentional shake.",
    instruction: "Operator holds the camera by hand without a stabilizer. Movement has natural human quality — breathing micro-motion, subtle sway, and intentional reframing. The level of movement ranges from subtle (documentary) to aggressive (action).",
    compatibleGenres: ["documentary", "action", "vlog", "behind-the-scenes", "music-video", "horror"],
    compatibleStyles: ["documentary", "action", "social-media"],
    compatibleSubjects: ["human", "animal"],
    compatibleScenes: ["action", "dialogue", "walk-and-talk", "behind-the-scenes"],
    emotionalEffect: "immediacy, authenticity, urgency, presence",
    defaultSpeed: "medium",
    requiredConditions: [],
    incompatibleConditions: ["shot requires absolute stability", "precision product shot"],
  },
  {
    id: "snorricam",
    displayName: "Body-mounted / Snorricam",
    referenceCategory: "HUMAN_CAMERA",
    family: "human",
    label: "Snorricam",
    direction: "subject-relative",
    speedRange: ["slow", "medium", "fast"],
    execution: "body-mounted",
    framing: ["close-up", "medium"],
    framingRule: "close-up or medium — camera is strapped to the subject's body, facing them",
    endFrame: "variable",
    endFrameRule: "follows the subject's movements; camera shares the subject's every motion",
    actionLevel: ["medium", "high"],
    description: "Camera is strapped to the subject's body, facing back at them. Every step and breath is felt.",
    instruction: "Mount the camera on a rig strapped to the subject's chest or shoulder, pointing back at their face. The camera moves with the subject's body — every step, breath, and turn is transmitted to the frame. Creates intense subjective connection.",
    compatibleGenres: ["cinematic-narrative", "music-video", "vlog", "action"],
    compatibleStyles: ["cinematic", "action"],
    compatibleSubjects: ["human"],
    compatibleScenes: ["walk-and-talk", "action", "confessional", "introspective-moment"],
    emotionalEffect: "extreme intimacy, subjective embodiment, disorientation, rawness",
    defaultSpeed: "medium",
    requiredConditions: ["human subject who will move/walk", "body-mount rig"],
    incompatibleConditions: ["stationary scene", "product shot", "landscape", "animal subject"],
  },

  // ── DRONE / CRANE ──────────────────────────────────────────────────────
  {
    id: "jib-up",
    displayName: "Crane up",
    referenceCategory: "DRONE_CRANE",
    family: "jib",
    label: "Crane Up",
    direction: "up",
    speedRange: ["slow", "medium"],
    execution: "boom-smooth",
    framing: ["wide"],
    framingRule: "wide — camera rises on a crane or jib arm; angle tilts down to maintain view",
    endFrame: "higher-wider",
    endFrameRule: "camera is significantly higher; wider view of the environment below",
    actionLevel: ["low", "medium"],
    description: "Camera rises on a crane or jib arm. Reveals scale and geography from above.",
    instruction: "Mount camera on a jib or crane arm. Raise the arm, lifting the camera. The camera arcs upward and usually tilts down to keep the scene in frame. Creates a majestic reveal of the environment's scale.",
    compatibleGenres: ["cinematic-narrative", "corporate", "real-estate", "travel", "music-video"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["landscape", "architecture", "interior", "group"],
    compatibleScenes: ["establishing", "reveal", "exterior", "interior"],
    emotionalEffect: "scale, grandeur, ascension, overview, majesty",
    defaultSpeed: "slow",
    requiredConditions: ["crane or jib arm", "sufficient overhead clearance"],
    incompatibleConditions: ["low-ceiling interior", "confined space"],
  },
  {
    id: "jib-down",
    displayName: "Crane down",
    referenceCategory: "DRONE_CRANE",
    family: "jib",
    label: "Crane Down",
    direction: "down",
    speedRange: ["slow", "medium"],
    execution: "boom-smooth",
    framing: ["wide", "medium"],
    framingRule: "wide or medium — camera descends on a crane; moves from high to ground level",
    endFrame: "lower-tighter",
    endFrameRule: "camera ends at or near ground level; more intimate, subject-level framing",
    actionLevel: ["low", "medium"],
    description: "Camera descends on a crane or jib arm. Moves from high establishing to ground-level intimacy.",
    instruction: "Lower the jib or crane arm, bringing the camera from a high vantage point down to subject level. The descending movement transitions from overview to intimacy.",
    compatibleGenres: ["cinematic-narrative", "fashion", "music-video", "corporate"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["human", "landscape", "architecture"],
    compatibleScenes: ["establishing", "reveal", "entrance"],
    emotionalEffect: "descent, approach, intimacy, grounding",
    defaultSpeed: "slow",
    requiredConditions: ["crane or jib arm", "sufficient overhead clearance"],
    incompatibleConditions: ["low-ceiling interior"],
  },
  {
    id: "drone-shot",
    displayName: "Drone / Aerial general",
    referenceCategory: "DRONE_CRANE",
    family: "drone",
    label: "Drone Shot",
    direction: "variable",
    speedRange: ["slow", "medium", "fast"],
    execution: "aerial-smooth",
    framing: ["wide", "extreme-wide"],
    framingRule: "wide to extreme wide — elevated perspective, often 50-400 ft altitude",
    endFrame: "variable",
    endFrameRule: "depends on flight path; can end at any point in the aerial route",
    actionLevel: ["low", "medium", "high"],
    description: "Aerial camera movement. Sweeping establishing views, following subjects from above, or dynamic flyovers.",
    instruction: "Fly a drone-mounted camera. Altitude, speed, and path depend on the desired effect. Use for establishing geography, following subjects from above, or creating dramatic aerial reveals.",
    compatibleGenres: ["travel", "real-estate", "nature", "cinematic-narrative", "sports", "commercial-ad"],
    compatibleStyles: ["cinematic", "aerial", "commercial"],
    compatibleSubjects: ["landscape", "architecture", "interior", "vehicle", "group"],
    compatibleScenes: ["establishing", "exterior", "travel", "reveal", "action"],
    emotionalEffect: "scale, freedom, overview, grandeur, majesty",
    defaultSpeed: "medium",
    requiredConditions: ["outdoor or large indoor space", "clearance for flight"],
    incompatibleConditions: ["small interior room", "confined space", "no-fly zone"],
  },
  {
    id: "drone-push-in",
    displayName: "Drone push in",
    referenceCategory: "DRONE_CRANE",
    family: "drone",
    label: "Drone Push In",
    direction: "forward",
    speedRange: ["medium", "fast"],
    execution: "aerial-smooth",
    framing: ["wide", "extreme-wide"],
    framingRule: "wide or extreme-wide start — drone flies forward toward subject or location",
    endFrame: "tighter",
    endFrameRule: "closer view of target; transitions from establishing to specific focus",
    actionLevel: ["medium", "high"],
    description: "Drone flies forward toward a subject or location. From wide establishing to focused approach.",
    instruction: "Fly the drone forward toward the target. Start at a distance with the target small in frame, and approach until the target fills the desired portion of the frame. The speed conveys the energy of the approach.",
    compatibleGenres: ["cinematic-narrative", "travel", "real-estate", "commercial-ad"],
    compatibleStyles: ["cinematic", "aerial"],
    compatibleSubjects: ["landscape", "architecture", "building", "vehicle"],
    compatibleScenes: ["establishing", "approach", "reveal"],
    emotionalEffect: "approach, arrival, focus, destination",
    defaultSpeed: "medium",
    requiredConditions: ["outdoor space", "clear flight path to target"],
    incompatibleConditions: ["small interior room", "indoor scene"],
  },
  {
    id: "drone-pull-back",
    displayName: "Drone pull back",
    referenceCategory: "DRONE_CRANE",
    family: "drone",
    label: "Drone Pull Back",
    direction: "backward",
    speedRange: ["medium", "fast"],
    execution: "aerial-smooth",
    framing: ["close-up", "medium", "wide"],
    framingRule: "close-up or medium start — drone flies backward, revealing the broader environment",
    endFrame: "wider",
    endFrameRule: "significantly wider view; subject becomes smaller in the frame as context expands",
    actionLevel: ["low", "medium"],
    description: "Drone flies backward from a subject, revealing context and scale.",
    instruction: "Start close to the subject and fly the drone backward. The subject gets smaller as the environment expands into view. Classic reveal technique for establishing location context.",
    compatibleGenres: ["cinematic-narrative", "real-estate", "travel", "nature"],
    compatibleStyles: ["cinematic", "aerial"],
    compatibleSubjects: ["landscape", "architecture", "building", "vehicle"],
    compatibleScenes: ["reveal", "establishing", "departure"],
    emotionalEffect: "revelation, context, scale, departure",
    defaultSpeed: "medium",
    requiredConditions: ["outdoor space", "clear backward flight path"],
    incompatibleConditions: ["small interior room", "indoor scene"],
  },
  {
    id: "helicopter-aerial",
    displayName: "Helicopter-style aerial",
    referenceCategory: "DRONE_CRANE",
    family: "drone",
    label: "Helicopter Aerial",
    direction: "variable",
    speedRange: ["fast"],
    execution: "aerial-smooth",
    framing: ["extreme-wide"],
    framingRule: "extreme-wide — high altitude, fast travel, covering large distances",
    endFrame: "variable",
    endFrameRule: "continuous travel; frame evolves as the landscape passes below",
    actionLevel: ["low", "medium"],
    description: "Fast, high-altitude aerial movement covering large distances. Helicopter-style perspective.",
    instruction: "Fly the drone or helicopter at high altitude (200-400+ ft) at speed. Cover large geographical distances. The camera may tilt to look down or forward. Used for epic establishing sequences or travel montages.",
    compatibleGenres: ["travel", "nature", "cinematic-narrative", "commercial-ad", "sports"],
    compatibleStyles: ["cinematic", "aerial"],
    compatibleSubjects: ["landscape", "coastline", "cityscape", "mountain"],
    compatibleScenes: ["establishing", "travel", "epic-reveal", "transition"],
    emotionalEffect: "epic scale, freedom, grandeur, journey",
    defaultSpeed: "fast",
    requiredConditions: ["open outdoor space", "large geographical area", "high altitude clearance"],
    incompatibleConditions: ["urban low-altitude area", "small location", "confined space", "indoor"],
  },

  // ── SPECIALS ───────────────────────────────────────────────────────────
  {
    id: "first-person-view",
    displayName: "First-person view",
    referenceCategory: "SPECIALS",
    family: "special",
    label: "First-Person View",
    direction: "subjective",
    speedRange: ["slow", "medium", "fast"],
    execution: "body-mounted",
    framing: ["close-up"],
    framingRule: "close-up — camera at eye level of the subject, showing exactly what they see",
    endFrame: "variable",
    endFrameRule: "follows the subject's gaze and head movement; frame represents their visual field",
    actionLevel: ["low", "medium", "high"],
    description: "Camera at eye level showing exactly what the subject sees. Subjective perspective.",
    instruction: "Mount camera at eye level of the point-of-view character. All movement corresponds to the character's head and eye movements. The viewer sees exactly what the character would see — no external framing.",
    compatibleGenres: ["cinematic-narrative", "action", "horror", "vlog", "travel"],
    compatibleStyles: ["cinematic", "action", "documentary"],
    compatibleSubjects: ["human"],
    compatibleScenes: ["action", "exploration", "horror", "immersion"],
    emotionalEffect: "total immersion, subjectivity, identification, presence",
    defaultSpeed: "medium",
    requiredConditions: ["human subject whose perspective is shown"],
    incompatibleConditions: ["product shot with no human POV character"],
  },
  {
    id: "tilt-shift",
    displayName: "Tilt-shift miniature view",
    referenceCategory: "SPECIALS",
    family: "special",
    label: "Tilt-Shift",
    direction: "none",
    speedRange: ["slow", "medium"],
    execution: "lens-based",
    framing: ["wide", "extreme-wide"],
    framingRule: "wide or extreme-wide — selective focus creates miniature diorama effect",
    endFrame: "same-as-start",
    endFrameRule: "same composition but with continuous miniature effect",
    actionLevel: ["low"],
    description: "Selective focus and perspective control makes real scenes look like miniature models.",
    instruction: "Use a tilt-shift lens or post-processing effect. Apply selective focus so only a narrow band of the image is in focus. Combine with a high-angle wide shot of a scene to create the illusion of a miniature diorama. Movement should be slow and steady.",
    compatibleGenres: ["travel", "nature", "real-estate"],
    compatibleStyles: ["cinematic"],
    compatibleSubjects: ["landscape", "cityscape", "architecture"],
    compatibleScenes: ["establishing", "exterior"],
    emotionalEffect: "whimsy, playfulness, artificiality, diorama",
    defaultSpeed: "slow",
    requiredConditions: ["high angle", "wide scene", "tilt-shift lens or post-processing"],
    incompatibleConditions: ["close-up", "human subject", "action sequence"],
  },
  {
    id: "infinite-zoom",
    displayName: "Infinite zoom",
    referenceCategory: "SPECIALS",
    family: "special",
    label: "Infinite Zoom",
    direction: "inward",
    speedRange: ["slow", "medium"],
    execution: "post-processing",
    framing: ["any"],
    framingRule: "continuous inward zoom that transitions between scenes or scales; may be digital/post-produced",
    endFrame: "infinitely-tighter",
    endFrameRule: "frame keeps zooming in, potentially transitioning through scenes or scales",
    actionLevel: ["low"],
    description: "Continuous inward zoom effect, often transitioning between scenes or scales.",
    instruction: "Create a continuous inward zoom effect. The zoom transitions through different scenes or scales — from wide shot to macro detail, or from one scene to a related scene. Often achieved in post-production. The zoom should feel seamless and infinite.",
    compatibleGenres: ["cinematic-narrative", "commercial-ad", "music-video"],
    compatibleStyles: ["cinematic"],
    compatibleSubjects: ["any"],
    compatibleScenes: ["transition", "reveal", "conceptual"],
    emotionalEffect: "surreal, conceptual, transformative, hypnotic",
    defaultSpeed: "slow",
    requiredConditions: ["post-production capability", "seamless scene transitions"],
    incompatibleConditions: ["live single-shot", "documentary realism"],
  },
  {
    id: "earth-zoom-out",
    displayName: "Earth zoom out",
    referenceCategory: "SPECIALS",
    family: "special",
    label: "Earth Zoom Out",
    direction: "outward",
    speedRange: ["fast"],
    execution: "post-processing",
    framing: ["extreme-wide"],
    framingRule: "starts on a specific location and zooms out to show Earth or cosmic scale",
    endFrame: "infinitely-wider",
    endFrameRule: "ends at planetary or cosmic scale; geographic starting point is a dot",
    actionLevel: ["low"],
    description: "Zoom out from a specific location to show Earth from space or beyond.",
    instruction: "Start tightly on a geographic location or building. Zoom out rapidly, transitioning through map-like or satellite views, ending at planetary or cosmic scale. The effect is usually post-produced and conveys the scale of the location within the world.",
    compatibleGenres: ["travel", "cinematic-narrative", "commercial-ad", "educational"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["geography", "location", "landscape"],
    compatibleScenes: ["establishing", "transition", "opening"],
    emotionalEffect: "cosmic scale, context, insignificance, wonder",
    defaultSpeed: "fast",
    requiredConditions: ["specific geographic starting point", "post-production capability"],
    incompatibleConditions: ["no geographic starting point", "documentary realism", "indoor scene"],
  },
  {
    id: "time-lapse",
    displayName: "Time-lapse",
    referenceCategory: "SPECIALS",
    family: "special",
    label: "Time-Lapse",
    direction: "none",
    speedRange: ["still"],
    execution: "interval-recording",
    framing: ["wide", "extreme-wide"],
    framingRule: "wide or extreme-wide — fixed camera captures frames at intervals; played back at normal speed",
    endFrame: "same-as-start",
    endFrameRule: "same composition, but time has passed: clouds moved, shadows shifted, people flowed",
    actionLevel: ["low"],
    description: "Frames captured at intervals over time and played at normal speed. Shows slow processes sped up.",
    instruction: "Lock camera on a tripod. Set interval timer to capture frames every 1-30 seconds. Play back the sequence at 24-30 fps to create accelerated motion. Clouds, shadows, traffic, and crowds move at visible speed.",
    compatibleGenres: ["travel", "nature", "real-estate", "educational", "cinematic-narrative"],
    compatibleStyles: ["cinematic", "documentary"],
    compatibleSubjects: ["landscape", "cityscape", "architecture", "sky"],
    compatibleScenes: ["establishing", "transition", "exterior"],
    emotionalEffect: "passage of time, transience, activity, scale",
    defaultSpeed: "still",
    requiredConditions: ["tripod", "intervalometer or post-production capability", "minimum 30 min of real time"],
    incompatibleConditions: ["human subject", "indoor scene with no visible change"],
  },
  {
    id: "pass-through",
    displayName: "Pass-through objects",
    referenceCategory: "SPECIALS",
    family: "special",
    label: "Pass Through",
    direction: "forward",
    speedRange: ["medium", "fast"],
    execution: "tracked-smooth",
    framing: ["close-up", "medium"],
    framingRule: "close-up or medium — camera passes through or between objects in the foreground",
    endFrame: "past-object",
    endFrameRule: "camera has passed through/behind the foreground object; new scene or view beyond",
    actionLevel: ["medium", "high"],
    description: "Camera passes through or between objects in the foreground. Transitions through physical barriers.",
    instruction: "Move the camera forward through or between foreground objects — between leaves, through a doorway, past columns. The foreground object briefly fills the frame before revealing the scene beyond. The transition must have a visible physical barrier to pass through.",
    compatibleGenres: ["cinematic-narrative", "travel", "commercial-ad", "music-video"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["landscape", "architecture", "interior"],
    compatibleScenes: ["transition", "reveal", "establishing"],
    emotionalEffect: "transition, discovery, immersion, depth",
    defaultSpeed: "medium",
    requiredConditions: ["visible barrier or object to pass through", "space beyond the barrier"],
    incompatibleConditions: ["open void with no barrier to pass through", "flat scene with no foreground depth"],
  },

  // ── Legacy movements kept for backward compatibility ───────────────────
  // These are aliases or generic variants that map to specific movements above
  {
    id: "orbit-around",
    displayName: "Orbit (generic)",
    referenceCategory: "PHYSICAL_MOVES",
    family: "orbit",
    label: "Orbit Around",
    direction: "circular",
    speedRange: ["slow", "medium"],
    execution: "arc-smooth",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — camera moves in a circular path; direction unspecified",
    endFrame: "opposite-side",
    endFrameRule: "camera ends on opposite side from start",
    actionLevel: ["low", "medium"],
    description: "Camera moves in a circular path around the subject. Typically clockwise unless specified.",
    instruction: "Move the camera in a full or partial circle around the subject. Default direction is clockwise unless counterclockwise is specified.",
    compatibleGenres: ["music-video", "fashion", "cinematic-narrative", "product-demo", "commercial-ad"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["human", "product", "vehicle"],
    compatibleScenes: ["reveal", "product-showcase", "fashion-walk"],
    emotionalEffect: "360-degree revelation, drama, completeness",
    defaultSpeed: "slow",
    requiredConditions: ["open space around subject"],
    incompatibleConditions: ["subject against wall", "confined space", "subject must never change angle"],
  },
  {
    id: "orbit-arc",
    displayName: "Orbit partial arc (generic)",
    referenceCategory: "PHYSICAL_MOVES",
    family: "orbit",
    label: "Orbit — Partial Arc",
    direction: "arc",
    speedRange: ["slow", "medium"],
    execution: "arc-smooth",
    framing: ["medium", "wide"],
    framingRule: "medium or wide — partial circular arc; less than 360 degrees; direction unspecified",
    endFrame: "shifted-side",
    endFrameRule: "camera ends at a new angle, shifted from the start",
    actionLevel: ["low", "medium"],
    description: "Partial circular arc around the subject. Less than a full rotation.",
    instruction: "Follow a partial circular path around the subject. Covers 45-180 degrees of rotation. Direction depends on scene flow.",
    compatibleGenres: ["cinematic-narrative", "fashion", "music-video", "product-demo"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["human", "product", "vehicle"],
    compatibleScenes: ["reveal", "product-showcase", "dialogue"],
    emotionalEffect: "elegance, dynamism, exploration, partial reveal",
    defaultSpeed: "slow",
    requiredConditions: ["space to arc around subject"],
    incompatibleConditions: ["confined space"],
  },
  {
    id: "roll-360",
    displayName: "360 roll",
    referenceCategory: "PHYSICAL_MOVES",
    family: "roll",
    label: "360 Roll",
    direction: "clockwise",
    speedRange: ["medium", "fast"],
    execution: "rotational",
    framing: ["medium", "close-up"],
    framingRule: "medium or close-up — camera rolls 360 degrees around its lens axis",
    endFrame: "same-as-start",
    endFrameRule: "frame returns to original orientation after full rotation",
    actionLevel: ["medium", "high"],
    description: "Camera rolls 360 degrees around its lens axis. Disorienting, stylized, or transition effect.",
    instruction: "Rotate the camera 360 degrees around the lens axis (Dutch angle rotation). The horizon spins fully. Often used as a transition or for disorienting effect.",
    compatibleGenres: ["music-video", "action", "commercial-ad", "horror"],
    compatibleStyles: ["social-media", "action", "cinematic"],
    compatibleSubjects: ["human", "landscape"],
    compatibleScenes: ["transition", "action", "dramatic-moment"],
    emotionalEffect: "disorientation, stylized, energy, spin",
    defaultSpeed: "medium",
    requiredConditions: [],
    incompatibleConditions: ["motion-sensitive viewer", "documentary realism"],
  },
  {
    id: "follow",
    displayName: "Follow (generic)",
    referenceCategory: "DOLLY_TRACK",
    family: "follow",
    label: "Camera Follows",
    direction: "forward",
    speedRange: ["slow", "medium", "fast"],
    execution: "tracked-smooth",
    framing: ["medium", "close-up"],
    framingRule: "medium or close-up — camera moves alongside or behind a moving subject",
    endFrame: "same-distance",
    endFrameRule: "camera maintains consistent distance from subject throughout",
    actionLevel: ["medium", "high"],
    description: "Camera moves alongside or behind a subject, maintaining consistent framing and distance.",
    instruction: "Move the camera alongside or behind a moving subject. Maintain consistent distance and framing. The subject moves through the environment while the camera flows with them.",
    compatibleGenres: ["action", "travel", "vlog", "sports", "cinematic-narrative"],
    compatibleStyles: ["cinematic", "documentary", "action"],
    compatibleSubjects: ["human", "animal", "vehicle"],
    compatibleScenes: ["action", "walk-and-talk", "travel", "sports"],
    emotionalEffect: "momentum, journey, immersion, continuity",
    defaultSpeed: "medium",
    requiredConditions: ["moving subject"],
    incompatibleConditions: ["stationary subject"],
  },
  {
    id: "follow-lead",
    displayName: "Reverse tracking (legacy)",
    referenceCategory: "DOLLY_TRACK",
    family: "follow",
    label: "Camera Follows — Leading",
    direction: "backward",
    speedRange: ["slow", "medium", "fast"],
    execution: "tracked-smooth",
    framing: ["medium", "close-up"],
    framingRule: "medium or close-up — camera moves backward ahead of subject, facing them",
    endFrame: "same-distance",
    endFrameRule: "camera maintains consistent distance ahead of the subject",
    actionLevel: ["medium", "high"],
    description: "Camera moves backward ahead of a subject, facing them as they walk forward.",
    instruction: "Walk backward ahead of the subject while facing them. The camera leads, the subject follows toward camera.",
    compatibleGenres: ["cinematic-narrative", "vlog", "walk-and-talk"],
    compatibleStyles: ["cinematic", "documentary"],
    compatibleSubjects: ["human"],
    compatibleScenes: ["walk-and-talk", "dialogue"],
    emotionalEffect: "engagement, conversation, leading, journey",
    defaultSpeed: "medium",
    requiredConditions: ["human subject walking forward"],
    incompatibleConditions: ["stationary subject", "unsafe backward path"],
  },
  {
    id: "dolly-zoom",
    displayName: "Dolly zoom / Vertigo",
    referenceCategory: "ZOOM_LENS",
    family: "complex",
    label: "Dolly Zoom / Vertigo",
    direction: "contradictory",
    speedRange: ["medium"],
    execution: "combined",
    framing: ["medium", "close-up"],
    framingRule: "medium or close-up — camera dollies back while zooming in (or vice versa); subject stays same size",
    endFrame: "same-as-start",
    endFrameRule: "subject is same size as start, but background perspective is distorted",
    actionLevel: ["medium"],
    description: "Camera dollies backward while zooming in (or vice versa). Subject stays same size while background distorts.",
    instruction: "Simultaneously dolly backward and zoom in (or dolly forward and zoom out). The subject remains the same size in frame while the background perspective warps. Creates disorientation, vertigo, or revelation.",
    compatibleGenres: ["cinematic-narrative", "suspense", "horror", "music-video"],
    compatibleStyles: ["cinematic"],
    compatibleSubjects: ["human", "landscape"],
    compatibleScenes: ["dramatic-moment", "reveal", "suspense"],
    emotionalEffect: "vertigo, disorientation, revelation, psychological intensity",
    defaultSpeed: "medium",
    requiredConditions: ["space to dolly backward or forward"],
    incompatibleConditions: [],
  },
  {
    id: "whip-pan",
    displayName: "Whip pan (generic)",
    referenceCategory: "PAN_TILT",
    family: "pan",
    label: "Whip Pan",
    direction: "left-right",
    speedRange: ["very-fast"],
    execution: "tripod-fast",
    framing: ["wide", "medium"],
    framingRule: "wide or medium — motion blur intended; used as transition; direction unspecified",
    endFrame: "different-scene",
    endFrameRule: "lands on a different subject or scene",
    actionLevel: ["high"],
    description: "Extremely fast horizontal pan. Direction unspecified. Used as transition.",
    instruction: "Execute an extremely fast horizontal pan in either direction. Motion blurs the frame. Used as a dynamic transition between scenes.",
    compatibleGenres: ["music-video", "action", "social-media-reel", "tiktok"],
    compatibleStyles: ["social-media", "action"],
    compatibleSubjects: ["human", "landscape"],
    compatibleScenes: ["transition", "action"],
    emotionalEffect: "energy, transition, speed",
    defaultSpeed: "very-fast",
    requiredConditions: ["transition between scenes"],
    incompatibleConditions: ["single continuous scene"],
  },
  {
    id: "slide-pan",
    displayName: "Slide pan (parallax)",
    referenceCategory: "PHYSICAL_MOVES",
    family: "complex",
    label: "Slide Pan",
    direction: "horizontal",
    speedRange: ["slow", "medium"],
    execution: "slide-smooth",
    framing: ["wide"],
    framingRule: "wide — camera dollies horizontally while panning to keep subject in frame; parallax effect",
    endFrame: "shifted-horizontal",
    endFrameRule: "camera has moved horizontally; subject remains centered; background perspective has shifted",
    actionLevel: ["low", "medium"],
    description: "Camera moves horizontally (dolly) while panning to keep subject in frame. Creates parallax effect.",
    instruction: "Track the camera laterally while simultaneously panning to keep the subject centered. The foreground and background move at different rates, creating a parallax depth effect.",
    compatibleGenres: ["cinematic-narrative", "portfolio", "fashion", "real-estate"],
    compatibleStyles: ["cinematic", "commercial"],
    compatibleSubjects: ["human", "architecture", "interior"],
    compatibleScenes: ["interior", "reveal", "establishing"],
    emotionalEffect: "depth, parallax, dimension, smoothness",
    defaultSpeed: "slow",
    requiredConditions: ["space for lateral movement"],
    incompatibleConditions: [],
  },
];

// ── Legacy alias for backward compatibility ────────────────────────────────
// code that imports `MOVEMENTS` and expects certain IDs to exist still works.

// ── Movement lookup ──────────────────────────────────────────────────────────

export function getMovement(id) {
  return MOVEMENTS.find((m) => m.id === id);
}

export function getMovementsByFamily(family) {
  return MOVEMENTS.filter((m) => m.family === family);
}

export function getMovementsByCategory(category) {
  return MOVEMENTS.filter((m) => m.referenceCategory === category);
}

// ── Genre → recommended movement mapping ────────────────────────────────────

const GENRE_MOVEMENT_MAP = {
  "talking-head":          ["static", "static-handheld", "zoom-in", "slow-zoom-in"],
  "interview":             ["static", "static-handheld", "dolly-in", "slow-zoom-in"],
  "testimonial":           ["static", "static-handheld", "dolly-in", "slow-zoom-in"],
  "educational":           ["static", "pan-left", "pan-right", "zoom-in", "slow-zoom-in"],
  "tutorial":              ["static", "zoom-in", "dolly-in", "slow-zoom-in", "slider-left", "slider-right"],
  "unboxing":              ["static", "handheld", "orbit-around", "orbit-clockwise", "slider-left", "slider-right"],
  "product-demo":          ["orbit-around", "orbit-clockwise", "dolly-in", "handheld", "arc-left", "arc-right", "slider-left", "slider-right"],
  "vlog":                  ["handheld", "follow", "static-handheld", "reverse-tracking", "snorricam"],
  "travel":                ["drone-shot", "drone-push-in", "drone-pull-back", "pan-left", "pan-right", "handheld", "time-lapse", "helicopter-aerial"],
  "cinematic-narrative":   ["dolly-in", "dolly-out", "orbit-around", "orbit-clockwise", "jib-up", "jib-down", "arc-left", "arc-right", "tracking-shot", "push-past"],
  "action":                ["handheld", "handheld-run", "chase-shot", "tracking-shot", "follow", "vehicle-tracking", "low-tracking", "crash-zoom-in", "whip-pan-left", "whip-pan-right", "first-person-view"],
  "suspense":              ["dolly-in", "zoom-in", "slow-zoom-in", "handheld", "static", "dolly-zoom", "push-past"],
  "documentary":           ["static", "pan-left", "pan-right", "handheld", "static-handheld", "tracking-shot", "follow-over-shoulder"],
  "music-video":           ["orbit-around", "orbit-clockwise", "orbit-counterclockwise", "roll-360", "handheld", "dolly-zoom", "whip-pan-left", "whip-pan-right", "crash-zoom-in", "helicopter-aerial", "infinite-zoom"],
  "fashion":               ["orbit-around", "orbit-clockwise", "static", "dolly-in", "slow-zoom-in", "arc-left", "arc-right", "crane-up", "crane-down"],
  "food":                  ["dolly-in", "zoom-in", "slow-zoom-in", "orbit-around", "static", "slider-left", "slider-right"],
  "sports":                ["tracking-shot", "chase-shot", "handheld-run", "pan-left", "pan-right", "drone-shot", "drone-push-in", "low-tracking", "vehicle-tracking", "fast-zoom-in"],
  "corporate":             ["static", "dolly-in", "jib-up", "crane-up", "pan-left", "pedestal-up", "pedestal-down"],
  "real-estate":           ["dolly-out", "drone-shot", "drone-push-in", "jib-up", "crane-up", "pan-left", "pan-right", "time-lapse", "slider-left", "slider-right"],
  "nature":                ["drone-shot", "drone-pull-back", "drone-push-in", "pan-left", "pan-right", "time-lapse", "helicopter-aerial", "tilt-shift"],
  "behind-the-scenes":     ["handheld", "static-handheld", "follow", "snorricam"],
  "commercial-ad":         ["orbit-around", "orbit-clockwise", "dolly-in", "static", "dolly-zoom", "push-past", "crane-up", "infinite-zoom"],
  "social-media-reel":     ["handheld", "zoom-in", "fast-zoom-in", "zoom-out", "follow", "whip-pan-left", "whip-pan-right", "chase-shot", "first-person-view"],
  "instagram-story":       ["static", "zoom-in", "handheld", "fast-zoom-in"],
  "tiktok":                ["handheld", "zoom-in", "fast-zoom-in", "crash-zoom-in", "whip-pan-left", "whip-pan-right", "follow", "first-person-view"],
  "horror":                ["handheld", "dolly-in", "slow-zoom-in", "first-person-view", "dolly-zoom", "snorricam", "crash-zoom-in"],
  "comedy":                ["fast-zoom-in", "crash-zoom-in", "crash-zoom-out", "zoom-out", "fast-zoom-out", "handheld", "whip-pan-left", "whip-pan-right"],
  "drama":                 ["dolly-in", "slow-zoom-in", "static", "follow-over-shoulder", "arc-left", "arc-right", "pedestal-up", "pedestal-down"],
  "reaction":              ["fast-zoom-in", "crash-zoom-in", "zoom-in", "static", "handheld"],
  "luxury":                ["orbit-around", "orbit-clockwise", "slow-zoom-in", "dolly-in", "static", "crane-up", "arc-left", "arc-right"],
};

// ── Scene type → movement hints ─────────────────────────────────────────────

const SCENE_MOVEMENT_HINTS = {
  "establishing":  ["drone-shot", "drone-pull-back", "jib-up", "crane-up", "pan-left", "pan-right", "dolly-out", "helicopter-aerial", "time-lapse"],
  "interior":      ["dolly-in", "static", "pan-left", "pan-right", "zoom-in", "pedestal-up", "pedestal-down", "slider-left", "slider-right", "crane-down"],
  "exterior":      ["drone-shot", "drone-push-in", "pan-left", "pan-right", "dolly-out", "time-lapse", "helicopter-aerial"],
  "close-up":      ["static", "zoom-in", "slow-zoom-in", "dolly-in", "handheld", "slider-left", "slider-right"],
  "action":        ["handheld", "chase-shot", "tracking-shot", "follow", "handheld-run", "whip-pan-left", "whip-pan-right", "crash-zoom-in", "first-person-view", "low-tracking"],
  "dialogue":      ["static", "static-handheld", "dolly-in", "pan-left", "pan-right", "follow-over-shoulder", "reverse-tracking", "arc-left", "arc-right"],
  "reveal":        ["dolly-out", "zoom-out", "jib-up", "crane-up", "tilt-up", "push-past", "drone-pull-back"],
  "transition":    ["whip-pan-left", "whip-pan-right", "zoom-in", "zoom-out", "roll-360", "crash-zoom-in", "pass-through", "infinite-zoom", "fast-zoom-out"],
  "walk-and-talk": ["tracking-shot", "follow-over-shoulder", "reverse-tracking", "follow", "side-tracking", "dolly-left", "dolly-right"],
  "product-showcase": ["orbit-clockwise", "orbit-around", "arc-left", "arc-right", "slider-left", "slider-right", "dolly-in", "static", "slow-zoom-in"],
  "horror-reveal": ["dolly-in", "slow-zoom-in", "first-person-view", "handheld", "crash-zoom-in", "snorricam"],
  "chase":         ["chase-shot", "handheld-run", "tracking-shot", "vehicle-tracking", "first-person-view", "low-tracking"],
  "fashion-walk":  ["tracking-shot", "side-tracking", "low-tracking", "reverse-tracking", "arc-left", "arc-right", "slow-zoom-in"],
  "interview":     ["static", "static-handheld", "dolly-in", "slow-zoom-in", "follow-over-shoulder"],
};

// ── Style → movement modifiers ──────────────────────────────────────────────

const STYLE_MOVEMENT_PREFERENCE = {
  "cinematic":    { families: ["dolly", "orbit", "jib", "static", "physical"], speedPref: "slow" },
  "documentary":  { families: ["handheld", "static", "pan", "tilt", "follow"], speedPref: "medium" },
  "social-media": { families: ["handheld", "zoom", "follow", "complex", "special"], speedPref: "fast" },
  "commercial":   { families: ["orbit", "dolly", "static", "jib", "physical"], speedPref: "slow" },
  "aerial":       { families: ["drone"], speedPref: "medium" },
  "action":       { families: ["handheld", "follow", "complex", "dolly", "special"], speedPref: "fast" },
  "vlog":         { families: ["handheld", "follow", "human"], speedPref: "medium" },
};

// ── Action level → movement energy mapping ──────────────────────────────────

const ACTION_ENERGY_MAP = {
  "low":    ["static", "static-handheld", "pan-left", "pan-right", "tilt-up", "tilt-down", "dolly-in", "dolly-out", "jib-up", "jib-down", "zoom-in", "zoom-out", "slow-zoom-in", "slow-zoom-out", "orbit-around", "orbit-arc", "arc-left", "arc-right", "slider-left", "slider-right", "pedestal-up", "pedestal-down", "slide-pan", "time-lapse", "tilt-shift", "crane-up", "crane-down"],
  "medium": ["static", "static-handheld", "handheld", "tracking-shot", "follow", "follow-over-shoulder", "dolly-left", "dolly-right", "orbit-around", "orbit-clockwise", "orbit-counterclockwise", "orbit-arc", "pan-left", "pan-right", "dolly-zoom", "drone-shot", "drone-push-in", "drone-pull-back", "arc-left", "arc-right", "reverse-tracking", "side-tracking", "pass-through", "infinite-zoom", "fast-zoom-in", "fast-zoom-out", "first-person-view"],
  "high":   ["handheld", "handheld-run", "chase-shot", "tracking-shot", "follow", "whip-pan-left", "whip-pan-right", "roll-360", "drone-shot", "dolly-zoom", "vehicle-tracking", "low-tracking", "crash-zoom-in", "crash-zoom-out", "fast-zoom-in", "first-person-view", "snorricam", "helicopter-aerial"],
};

// ── Platform → preferred movement bias ──────────────────────────────────────

const PLATFORM_MOVEMENT_BIAS = {
  "instagram-reel":     { preferred: ["handheld", "zoom-in", "fast-zoom-in", "follow", "whip-pan-left", "whip-pan-right", "first-person-view"], note: "vertical, energetic, fast-paced" },
  "instagram-story":    { preferred: ["static", "zoom-in", "handheld", "fast-zoom-in"], note: "vertical, casual, direct" },
  "tiktok":             { preferred: ["handheld", "zoom-in", "fast-zoom-in", "crash-zoom-in", "whip-pan-left", "whip-pan-right", "follow", "first-person-view"], note: "vertical, trend-driven, high-energy" },
  "youtube":            { preferred: ["static", "dolly-in", "pan-left", "pan-right", "tracking-shot", "follow", "slow-zoom-in"], note: "horizontal, varied pacing" },
  "youtube-shorts":     { preferred: ["handheld", "zoom-in", "fast-zoom-in", "follow", "first-person-view"], note: "vertical, short attention span" },
  "linkedin":           { preferred: ["static", "static-handheld", "dolly-in"], note: "professional, grounded, minimal camera movement" },
  "facebook":           { preferred: ["static", "handheld", "zoom-in"], note: "casual, mix of vertical and horizontal" },
  "twitter-x":          { preferred: ["static", "handheld", "zoom-in"], note: "short-form, direct" },
  "website":            { preferred: ["static", "dolly-in", "orbit-around", "orbit-clockwise"], note: "polished, brand-forward" },
};

// ── Incompatible movement pairs ─────────────────────────────────────────────

const INCOMPATIBLE_MOVEMENT_PAIRS = [
  ["static", "handheld"],
  ["static", "static-handheld"],
  ["static", "handheld-run"],
  ["static", "follow"],
  ["static", "tracking-shot"],
  ["static", "chase-shot"],
  ["static", "dolly-in"],
  ["static", "dolly-out"],
  ["zoom-in", "dolly-out"],
  ["zoom-out", "dolly-in"],
  ["slow-zoom-in", "fast-zoom-out"],
  ["slow-zoom-out", "fast-zoom-in"],
  ["tilt-up", "tilt-down"],
  ["pan-left", "pan-right"],
  ["pan-left", "whip-pan-right"],
  ["pan-right", "whip-pan-left"],
  ["dolly-left", "dolly-right"],
  ["jib-up", "jib-down"],
  ["crane-up", "crane-down"],
  ["pedestal-up", "pedestal-down"],
  ["orbit-clockwise", "orbit-counterclockwise"],
  ["arc-left", "arc-right"],
  ["drone-shot", "static"],
  ["drone-shot", "pedestal-up"],
  ["snorricam", "tripod-locked"],
  ["time-lapse", "handheld"],
  ["crash-zoom-in", "slow-zoom-out"],
  ["crash-zoom-out", "slow-zoom-in"],
];

export function areMovementsCompatible(idA, idB) {
  if (idA === idB) return true;
  return !INCOMPATIBLE_MOVEMENT_PAIRS.some(
    ([a, b]) => (a === idA && b === idB) || (a === idB && b === idA)
  );
}

// ── Runtime incompatibility validation ──────────────────────────────────────
// Validates a movement against scene context (indoor/outdoor, subject type, etc.)

export function validateMovementContext(movement, context = {}) {
  const {
    environment = "",
    subjectType = "",
    hasBarrier = false,
    hasGeographicStart = false,
    hasMovingSubject = false,
  } = context;

  const issues = [];

  // Drone shot inside a small room
  if (
    (movement.id === "drone-shot" || movement.id === "drone-push-in" || movement.id === "drone-pull-back" || movement.id === "helicopter-aerial") &&
    (environment === "indoor" || environment === "small-room")
  ) {
    issues.push(`Drone/crane movement "${movement.displayName}" requires open outdoor or large indoor space — cannot execute in "${environment}"`);
  }

  // Orbit + subject must never change angle
  if (
    (movement.id === "orbit-clockwise" || movement.id === "orbit-counterclockwise" || movement.id === "orbit-around") &&
    context.subjectMustNotChangeAngle
  ) {
    issues.push(`Orbit movement "${movement.displayName}" changes the viewing angle of the subject — incompatible with a requirement that the subject must never change angle`);
  }

  // Zoom in ending wider than start
  if (
    (movement.id === "zoom-in" || movement.id === "slow-zoom-in" || movement.id === "fast-zoom-in" || movement.id === "crash-zoom-in") &&
    context.endFrameWider
  ) {
    issues.push(`Zoom-in movement "${movement.displayName}" ends tighter — cannot end wider than starting frame`);
  }

  // Chase shot for motionless product
  if (
    (movement.id === "chase-shot" || movement.id === "handheld-run") &&
    subjectType === "product" &&
    !hasMovingSubject
  ) {
    issues.push(`Chase/high-energy movement "${movement.displayName}" requires a moving subject — incompatible with a stationary product`);
  }

  // Pass-through without visible barrier
  if (movement.id === "pass-through" && !hasBarrier) {
    issues.push(`Pass-through movement requires a visible physical barrier or object to pass through — none specified in scene`);
  }

  // Earth zoom out without geographic starting point
  if (movement.id === "earth-zoom-out" && !hasGeographicStart) {
    issues.push(`Earth zoom out requires a specific geographic starting point — none specified`);
  }

  // Snorricam without moving human subject
  if (movement.id === "snorricam" && subjectType !== "human") {
    issues.push(`Snorricam (body-mounted) requires a human subject who will move — current subject type is "${subjectType}"`);
  }

  // Time-lapse with handheld
  if (movement.id === "time-lapse" && context.cameraStability === "handheld") {
    issues.push(`Time-lapse requires a locked-down tripod — incompatible with handheld camera`);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// ── UI options ──────────────────────────────────────────────────────────────

export function getMovementOptions() {
  return MOVEMENTS.map((m) => ({
    value: m.id,
    label: m.label,
    displayName: m.displayName,
    category: m.referenceCategory,
    family: m.family,
    description: m.description,
    emotionalEffect: m.emotionalEffect,
  }));
}

export function getMovementOptionsByCategory() {
  const byCategory = {};
  for (const cat of REFERENCE_CATEGORIES) {
    byCategory[cat] = getMovementsByCategory(cat).map((m) => ({
      value: m.id,
      label: m.label,
      displayName: m.displayName,
    }));
  }
  return byCategory;
}

export function getMovementOptionsByFamily() {
  const byFamily = {};
  for (const familyKey of Object.keys(MOVEMENT_FAMILIES)) {
    byFamily[familyKey] = getMovementsByFamily(familyKey).map((m) => ({
      value: m.id,
      label: m.label,
      displayName: m.displayName,
    }));
  }
  return byFamily;
}

// ── Default state ───────────────────────────────────────────────────────────

export function defaultCameraMovementState() {
  return { value: "auto", userExplicit: false };
}

// ── Deterministic movement selector ─────────────────────────────────────────
// Priority order:
//   1. Valid explicit user movement
//   2. Explicit direction/instruction (not implemented as separate param yet)
//   3. Genre → movement mapping
//   4. Style → preferred families
//   5. Scene compatibility
//   6. Safe fallback

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function deterministicPick(candidates, seed) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const idx = hashString(seed) % candidates.length;
  return candidates[idx];
}

export function selectCameraMovement(context = {}) {
  const {
    genre = "",
    style = "",
    sceneDescription = "",
    platform = "",
    actionLevel = "medium",
    userMovement = null,
    sceneType = "",
    storyboardIndex = 0,
    environment = "",
    subjectType = "",
  } = context;

  // ── Priority 1: User explicit movement ────────────────────────────────
  if (userMovement && userMovement !== "auto" && userMovement !== "Auto") {
    const movement = getMovement(userMovement);
    if (movement) {
      // Validate against context
      const validation = validateMovementContext(movement, {
        environment,
        subjectType,
        hasBarrier: context.hasBarrier,
        hasGeographicStart: context.hasGeographicStart,
        hasMovingSubject: context.hasMovingSubject,
        subjectMustNotChangeAngle: context.subjectMustNotChangeAngle,
        endFrameWider: context.endFrameWider,
        cameraStability: context.cameraStability,
      });

      return {
        id: movement.id,
        label: movement.label,
        displayName: movement.displayName,
        referenceCategory: movement.referenceCategory,
        family: movement.family,
        direction: movement.direction,
        speed: movement.defaultSpeed || movement.speedRange[0] || "medium",
        execution: movement.execution,
        framing: movement.framingRule || movement.framing[0] || "medium",
        endFrame: movement.endFrameRule || movement.endFrame,
        description: movement.description,
        instruction: movement.instruction,
        emotionalEffect: movement.emotionalEffect,
        adapted: false,
        source: "user-explicit",
        validationIssues: validation.valid ? [] : validation.issues,
        contextValid: validation.valid,
      };
    }
  }

  // ── Build candidate pool ──────────────────────────────────────────────
  const candidates = new Set();
  const seedParts = [genre, style, sceneDescription, platform, actionLevel, String(storyboardIndex)];

  // Priority 3: Genre
  const genreSlug = genre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "social-media-reel";
  const genreMoves = GENRE_MOVEMENT_MAP[genreSlug];
  if (genreMoves) {
    for (const m of genreMoves) candidates.add(m);
  }

  // Priority 5: Scene type
  const sceneTypeSlug = sceneType.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const sceneMoves = SCENE_MOVEMENT_HINTS[sceneTypeSlug];
  if (sceneMoves) {
    for (const m of sceneMoves) candidates.add(m);
  }

  // Priority 4: Style
  const styleSlug = style.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "social-media";
  const stylePref = STYLE_MOVEMENT_PREFERENCE[styleSlug];
  if (stylePref) {
    const familyMoves = MOVEMENTS.filter((m) => stylePref.families.includes(m.family));
    for (const m of familyMoves) candidates.add(m.id);
  }

  // Platform
  const platformSlug = platform.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const platPref = PLATFORM_MOVEMENT_BIAS[platformSlug];
  if (platPref) {
    for (const m of platPref.preferred) candidates.add(m);
  }

  // Action level
  const actionSlug = actionLevel.toLowerCase();
  const actionMoves = ACTION_ENERGY_MAP[actionSlug];
  if (actionMoves) {
    for (const m of actionMoves) candidates.add(m);
  }

  // ── Fallback ──────────────────────────────────────────────────────────
  if (candidates.size === 0) {
    const defaults = ["static", "handheld", "dolly-in", "pan-left", "zoom-in"];
    for (const m of defaults) candidates.add(m);
  }

  // Filter by action level energy
  const energyFiltered = [...candidates].filter((id) => {
    const mov = getMovement(id);
    if (!mov) return false;
    return mov.actionLevel ? mov.actionLevel.includes(actionSlug) : true;
  });

  const finalCandidates = energyFiltered.length > 0 ? energyFiltered : [...candidates];
  const seed = seedParts.filter(Boolean).join("::");
  const chosenId = deterministicPick(finalCandidates, seed);

  if (!chosenId) {
    return {
      id: "static",
      label: "Static",
      displayName: "Static shot",
      referenceCategory: "PAN_TILT",
      family: "static",
      direction: "none",
      speed: "still",
      execution: "tripod-locked",
      framing: "wide, medium, or close-up",
      endFrame: "same-as-start",
      description: "Camera is locked on a tripod with no movement.",
      adapted: false,
      source: "fallback",
    };
  }

  const movement = getMovement(chosenId);
  let speedPref = stylePref?.speedPref || "medium";

  // Use the movement's defaultSpeed if available
  if (movement.defaultSpeed) {
    speedPref = movement.defaultSpeed;
  }

  const speed = movement.speedRange.includes(speedPref) ? speedPref : movement.speedRange[0] || "medium";

  return {
    id: movement.id,
    label: movement.label,
    displayName: movement.displayName,
    referenceCategory: movement.referenceCategory,
    family: movement.family,
    direction: movement.direction,
    speed,
    execution: movement.execution,
    framing: movement.framingRule || movement.framing[0] || "medium",
    endFrame: movement.endFrameRule || movement.endFrame,
    description: movement.description,
    instruction: movement.instruction,
    emotionalEffect: movement.emotionalEffect,
    adapted: false,
    source: "inferred",
  };
}

// ── Storyboard multi-shot variation ─────────────────────────────────────────

export function selectStoryboardMovements(context = {}, shotCount = 3) {
  const shots = [];
  const used = new Set();

  for (let i = 0; i < shotCount; i++) {
    const shot = selectCameraMovement({ ...context, storyboardIndex: i });
    used.add(shot.id);
    shots.push(shot);
  }

  // Force variation when all shots are identical
  if (used.size === 1 && shotCount > 1) {
    const movement = getMovement(shots[0].id);
    if (movement) {
      const sameFamily = MOVEMENTS.filter(
        (m) => m.family === movement.family && m.id !== movement.id
      );
      const sameCat = MOVEMENTS.filter(
        (m) => m.referenceCategory === movement.referenceCategory && m.id !== movement.id
      );
      const alternates = sameFamily.length > 0 ? sameFamily : sameCat;
      for (let i = 1; i < shots.length && i - 1 < alternates.length; i++) {
        const alt = alternates[i - 1];
        shots[i] = {
          id: alt.id,
          label: alt.label,
          displayName: alt.displayName,
          referenceCategory: alt.referenceCategory,
          family: alt.family,
          direction: alt.direction,
          speed: alt.defaultSpeed || alt.speedRange[0] || "medium",
          execution: alt.execution,
          framing: alt.framingRule || alt.framing[0] || "medium",
          endFrame: alt.endFrameRule || alt.endFrame,
          description: alt.description,
          adapted: true,
          source: "variation",
        };
      }
    }
  }

  return shots;
}

// ── Prompt formatters ────────────────────────────────────────────────────────

export function formatCameraMovement(movement, includeSpeed = true) {
  if (!movement) return "";

  const parts = [`Camera movement: ${movement.label}`];

  if (movement.direction && movement.direction !== "none" && movement.direction !== "variable") {
    parts.push(`Direction: ${movement.direction}`);
  }

  if (includeSpeed && movement.speed && movement.speed !== "still") {
    parts.push(`Speed: ${movement.speed}`);
  }

  if (movement.execution) {
    parts.push(`Execution: ${movement.execution}`);
  }

  if (movement.framing) {
    parts.push(`Framing: ${movement.framing}`);
  }

  if (movement.endFrame) {
    parts.push(`End frame: ${movement.endFrame}`);
  }

  return parts.join("\n");
}

// ── Full prompt block ───────────────────────────────────────────────────────
// Produces the complete CAMERA MOVEMENT section with all six concepts.

export function buildCameraMovementBlock(movement, options = {}) {
  const { includeSpeed = true, includeDescription = false, compact = false } = options;

  if (!movement) return "";

  if (compact) {
    // Single-paragraph structured format for models that require compact input
    const parts = [`CAMERA MOVEMENT: ${movement.label}`];
    if (movement.direction && movement.direction !== "none" && movement.direction !== "variable") {
      parts.push(`DIRECTION: ${movement.direction}`);
    }
    if (includeSpeed && movement.speed && movement.speed !== "still") {
      parts.push(`SPEED: ${movement.speed}`);
    }
    parts.push(`EXECUTION: ${movement.execution}`);
    parts.push(`FRAMING: ${movement.framing}`);
    parts.push(`END FRAME: ${movement.endFrame}`);
    return parts.join(" | ");
  }

  const lines = ["=== CAMERA MOVEMENT ==="];
  lines.push(`Movement: ${movement.label}`);
  if (movement.displayName && movement.displayName !== movement.label) {
    lines.push(`Canonical: ${movement.displayName}`);
  }

  if (movement.direction && movement.direction !== "none" && movement.direction !== "variable") {
    lines.push(`Direction: ${movement.direction}`);
  }

  if (includeSpeed && movement.speed && movement.speed !== "still") {
    lines.push(`Speed: ${movement.speed}`);
  }

  if (movement.execution) {
    lines.push(`Execution: ${movement.execution}`);
  }

  if (movement.framing) {
    lines.push(`Framing: ${movement.framing}`);
  }

  if (movement.endFrame) {
    lines.push(`End frame: ${movement.endFrame}`);
  }

  if (includeDescription && movement.description) {
    lines.push(`Description: ${movement.description}`);
  }

  return lines.join("\n");
}

// ── Inline camera movement description for Cinematic Controls block ─────────

export function cinematicMovementLine(movement) {
  if (!movement) return "Camera movement: Auto — infer from context";
  const direction = movement.direction && movement.direction !== "none" && movement.direction !== "variable"
    ? `direction ${movement.direction}, `
    : "";
  const speed = movement.speed && movement.speed !== "still" ? `${movement.speed} speed, ` : "";
  return `Camera movement: ${movement.label} — ${direction}${speed}${movement.execution}, framing ${movement.framing}, ends ${movement.endFrame}`;
}

// ── Rich camera movement description for enhanced prompts ───────────────────

export function describeMovement(movement) {
  if (!movement) return "";
  const direction = movement.direction && movement.direction !== "none" && movement.direction !== "variable"
    ? `moving ${movement.direction}, `
    : "";
  const speed = movement.speed && movement.speed !== "still" ? ` ${movement.speed} speed,` : "";
  return `${movement.label}: camera ${direction}${movement.execution.replace(/-/g, " ")},${speed} framed as a ${movement.framing} shot, ending ${movement.endFrame.replace(/-/g, " ")}.`;
}
