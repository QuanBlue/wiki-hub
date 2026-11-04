"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useTranslation } from "@/lib/i18n/context";
import { linkNavigationTarget } from "@/lib/navigation-target";

export interface UnsavedChangesGuard {
  /**
   * Run `action` now if nothing is unsaved; otherwise ask first
   * (save and continue / continue without saving / keep editing).
   */
  attempt: (action: () => void) => void;
  /** Render once, anywhere in the tree. */
  dialog: ReactElement;
}

/**
 * Stops someone leaving a form with unsaved changes by accident.
 *
 * - `attempt(action)` guards in-page exits (a Cancel button, a tab switch).
 * - Clicks on links to another page are caught and asked about too.
 * - Closing the tab or refreshing falls back to the browser's own prompt, the
 *   one place a web app may not substitute its own dialog.
 *
 * `save` must report whether the changes were really saved; if it returns
 * false (a validation or server error) the person stays on the form, where
 * the error is shown.
 */
export function useUnsavedChangesGuard({
  dirty,
  save,
}: {
  dirty: boolean;
  save: () => Promise<boolean>;
}): UnsavedChangesGuard {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  // A saved form stops being dirty before the follow-up navigation runs.
  const allowUnload = useRef(false);

  const attempt = useCallback(
    (action: () => void) => {
      if (!dirty) {
        action();
        return;
      }
      // Wrapped: a bare function would be called as a state updater.
      setPending(() => action);
    },
    [dirty],
  );

  useEffect(() => {
    if (!dirty) return;

    const confirmUnload = (event: BeforeUnloadEvent) => {
      if (allowUnload.current) return;
      event.preventDefault();
      event.returnValue = t("unsavedChanges.browserMessage");
    };
    const confirmInternalNavigation = (event: MouseEvent) => {
      const destination = linkNavigationTarget(event);
      if (!destination) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => {
        if (destination.origin === window.location.origin) {
          router.push(`${destination.pathname}${destination.search}${destination.hash}`);
        } else {
          allowUnload.current = true;
          window.location.assign(destination.href);
        }
      });
    };

    window.addEventListener("beforeunload", confirmUnload);
    document.addEventListener("click", confirmInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", confirmUnload);
      document.removeEventListener("click", confirmInternalNavigation, true);
    };
  }, [dirty, router, t]);

  async function saveAndContinue() {
    const action = pending;
    if (!action) return;
    setSaving(true);
    try {
      if (await save()) {
        setPending(null);
        action();
      } else {
        // Stay: the form is showing what needs fixing.
        setPending(null);
      }
    } finally {
      setSaving(false);
    }
  }

  function continueWithoutSaving() {
    const action = pending;
    setPending(null);
    action?.();
  }

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !saving) setPending(null);
      }}
      title={t("unsavedChanges.title")}
      description={t("unsavedChanges.description")}
      confirmLabel={t("unsavedChanges.saveAndLeave")}
      secondaryLabel={t("unsavedChanges.leaveWithoutSaving")}
      onSecondary={continueWithoutSaving}
      cancelLabel={t("unsavedChanges.keepEditing")}
      dismissOnOutsideClick={!saving}
      pending={saving}
      onConfirm={() => void saveAndContinue()}
    />
  );

  return { attempt, dialog };
}
