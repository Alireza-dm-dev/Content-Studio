#!/usr/bin/env node
// Idempotent enhancement of the nine video prompt parameter descriptions
// (scene, mainAction, motion, cameraMovement, shotType, visualStyle, mood,
//  videoQuality, avoid) inside the video-prompt-enhancer-raw-idea template.
//
// This targets the "Recommended structure" section only — everything else in
// the template is preserved verbatim.
//
// Usage:
//   node scripts/enhance-video-parameters.js --check    (exit 0 if current)
//   node scripts/enhance-video-parameters.js --apply

import { PrismaClient } from "../lib/generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL ?? "file:" + path.join(__dirname, "../dev.db");

const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const SLUG = "video-prompt-enhancer-raw-idea";
const MANAGED_MARKER = "<!-- managed:video-parameter-enhancement:v2 -->";

// ── Exact old Recommended structure block ───────────────────────────────
const OLD_STRUCTURE_BLOCK = `# Recommended structure:

Only include fields that make sense for the user\u2019s idea, but always include the required cinematic fields.

subject:
[main person, object, character, animal, product, or scene]

scene:
[where the video happens]

main action:
[what is happening in the video]

motion:
[how the subject moves, how the environment moves, what changes during the shot]

speed ramp:
[Auto, Slow-mo, Ramp Up, Flash In, Flash Out, Bullet Time, Hero Moment, or a short custom value]

camera movement:
[Static, Handheld, Zoom Out, Zoom in, Camera follows, Pan left, Pan right, Tilt up, Tilt down, Orbit around, Dolly in, Dolly out, Jib up, Jib down, Drone shot, Dolly left, Dolly right, 360 roll, or a short custom value]

camera:
[Auto, Raw 16 mm, Fine film, or Clean Digital]

lens:
[Auto, extreme macro, anamorphic, warm halation, or vintage haze]

focal length:
[45, 75, 50, 35, 14, or 8]

aperture:
[f/11 deep focus, f/1.4 wide open, or f/4 moderate]

shot type:
[wide shot, medium shot, close-up, extreme close-up, over-the-shoulder, POV, low angle, high angle, etc.]

visual style:
[realistic, cinematic, documentary, social media reel, commercial ad, 3D animation, anime, cartoon, luxury product video, educational video, etc.]

lighting:
[natural daylight, soft indoor light, cinematic warm light, moody lighting, studio lighting, neon light, sunset light, etc.]

mood / vibe:
[calm, emotional, funny, luxury, energetic, dreamy, professional, natural, casual, dramatic, etc.]

video quality:
[realistic motion, natural movement, stable frames, no flickering, clean details, smooth transitions, high quality, 4k if needed]

sound direction:
[optional: no sound, ambient sound, city noise, soft music, product sound, natural environment audio]

text on screen:
[optional: exact text if the user requested text]

transition:
[optional: cut, fade, zoom transition, smooth transition, match cut, etc.]

Avoid:
[things to avoid, such as unnatural motion, distorted faces, extra fingers, flickering, warped background, random text, watermark, unrelated logos, over-sharpening, oversaturation, excessive blur, low-quality frames, sudden camera jumps]`;

