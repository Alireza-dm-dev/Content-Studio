import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge sketch-badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden px-2 py-0.5 whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      // "Highlight" tag (NEW/FEATURED) — the one place vermilion may fill a
      // badge background; everything else stays greyscale-on-paper (§16).
      variant: {
        default: "sketch-badge-highlight [a]:hover:bg-accent-vermilion/85",
        secondary:
          "[a]:hover:bg-secondary [a]:hover:text-secondary-foreground",
        destructive:
          "border-destructive text-destructive [a]:hover:bg-destructive/10",
        outline: "[a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "border-transparent hover:bg-muted hover:text-muted-foreground",
        link: "border-transparent bg-transparent text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps({
      className: cn(badgeVariants({ variant }), className),
    }, props),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants }
