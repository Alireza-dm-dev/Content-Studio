import { cn } from "@/lib/utils"

/**
 * Shared empty state — consolidates the icon-in-badge + heading + description
 * + action pattern repeated (with slightly different markup each time) across
 * brands, content-calendar, and generated-prompts list pages. The icon badge
 * uses the sketch frame instead of a plain rounded circle, and the heading
 * reads slightly bolder/tighter to match the new expressive type scale.
 * Adopt page by page — existing inline empty states keep working untouched.
 */
function EmptyState({ icon: Icon, title, description, action, className, ...props }) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center justify-center gap-1 py-20 text-center", className)}
      {...props}
    >
      {Icon ? (
        <div className="sketch-frame mb-3 flex size-14 items-center justify-center bg-card text-muted-foreground">
          <Icon className="size-6" strokeWidth={1.5} />
        </div>
      ) : null}
      <h2 className="text-base font-bold tracking-tight text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export { EmptyState }
