import * as React from "react";

import { cn } from "@/lib/utils";

export const textareaClassName = cn(
  "border-border bg-surface min-h-24 w-full resize-y rounded-md border px-3 py-2 text-sm",
  "transition-[color,background-color,border-color,box-shadow] duration-150",
  "placeholder:text-muted-foreground hover:border-border-strong",
  "focus-visible:ring-ring focus-visible:border-border-strong focus-visible:ring-2 focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger",
);

export type TextareaProps = React.ComponentPropsWithoutRef<"textarea">;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(textareaClassName, className)} {...props} />;
  },
);
Textarea.displayName = "Textarea";