// ── Enhanced Recommended structure block ────────────────────────────────
// Only the nine targeted parameters (scene, mainAction, motion,
// cameraMovement, shotType, visualStyle, mood, videoQuality, avoid) have
// been enriched. The other fields (subject, speedRamp, camera, lens,
// focalLength, aperture, lighting, sound, textOnScreen, transition) are
// untouched so the template's existing selection rules for those fields
// remain in their dedicated sections.
const NEW_STRUCTURE_BLOCK = `# Recommended structure:

Only include fields that make sense for the user\u2019s idea, but always include the required cinematic fields.

subject:
[main person, object, character, animal, product, or scene]

scene:
[describe the physical environment — the specific location, type of space
(interior/exterior, urban/natural), time of day, season or weather, architectural
or landscape style, colour palette of the environment, key props and background
details that establish context. Include spatial layout (depth, scale, foreground/
midground/background), ambient lighting quality (window light, artificial, open
shade, golden hour), and any atmospheric elements (fog, dust, rain, haze, smoke).
For interior settings: room type, furniture style, decor, wall colour, texture of
surfaces, window placement and light direction. For exterior settings: built or
natural environment, sky condition, vegetation, ground texture, activity level of
the surroundings. Make every detail chosen specifically for this scene not generic.]

main action:
[describe the primary narrative action — what initiates the scene, the sequence of
events or interactions that unfold, and how the scene resolves or transitions.
Be specific about who does what, in what order, and with what intention: character
actions, interactions between subjects or with objects/environment, dialogue or
narration content (if any), cause-and-effect progression, and the emotional or
narrative purpose of each beat. Distinguish between primary action (what drives
the scene) and secondary or background activity (what supports the atmosphere).
Include pacing markers (starts slowly, builds tension, peaks, resolves) if the
action has a distinct arc. Frame every action in concrete visual terms rather
than abstract concepts — describe what the viewer will actually see happening.]

motion:
[describe all movement in the scene with specificity — primary subject movement
(pacing, direction, quality: fluid, jerky, slow, fast, accelerating, decelerating,
rhythmic, erratic), secondary character or object movement, environmental motion
(wind in foliage, water flow, cloud movement, dust particles, traffic flow, crowd
movement, fabric movement), and any changes in movement over the duration of the
shot. Note the tempo and rhythm: steady, accelerating, pulsing, staccato, smooth.
Describe the relationship between subject movement and camera movement — is the
subject moving through a static frame, is the camera tracking the subject, or are
both moving independently? Include micro-movements where relevant: facial
expressions and their transitions, breathing, hand gestures, eye movement, texture
or surface shifts (ripples, reflections, shadows moving). Distinguish between
intentional movement (choreographed, motivated) and natural/ambient movement
(unscripted, environmental). Include speed qualifiers relative to real-world
expectations (slow-motion, time-lapse, real-time, accelerated pacing) if needed.]

speed ramp:
[Auto, Slow-mo, Ramp Up, Flash In, Flash Out, Bullet Time, Hero Moment, or a short custom value]

camera movement:
[describe the camera motion and framing throughout the shot with precision —
choose from: Static, Handheld, Zoom Out, Zoom in, Camera follows, Pan left,
Pan right, Tilt up, Tilt down, Orbit around, Dolly in, Dolly out, Jib up,
Jib down, Drone shot, Dolly left, Dolly right, 360 roll, or a short custom
value that best serves the scene. Beyond selecting a type, describe the camera
position relative to subject (eye level, low angle, high angle, bird's-eye,
dutch angle, over-the-shoulder, POV), the speed and smoothness of movement
(slow and steady, fast and jarring, smooth glide, organic wobble), the distance
and trajectory of travel (close tracking, wide arc, linear push), and how the
camera work reinforces mood or narrative (intimate proximity, observational
distance, dramatic reveal, energetic following). For camera-follows: describe
the leading distance and whether the camera leads, follows, or moves alongside.
For handheld: note the intensity of shake (subtle human tremor, moderate
documentary feel, intense action energy). For orbit: note radius, speed, and
clockwise/counter-clockwise direction. For dolly: describe the distance of
travel and whether it is motivated (following subject movement) or unmotivated
(revealing environment or building tension). For drone: note altitude, speed,
and whether the movement is expansive (establishing geography) or targeted
(following a subject from above).]

camera:
[Auto, Raw 16 mm, Fine film, or Clean Digital]

lens:
[Auto, extreme macro, anamorphic, warm halation, or vintage haze]

focal length:
[45, 75, 50, 35, 14, or 8]

aperture:
[f/11 deep focus, f/1.4 wide open, or f/4 moderate]

shot type:
[choose and describe the framing that best conveys the narrative and emotional
intent — provide both the shot category and a brief justification linked to the
scene's purpose. Shot categories: wide shot (establishes environment and subject
position within it, emphasises scale and context), medium shot (subject from waist
or hip up, balanced between environment and character, ideal for dialogue and
action), medium close-up (chest or shoulders up, shifts focus to emotional
engagement and reaction), close-up (face or specific detail fills the frame,
maximises intimacy and emotional intensity), extreme close-up (isolates a single
feature or object, dramatic emphasis on detail or texture), over-the-shoulder
(establishes spatial relationship and POV connection between characters,
immersive dialogue framing), POV (subjective view from a character's eyes,
deepest audience identification), low angle (camera below subject eye line,
conveys power, dominance, monumentality, or threat), high angle (camera above
subject, conveys vulnerability, overview, or diminished scale), dutch angle
(tilted horizon, conveys tension, disorientation, unease, or stylistic energy),
aerial/bird's-eye (directly above, grand scale, topography, pattern, or
abstract composition). Include camera height relative to subject, subject-to-camera
distance, and any compositional technique that shapes the frame (rule of thirds,
leading lines, frame within frame, symmetry, asymmetry, negative space, depth
layers, foreground framing elements). Match the shot type to the emotional beat
of the scene — wider for context and breathing room, tighter for pressure and
intimacy.]

visual style:
[define the overall visual treatment with specific direction — choose a primary
style and describe its key visual characteristics for this specific scene.
Style categories: realistic (natural, unpolished, true-to-life colour, available
or motivated lighting, minimal grading, imperfect real-world textures),
cinematic (controlled lighting ratios, shallow depth of field, filmic colour
grade with intentional look, premium composition, shadow detail, highlight roll-off),
documentary (observational camera, available/natural light, grounded colour,
minimal interference, authentic behaviour, no stylised treatment), social media
reel (vertical frame, vibrant and slightly boosted colour, clean and energetic
composition, bright and flattering lighting, dynamic but accessible visual
language), commercial ad (polished multi-point lighting, product-first
composition, clean uncluttered backgrounds, premium surface rendering, controlled
contrast and saturation, aspirational colour grade), 3D animation (CGI rendering
style with specific material fidelity, simulated lighting, texture resolution,
shader quality, subsurface scattering), anime (stylised 2D aesthetic, line art
quality, cel shading or digital paint, expressive colour choices, limited motion
or full animation), cartoon (illustrative, simplified forms, flat colour or simple
gradients, exaggeration for effect, clear readable shapes), luxury product video
(expensive minimalism, slow confident reveals, premium surface rendering,
sculptural lighting, reflective and refractive surfaces, rich shadow depth,
aspirational colour palette), educational video (clear and instructional visual
hierarchy, flat or semi-flat design, clean readable typography, diagrammatic
elements, colour coding for information, step indicators, generous white space).
Describe the level of realism on a spectrum (photorealistic, stylised realistic,
illustrative, abstract), the colour grading approach (warm/amber, cool/blue,
desaturated/muted, vibrant/punchy, monochrome, split-toned, teal-and-orange,
bleach bypass), the texture palette (fine grain, clean digital, soft diffusion,
gritty texture, gloss, matte finish), and how each choice serves the content,
platform, and intended viewer response.]

lighting:
[natural daylight, soft indoor light, cinematic warm light, moody lighting, studio lighting, neon light, sunset light, etc.]

mood / vibe:
[describe the emotional atmosphere and intended viewer feeling with precision —
state the primary mood, then list supporting or evolving emotional notes. Primary
options: calm, emotional, funny, luxury, energetic, dreamy, professional, natural,
casual, dramatic, suspenseful, nostalgic, hopeful, melancholic, inspiring, intimate,
epic, playful, sophisticated, raw, warm, cold, mysterious, joyful, tense, romantic,
whimsical, gritty, serene, or a custom blend tailored to the scene.
Connect each mood note to specific visual and auditory choices that realise it:
lighting quality (soft wraparound, hard directional, dappled, backlit, rim-lit,
practical-only), colour temperature and palette (warm amber and gold for cosiness,
cool steel and blue for detachment, vibrant saturation for energy, desaturated for
melancholy or realism), shadow behaviour (deep and contrasty for drama or mystery,
soft and open for approachability or warmth, minimal shadows for commercial
clarity), texture (grainy film for nostalgia, clean and smooth for modernity,
soft diffusion for dreaminess), pacing (slow lingering shots for gravity or
romance, quick cuts for energy or anxiety, measured pace for professionalism or
education), and sound direction or implied audio quality (quiet with ambient
detail for intimacy, rich score for epic emotion, natural location sound for
documentary realism). Explain how the mood evolves through the scene if the
narrative demands a shift — for example, starts intimate and curious, builds to
warm discovery, resolves with calm satisfaction.]

video quality:
[describe the technical quality and motion characteristics required for this
specific video — choose positively framed requirements relevant to the scene.
Include: rendering resolution (4K, 8K, HD, or platform-optimised), motion
handling (natural motion blur at appropriate shutter angle, stable frame pacing,
realistic acceleration and deceleration), frame stability (locked-off precision,
intentional handheld energy, gimbal-smooth movement, or Steadicam float), detail
and texture (controlled sharpness, clean edges, no aliasing or ringing).
Conditional quality rules — apply only when relevant to the scene:
Human or character scenes: natural skin texture, consistent facial identity across
frames, no waxy or plastic rendering, coherent anatomy and proportions.
Product or object scenes: stable geometry, accurate material rendering, controlled
reflections, no surface warping or distortion, consistent edges and textures.
Stylised or animated scenes: consistent style and line quality, stable rendering
with no texture popping, smooth motion cycles, character/model consistency.
Also include: lighting and exposure consistency (no flickering, matched colour
temperature across cuts), colour accuracy (no colour shift, smooth grading,
blacks stay clean, highlights retain detail), compression and artifact control
(no banding, macroblocking, mosquito noise, or temporal artefacts), and
platform-specific requirements (vertical 9:16 for reels, safe zones, HDR or SDR,
bitrate considerations). Keep every requirement positively framed — what to
deliver, not what to avoid. Avoid framing video quality requirements as a list of
negatives; use the Avoid section for negatives.]

sound direction:
[optional: no sound, ambient sound, city noise, soft music, product sound, natural environment audio]

text on screen:
[optional: exact text if the user requested text]

transition:
[optional: cut, fade, zoom transition, smooth transition, match cut, etc.]

Avoid:
[list negative constraints tailored to this specific video — choose the
relevant categories from below; do not dump every possible artifact.
Conditional selection — apply only what matches the scene:
Human or character subjects — avoid facial/body distortion, extra fingers,
warped features, identity shifts between frames, unnatural anatomy, floating
limbs, unnatural blinking.
Product or object subjects — avoid warped shapes, incorrect materials or
reflections, floating or disconnected parts, brand/logo/text errors,
inconsistent product appearance across frames.
Stylised or animated subjects — avoid style inconsistency, line/texture
breakup, off-model characters, colour bleeding outside lines, inconsistent
rendering quality.
Any scene — avoid flickering (lights, exposure), unwanted text or watermarks,
temporal instability (jitter, micro-stutter, pulsing textures), compression
artifacts (banding, macroblocking, mosquito noise), oversharpening halos,
oversaturation causing clipping, and chromatic aberration unless intentional.
Frame every negative as a specific directive: prefer 'no flickering lights or
exposure jumps' over 'avoid bad quality', and 'no extra fingers or warped
facial features' over 'avoid distortion'.]` + "\n" + MANAGED_MARKER;

