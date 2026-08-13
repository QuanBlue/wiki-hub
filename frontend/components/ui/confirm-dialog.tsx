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
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialogPrimitive.Content
          className={cn(
            "border-border bg-surface fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md",
            "-translate-x-1/2 -translate-y-1/2 rounded-lg border p-5 shadow-lg",
          )}
        >
          <AlertDialogPrimitive.Title className="text-base font-semibold">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-muted-foreground mt-1.5 text-sm">
            {description}
          </AlertDialogPrimitive.Description>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {secondaryLabel && onSecondary ? (
              <AlertDialogPrimitive.Action
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  onSecondary();
                }}
                className={cn(buttonVariants({ variant: "ghost" }))}
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
