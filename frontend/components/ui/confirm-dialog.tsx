"use client";

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Confirmation for a destructive or irreversible action.
 *
 * AlertDialog rather than Dialog: it uses `role="alertdialog"`, moves initial
 * focus to the cancel action, and — critically — does **not** dismiss on an
 * outside click or Escape-to-confirm. Rebuilding that on top of Dialog is how
 * an accidental delete happens.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  secondaryLabel,
  onSecondary,
  tertiaryLabel,
  onTertiary,
  dismissOnOutsideClick = false,
  destructive = false,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** An extra middle action, drawn in the warning tone (e.g. "Save draft and leave"). */
  tertiaryLabel?: string;
  onTertiary?: () => void;
  /** Treat a click on the backdrop as the cancel action. Off by default. */
  dismissOnOutsideClick?: boolean;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/50"
          // Opt-in: for prompts whose cancel action is a harmless "stay",
          // clicking the backdrop is the same as choosing it.
          onClick={dismissOnOutsideClick ? () => onOpenChange(false) : undefined}
        />
        <AlertDialogPrimitive.Content
          className={cn(
            "border-border bg-surface fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)]",
            // Four actions need more room than two, or the row wraps.
            tertiaryLabel && onTertiary ? "max-w-xl" : "max-w-md",
            "-translate-x-1/2 -translate-y-1/2 rounded-lg border p-5 shadow-lg",
          )}
        >
          <AlertDialogPrimitive.Title className="text-base font-semibold">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-muted-foreground mt-1.5 text-sm">
            {description}
          </AlertDialogPrimitive.Description>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2 [&>button]:whitespace-nowrap">
            {secondaryLabel && onSecondary ? (
              <AlertDialogPrimitive.Action
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  onSecondary();
                }}
                // The "leave" escape hatch sits apart on the left; the
                // remaining actions group on the right.
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  tertiaryLabel && onTertiary && "sm:mr-auto",
                )}
              >
                {secondaryLabel}
              </AlertDialogPrimitive.Action>
            ) : null}
            <AlertDialogPrimitive.Cancel
              disabled={pending}
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              {cancelLabel}
            </AlertDialogPrimitive.Cancel>
            {tertiaryLabel && onTertiary ? (
              <AlertDialogPrimitive.Action
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  onTertiary();
                }}
                className={cn(
                  buttonVariants({ variant: "secondary" }),
                  "border-warning/50 bg-warning-bg text-warning",
                  // Same modifier chain as the secondary variant's own hover
                  // rules, otherwise those win on specificity and it goes grey.
                  "[&:not(:disabled)]:hover:border-warning/70 [&:not(:disabled)]:hover:bg-[color:color-mix(in_oklab,var(--wh-warning)_12%,var(--surface))]",
                  "active:bg-[color:color-mix(in_oklab,var(--wh-warning)_20%,var(--surface))]",
                )}
              >
                {tertiaryLabel}
              </AlertDialogPrimitive.Action>
            ) : null}
            <AlertDialogPrimitive.Action
              disabled={pending}
              onClick={(event) => {
                // Keep the dialog open while the request is in flight so the
                // pending state is visible; the caller closes it on success.
                event.preventDefault();
                onConfirm();
              }}
              className={cn(
                buttonVariants({ variant: destructive ? "danger" : "primary" }),
              )}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              {confirmLabel}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
