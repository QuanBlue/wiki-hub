"use client";

import { useEffect } from "react";

import { useTranslation } from "@/lib/i18n/context";

/**
 * Marks the export as failed on `<body>` - the same element and attribute
 * `ExportShell`'s own watchdog uses - so the backend's Playwright capture has
 * exactly one selector to wait on for either outcome:
 * `body[data-export-ready="true"], body[data-export-error]`.
 */
export function ExportError({
  reason,
  message,
}: {
  reason: "missing-token" | "fetch-failed";
  message?: string;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    document.body.dataset.exportError = reason;
  }, [reason]);

  return (
    <div className="p-10 text-sm text-red-600">
      {message ?? t("editor.exportLinkInvalid")}
    </div>
  );
}
