import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Editorial-poster heading block: optional "Back" link, optional small mono
 * "eyebrow" in the limited accent color, a large expressive title, and a
 * description. Use level="page" for the top h1 of a screen and level="section"
 * for sub-sections within a page (e.g. "Schedule", "Visual Direction" tabs) —
 * one component, two scales, so pages don't need a second near-duplicate.
 *
 * Drop-in replacement for the ad-hoc `<h1 className="text-2xl font-semibold">`
 * + hand-rolled `<Link><ArrowLeft/>Back</Link>` patterns pages currently
 * repeat — adopt page by page, no functional change.
 */
function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  level = "page",
  backHref,
  backLabel = "Back",
  className,
  ...props
}) {
  const isSection = level === "section";
  const Heading = isSection ? "h2" : "h1";

  return (
    <div
      data-slot="page-header"
      data-level={level}
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        isSection ? "mb-4" : "mb-8",
        className
      )}
      {...props}
    >
      <div className="flex flex-col gap-1.5">
        {backHref ? (
          <Link
            href={backHref}
            className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {backLabel}
          </Link>
        ) : null}
        {eyebrow ? <span className="label-sketch text-accent-vermilion">{eyebrow}</span> : null}
        <Heading className={isSection ? "heading-section" : "heading-display"}>{title}</Heading>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export { PageHeader }
