// Form body for the "Change slide count" regeneration scope, shared by the
// saved-post and unsaved (Review step) regeneration panels.

import { MAX_SLIDE_COUNT, MIN_SLIDE_COUNT } from "@/lib/calendar-slide-count";

export const SLIDE_COUNT_INSTRUCTION_PLACEHOLDER =
  "e.g. Keep slide 1 as-is. Merge the content from slides 2–6 into slide 2.";

export function SlideCountRegenForm({
  currentCount,
  newSlideCount,
  onNewSlideCountChange,
  instruction,
  onInstructionChange,
  validationMessage,
  disabled,
}) {
  return (
    <div className="space-y-3 border border-border rounded-lg p-3 bg-background">
      <div className="flex items-end gap-6">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current slides</p>
          <p className="text-lg font-semibold text-foreground mt-1">{currentCount || "—"}</p>
        </div>
        <div>
          <label htmlFor="new-slide-count" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
            New slide count
          </label>
          <input
            id="new-slide-count"
            type="number"
            inputMode="numeric"
            min={MIN_SLIDE_COUNT}
            max={MAX_SLIDE_COUNT}
            step={1}
            disabled={disabled}
            value={newSlideCount}
            onChange={e => onNewSlideCountChange(e.target.value)}
            className="mt-1 w-20 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
          />
        </div>
      </div>
      {validationMessage && (
        <p className="text-xs text-destructive" role="alert">{validationMessage}</p>
      )}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground block">
          How should the content be redistributed?{" "}
          <span className="text-muted-foreground/50">(optional)</span>
        </label>
        <textarea
          rows={3}
          disabled={disabled}
          value={instruction}
          onChange={e => onInstructionChange(e.target.value)}
          placeholder={SLIDE_COUNT_INSTRUCTION_PLACEHOLDER}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-none shadow-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
        />
      </div>
      <p className="text-xs text-muted-foreground/70">
        Only the slide structure changes (content structure, per-slide visual notes, and Image Text). Caption, hashtags,
        hook, format, platform, schedule, and video fields are left untouched.
      </p>
    </div>
  );
}
