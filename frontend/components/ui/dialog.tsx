"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Modal dialog.
 *
 * Used for per-row table actions, where the inline-expand pattern from
 * `create-space-form.tsx` breaks down: expanding a table row into a form wrecks
 * the column layout and leaves focus somewhere arbitrary. Radix supplies the
 * focus trap, Escape handling, scroll lock and `aria-modal` wiring that are
 * tedious and easy to get subtly wrong by hand.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title"> & {
    title: React.ReactNode;
    description?: string;
  }
>(function DialogContent(
  { className, children, title, description, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/50",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "border-border bg-surface fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md",
          "-translate-x-1/2 -translate-y-1/2 rounded-lg border p-5 shadow-lg",
          "max-h-[calc(100vh-4rem)] overflow-y-auto",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        <div className="mb-4 pr-6">
          <DialogPrimitive.Title className="text-base font-semibold">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="text-muted-foreground mt-1 text-sm">
              {description}
            </DialogPrimitive.Description>
          ) : (
            // Radix warns when a dialog has no description; an explicitly empty
            // one is the documented way to opt out.
            <DialogPrimitive.Description className="sr-only">
              {title}
            </DialogPrimitive.Description>
          )}
        </div>

        {children}

        <DialogPrimitive.Close
          aria-label="Close"
          className={cn(
            "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
            "focus-visible:ring-ring active:bg-surface-selected absolute top-4 right-4",
            "cursor-pointer rounded-md p-1 transition-colors duration-150",
            "focus-visible:ring-2 focus-visible:outline-none",
          )}
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-5 flex flex-wrap justify-end gap-2", className)}
      {...props}
    />
  );
}
