import { cn } from "@/lib/utils"

/**
 * Canonical page content wrapper — standardizes the `<div className="p-8">`
 * pattern every page currently hand-rolls, with responsive padding (p-6 on
 * small viewports, p-8 from sm: up — the existing fixed p-8 felt cramped on
 * narrow widths and wasted nothing on wide ones). One place to tune the
 * global content rhythm going forward. Pages keep their own max-width
 * utilities via `className` (merged through `cn`).
 */
function PageContainer({ className, children, ...props }) {
  return (
    <div data-slot="page-container" className={cn("p-6 sm:p-8", className)} {...props}>
      {children}
    </div>
  );
}

export { PageContainer }
