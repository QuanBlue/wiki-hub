import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Text input primitive.
 *
 * Interaction states follow docs/design-system.md: the border shifts on hover,
 * the ring appears on focus, and the two are independent — a focused field that
 * is also hovered still shows its ring. Disabled fields get no hover feedback at
 * all.
 *
 * Exported as a class string too, so composite controls (see `PasswordInput`)
 * can reuse the exact same styling instead of drifting from it.
 */
export const inputClassName = cn(
  "border-border bg-surface h-9 w-full rounded-md border px-3 text-sm",
  "transition-[color,background-color,border-color,box-shadow] duration-150",
  "placeholder:text-muted-foreground",
  "hover:border-border-strong",
  "focus-visible:ring-ring focus-visible:border-border-strong focus-visible:ring-2 focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger",
);

export type InputProps = React.ComponentPropsWithoutRef<"input">;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, ...props }, ref) {
    return (
      <input ref={ref} className={cn(inputClassName, className)} {...props} />
    );
  },
);
