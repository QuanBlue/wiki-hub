import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// Interaction states follow docs/design-system.md: every variant gives hover,
// active and focus-visible feedback. `active:` uses a subtle scale so the press
// registers even where the colour shift is slight, wrapped in `motion-safe:` to
// respect prefers-reduced-motion. Only colour/shadow properties are
// transitioned - `transition-all` would animate layout too.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium " +
    "transition-[color,background-color,border-color,box-shadow,opacity] duration-150 " +
    "motion-safe:active:scale-[0.98] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
    "focus-visible:ring-offset-1 focus-visible:ring-offset-background " +
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 " +
    "cursor-pointer disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover " +
          "hover:shadow-sm",
        secondary:
          "bg-surface-sunken text-foreground border border-border " +
          "hover:bg-surface-hover hover:border-border-strong active:bg-surface-selected",
        subtle:
          "text-foreground hover:bg-surface-hover active:bg-surface-selected",
        ghost:
          "text-muted-foreground hover:bg-surface-hover hover:text-foreground " +
          "active:bg-surface-selected",
        danger:
          "bg-danger text-danger-foreground hover:opacity-90 active:opacity-100 hover:shadow-sm",
        link: "text-primary underline-offset-4 hover:underline active:opacity-80",
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
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
