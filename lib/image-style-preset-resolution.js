// Centralized Cinematic Style + Visual Preset resolution for ALL image-prompt
// creation flows (raw idea, brand-based, reference-image-based, calendar post
// image prompts).
//
// Contract (single source of truth — routes must not re-implement this):
//   Cinematic Style:
//     - missing / blank / "auto"  → "auto" (AI decides)
//     - valid explicit option     → canonical style id
//     - invalid explicit value    → structured 400 error
//       (never silently downgraded to auto)
//   Visual Preset:
//     - missing / blank / "auto" / "custom" → "custom" (AI decides per control)
//     - valid explicit option     → canonical preset value
//     - invalid explicit value    → structured 400 error
//
// Precedence when multiple controls are set (documented rule, emitted into the
// prompt so the model resolves conflicts predictably):
//   1. Explicit manual production controls (highest)
//   2. Explicit Visual Preset characteristics
//   3. Explicit Cinematic Style directions
//   4. AI/default behaviour
//
// Client-safe: no server-only imports. buildImageStyleBlock comes from the
// shared cinematic-styles module (locally bound import, NOT a bare re-export).

import { IMAGE_PRESETS, FIELD_DEFS, OPTION_MAP } from "@/lib/image-visual-controls";
import {
  resolveCinematicStyle,
  buildImageStyleBlock,
} from "@/lib/cinematic-styles";

export const CINEMATIC_STYLE_ERROR_CODE = "UNSUPPORTED_CINEMATIC_STYLE";
export const VISUAL_PRESET_ERROR_CODE = "UNSUPPORTED_VISUAL_PRESET";

const PRESET_AUTO_VALUES = new Set([undefined, null, "", "auto", "custom"]);

function getPresetById(value) {
  return IMAGE_PRESETS.find((p) => p.value === value) ?? null;
}

/**
 * Resolve both selections against their canonical option sets.
 *
 * Returns:
 *   { ok: true,  cinematicStyle, preset }              on success
 *   { ok: false, errors: [{ code, field, message }] }  for invalid explicit values
 */
export function resolveImageStyleAndPreset({ cinematicStyle, preset } = {}) {
  const errors = [];

  const cinematic = resolveCinematicStyle(cinematicStyle);
  if (cinematic.error) {
    errors.push({
      code: CINEMATIC_STYLE_ERROR_CODE,
      field: "cinematicStyle",
      message: cinematic.error,
    });
  }

  let resolvedPreset = "custom";
  if (!PRESET_AUTO_VALUES.has(preset)) {
    if (typeof preset !== "string") {
      errors.push({
        code: VISUAL_PRESET_ERROR_CODE,
        field: "preset",
        message: `Invalid visual preset. Choose one of the supported presets or leave it on "Custom / AI decides".`,
      });
    } else {
      const trimmed = preset.trim();
      if (!PRESET_AUTO_VALUES.has(trimmed)) {
        const match = getPresetById(trimmed);
        if (!match) {
          errors.push({
            code: VISUAL_PRESET_ERROR_CODE,
            field: "preset",
            message:
              `Unsupported visual preset: "${trimmed}". ` +
              `Choose one of the supported presets or set it to "custom"/"auto" to let the AI decide.`,
          });
        } else {
          resolvedPreset = match.value;
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    cinematicStyle: cinematic.style, // "auto" or canonical style id
    preset: resolvedPreset,          // "custom" or canonical preset value
  };
}

/**
 * Map resolver errors to a structured 400 JSON response body.
 * Routes return NextResponse.json(body, { status }) with this so every image
 * route emits the identical error shape.
 */
export function imageStylePresetErrorResponse(errors) {
  const primary = errors[0];
  return {
    body: {
      success: false,
      code: primary?.code ?? "INVALID_VISUAL_CONTROLS",
      error: primary?.message ?? "Invalid visual production controls.",
      errors,
    },
    status: 400,
  };
}

/**
 * Build the full "visual production direction" prompt section implementing the
 * documented precedence:
 *   manual controls (1) → visual preset characteristics (2) → cinematic style (3)
 *
 * Returns "" when nothing explicit is selected (pure AI/default mode), so auto
 * never injects the word "Auto" into prompts.
 */
export function buildProductionControlsSection({ manualControlsBlock, cinematicStyle, preset }) {
  const parts = [];

  // (1) Explicit manual controls — highest priority user constraints.
  if (manualControlsBlock) {
    parts.push(
      manualControlsBlock,
      "The Selected Visual Production Controls above are explicit manual choices and take priority over any preset or cinematic-style default below.",
    );
  }

  // (2) Visual Preset — expanded characteristics, never just the ID.
  if (preset && preset !== "custom") {
    const presetDef = getPresetById(preset);
    if (presetDef) {
      const presetLines = [
        "SELECTED VISUAL PRESET",
        "",
        `Selected preset: ${presetDef.label}`,
        ...(presetDef.characteristics ? ["", presetDef.characteristics] : []),
      ];
      // Expand the preset's underlying control values so the model receives
      // concrete direction even when the client only sent the preset ID.
      const expanded = FIELD_DEFS.map(({ key, label }) => {
        const v = presetDef.controls?.[key];
        if (!v || v === "auto") return null;
        const readable = OPTION_MAP[key]?.find((o) => o.value === v)?.label ?? v;
        return `- ${label}: ${readable}`;
      }).filter(Boolean).join("\n");
      if (expanded) {
        presetLines.push("", "Preset baseline settings:", expanded);
      }
      presetLines.push(
        "",
        "Apply these preset characteristics as the default production direction. Where an explicit manual control above differs, follow the manual control instead.",
      );
      parts.push(presetLines.join("\n"));
    }
  }

  // (3) Cinematic Style — full resolved instructions (composition, optics,
  // depth of field, lighting, grade, texture, atmosphere, constraints).
  if (cinematicStyle && cinematicStyle !== "auto") {
    const styleBlock = buildImageStyleBlock(cinematicStyle);
    if (styleBlock) {
      parts.push(
        [
          styleBlock,
          "",
          "Apply this cinematic style as the overall visual atmosphere and lensing direction. Where an explicit manual control or visual preset characteristic above differs, follow the higher-priority selection.",
        ].join("\n"),
      );
    }
  }

  if (parts.length === 0) return "";

  parts.push(
    "PRECEDENCE RULE when instructions conflict: (1) explicit manual visual production control > (2) visual preset > (3) cinematic style > (4) your default judgment. Never silently drop a lower-priority explicit selection without applying its closest compatible aspects.",
  );

  return parts.join("\n\n");
}
