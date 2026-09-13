"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A hover/focus hint - for a short explanation that would otherwise take up
 * permanent space (a callout box, a persistent caption) next to something
 * that doesn't need it visible at all times. `TooltipProvider` wraps a
 * single trigger here rather than the whole app, since nothing else uses
 * this yet; move it up if a second consumer needs the shared `delayDuration`.
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "border-border bg-surface text-foreground z-50 max-w-72 rounded-md border px-2.5 py-1.5 text-xs shadow-lg",
          "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
          "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});