// ── Helpers ─────────────────────────────────────────────────────────────

function countOccurrences(text, substring) {
  if (!text || !substring) return 0;
  let count = 0, pos = 0;
  while (true) {
    const idx = text.indexOf(substring, pos);
    if (idx === -1) break;
    count++;
    pos = idx + substring.length;
  }
  return count;
}

const SECTION_START = "# Recommended structure:";
const SECTION_END   = "# Recommendations by video type:";

/**
 * Pure patch function: replaces the Recommended structure section
 * (identified by start/end markers) with NEW_STRUCTURE_BLOCK.
 * Supports first-time patch (OLD_STRUCTURE_BLOCK → NEW) and
 * re-patch (NEW content changed → latest NEW).
 * Returns { status, patchedText?, reason? }.
 */
function patchTemplateText(templateText) {
  const startIdx = templateText.indexOf(SECTION_START);
  const endIdx   = templateText.indexOf(SECTION_END);

  if (startIdx === -1 || endIdx === -1) {
    return { status: "unsafe", reason: "Section boundaries # Recommended structure: / # Recommendations by video type: not found." };
  }

  const currentSection = templateText.slice(startIdx, endIdx);
  const hasMarker      = currentSection.includes(MANAGED_MARKER);
  const isExactMatch   = currentSection === NEW_STRUCTURE_BLOCK;

  if (hasMarker && isExactMatch) {
    return { status: "already_patched" };
  }

  // Guard: refuse if the section does not contain either the old block
  // or any managed marker version (unrecognised custom content).
  const hasAnyMarker = currentSection.includes(MANAGED_MARKER) ||
    currentSection.includes("<!-- managed:video-parameter-enhancement:");
  if (!hasAnyMarker && !currentSection.includes(OLD_STRUCTURE_BLOCK)) {
    return {
      status: "unsafe",
      reason: "Recommended structure section contains neither the known old block nor any managed marker. The template may have been customised beyond recognition.",
    };
  }

  return {
    status: "needs_patch",
    patchedText: templateText.slice(0, startIdx) + NEW_STRUCTURE_BLOCK + templateText.slice(endIdx),
  };
}

