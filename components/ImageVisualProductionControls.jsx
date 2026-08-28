"use client";

import { RotateCcw } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  IMAGE_PRESETS,
  COMPOSITION_OPTIONS,
  PERSPECTIVE_OPTIONS,
  LENS_OPTIONS,
  DEPTH_OF_FIELD_OPTIONS,
  LIGHTING_OPTIONS,
  STYLE_OPTIONS,
  COLOR_TREATMENT_OPTIONS,
  ASPECT_RATIO_OPTIONS,
  FIELD_DEFS,
  OPTION_MAP,
  applyPreset,
  defaultVisualControls,
  CINEMATIC_STYLE_OPTIONS,
} from "@/lib/image-visual-controls";

const CONTROL_OPTION_MAP = {
  composition: COMPOSITION_OPTIONS,
  perspective: PERSPECTIVE_OPTIONS,
  lens: LENS_OPTIONS,
  depthOfField: DEPTH_OF_FIELD_OPTIONS,
  lighting: LIGHTING_OPTIONS,
  style: STYLE_OPTIONS,
  colorTreatment: COLOR_TREATMENT_OPTIONS,
  aspectRatio: ASPECT_RATIO_OPTIONS,
};

function Field({ id, label, value, onChange, disabled }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={(v) => onChange(v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONTROL_OPTION_MAP[id].map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function ImageVisualProductionControls({ value, onChange, disabled }) {
  const controls = value ?? defaultVisualControls();

  function handlePreset(presetValue) {
    // Pass the current state so an explicitly chosen cinematic style survives
    // preset selection (applyPreset merges instead of replacing).
    onChange(applyPreset(presetValue, controls));
  }

  function handleControlChange(key, v) {
    onChange({ ...controls, preset: "custom", [key]: v });
  }

  function handleReset() {
    onChange(defaultVisualControls());
  }

  const selected = FIELD_DEFS.map(({ key, label }) => {
    const v = controls[key];
    if (!v || v === "auto") return null;
    const readable =
      CONTROL_OPTION_MAP[key].find((o) => o.value === v)?.label ?? v;
    return `${label.split(" / ")[0]}: ${readable}`;
  }).filter(Boolean);

  return (
    <div className="space-y-4">
      {/* Cinematic Style */}
      <div className="space-y-1.5">
        <Label htmlFor="cinematic-style">Cinematic style</Label>
        <Select
          value={controls.cinematicStyle ?? "auto"}
          onValueChange={(v) => handleControlChange("cinematicStyle", v)}
          disabled={disabled}
        >
          <SelectTrigger id="cinematic-style" className="w-full" aria-label="Cinematic style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CINEMATIC_STYLE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {controls.cinematicStyle && controls.cinematicStyle !== "auto" && (
          <p className="text-xs text-muted-foreground">
            {CINEMATIC_STYLE_OPTIONS.find((o) => o.value === controls.cinematicStyle)?.description}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Preset */}
        <div className="space-y-1.5">
          <Label htmlFor="vpc-preset">Visual preset</Label>
          <Select
            value={controls.preset}
            onValueChange={handlePreset}
            disabled={disabled}
          >
            <SelectTrigger id="vpc-preset" className="w-full" aria-label="Visual preset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMAGE_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Reset */}
        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={disabled}
            className="gap-1.5"
            aria-label="Reset visual controls to AI decides"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        </div>
      </div>

      {/* Individual controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FIELD_DEFS.map(({ key, label }) => (
          <Field
            key={key}
            id={key}
            label={label}
            value={controls[key]}
            onChange={(v) => handleControlChange(key, v)}
            disabled={disabled}
          />
        ))}
      </div>

      {/* Compact summary */}
      <p className="text-xs text-muted-foreground">
        {selected.length === 0
          ? "AI decides all visual production controls."
          : `Selected: ${selected.join(" · ")}`}
      </p>
    </div>
  );
}
