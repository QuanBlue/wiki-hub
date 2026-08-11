import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A small status chip.
 *
 * **Non-interactive by design** — it carries no hover or focus styling, and
 * that is not an oversight of the interaction-states rule in
 * docs/design-system.md. If something needs to be clickable, use `Button` or a
 * link; a badge that reacts to the pointer reads as a control and invites
 * clicks that do nothing.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "border-border text-muted-foreground bg-surface-sunken",
        success: "border-success/30 text-success bg-success-bg",
        warning: "border-warning/30 text-warning bg-warning-bg",
        danger: "border-danger/30 text-danger bg-danger-bg",
        info: "border-primary/30 text-primary bg-primary-subtle",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