// ── Database helpers ───────────────────────────────────────────────────

async function readTemplate() {
  const tpl = await prisma.promptTemplate.findUnique({
    where: { slug: SLUG },
    select: { id: true, templateText: true, defaultTemplateText: true },
  });
  if (!tpl) throw new Error(`Template "${SLUG}" not found in database.`);
  return tpl;
}

async function applyPatch(id, patchedText, originalText) {
  const result = await prisma.promptTemplate.updateMany({
    where: { id, templateText: originalText },
    data: { templateText: patchedText },
  });
  if (result.count === 0) {
    throw new Error(
      "Concurrent modification detected: template changed between read and update. " +
      "Re-run --check to inspect the current state."
    );
  }
  return result.count;
}

// ── Mode dispatch ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const validModes = new Set(["--check", "--apply"]);
  if (args.length === 0) args.push("--check");
  if (args.length !== 1 || !validModes.has(args[0])) {
    console.error("Usage: node scripts/enhance-video-parameters.js [--check | --apply]");
    process.exit(1);
  }

  const mode = args[0];

  try {
    const tpl = await readTemplate();
    const classification = patchTemplateText(tpl.templateText);
    const hasMarker = tpl.templateText.includes(MANAGED_MARKER);

    console.log(`Template: ${SLUG}`);
    console.log(`Status: ${classification.status}`);
    console.log(`Managed marker ${MANAGED_MARKER} present: ${hasMarker}`);
    console.log(`Original char count: ${tpl.templateText.length}`);

    if (classification.reason) {
      console.log(`Reason: ${classification.reason}`);
    }

    if (mode === "--check") {
      process.exit(classification.status === "already_patched" || classification.status === "needs_patch" ? 0 : 1);
    }

    // mode === "--apply"
    if (classification.status === "already_patched") {
      console.log("Database changed: no");
      process.exit(0);
    }

    if (classification.status === "unsafe") {
      console.log("Database changed: no");
      process.exit(1);
    }

    // status === "needs_patch"
    const origLen = tpl.templateText.length;
    const patchedLen = classification.patchedText.length;
    console.log(`Resulting char count: ${patchedLen}`);
    console.log(`Length diff: ${patchedLen - origLen}`);

    await applyPatch(tpl.id, classification.patchedText, tpl.templateText);
    console.log("Database changed: yes");
    process.exit(0);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Error: " + (err.message ?? err));
  process.exit(1);
});
