import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// Interaction states follow docs/design-system.md: every variant gives hover,
// active and focus-visible feedback. `active:` uses a subtle scale so the press
// registers even where the colour shift is slight, wrapped in `motion-safe:` to
// respect prefers-reduced-motion. Only colour/shadow properties are
// transitioned - `transition-all` would animate layout too.
//
// Hover styles are wrapped in `[&:not(:disabled)]:` rather than left bare.
// `disabled:pointer-events-none` used to make that unnecessary, but it also
// meant the element never received the pointer at all, so the browser could
// not apply `disabled:cursor-not-allowed` either - the "no entry" cursor
// simply never appeared. Pointer events now stay on for real `<button>`s (the
// `disabled` attribute already blocks activation natively), which brings the
// cursor back; `:not(:disabled)` is what keeps a disabled button from lighting
// up under the pointer as though it still worked. It is written that way
// rather than with `enabled:` so `asChild` anchors - which are never
// `:disabled` - keep their hover states.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium " +
    "transition-[color,background-color,border-color,box-shadow,opacity] duration-150 " +
    "motion-safe:active:scale-[0.98] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
    "focus-visible:ring-offset-1 focus-visible:ring-offset-background " +
    "disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 " +
    "cursor-pointer disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground [&:not(:disabled)]:hover:bg-primary-hover " +
          "active:bg-primary-hover [&:not(:disabled)]:hover:shadow-sm",
        secondary:
          "bg-surface-sunken text-foreground border border-border " +
          "[&:not(:disabled)]:hover:bg-surface-hover " +
          "[&:not(:disabled)]:hover:border-border-strong active:bg-surface-selected",
        subtle:
          "text-foreground [&:not(:disabled)]:hover:bg-surface-hover active:bg-surface-selected",
        ghost:
          "text-muted-foreground [&:not(:disabled)]:hover:bg-surface-hover " +
          "[&:not(:disabled)]:hover:text-foreground active:bg-surface-selected",
        danger:
          "bg-danger text-danger-foreground [&:not(:disabled)]:hover:opacity-90 " +
          "active:opacity-100 [&:not(:disabled)]:hover:shadow-sm",
        link:
          "text-primary underline-offset-4 [&:not(:disabled)]:hover:underline active:opacity-80",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3",
        lg: "h-10 px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child element instead of a `<button>` (e.g. a Next.js `<Link>`). */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          buttonVariants({ variant, size }),
          // Rendering as something else (an anchor, most often) means the
          // `disabled` attribute is inert, so blocking pointer events is the
          // only thing stopping the click. A real `<button>` does not need it
          // and must not have it, or the not-allowed cursor never shows.
          asChild && "disabled:pointer-events-none",
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
