"use client";

import { FileDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiBaseUrl } from "@/lib/env";
import { useTranslation } from "@/lib/i18n/context";

/** Builds the download URL for a Word export of one or more issues,
 * labelled in the reader's language so the document matches what they see
 * on screen. Several issues go into one file, in the order given. */
export function issueExportUrl(issueIds: readonly string[], locale: string): string {
  const lang = locale === "vi" ? "vi" : "en";
  if (issueIds.length === 1) {
    return `${apiBaseUrl()}/api/v1/issues/${encodeURIComponent(issueIds[0])}/export/docx?lang=${lang}`;
  }
  const query = new URLSearchParams(issueIds.map((id) => ["ids", id]));
  query.set("lang", lang);
  return `${apiBaseUrl()}/api/v1/issues/export/docx?${query.toString()}`;
}

/**
 * Downloads issues as a Word document - title, details, description,
 * screenshots and shared notes - to hand to whoever will fix them. Several
 * issues share one file: a summary table, then a chapter per issue.
 * Internal notes stay out of the file. A plain link download, same as page
 * export: the session cookie authorizes it and the browser saves the
 * response.
 */
export function IssueExportButton({
  issueIds,
  className,
  size = "md",
  variant = "secondary",
  disabled,
}: {
  issueIds: readonly string[];
  className?: string;
  size?: "sm" | "md";
  variant?: "secondary" | "ghost";
  disabled?: boolean;
}) {
  const { t, locale } = useTranslation();

  function download() {
    if (issueIds.length === 0) return;
    const link = document.createElement("a");
    link.href = issueExportUrl(issueIds, locale);
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success(t("issues.exportPreparing"));
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      title={
        issueIds.length > 1
          ? t("issues.exportWordManyTip", { count: issueIds.length })
          : t("issues.exportWordTip")
      }
      disabled={disabled || issueIds.length === 0}
      onClick={download}
    >
      <FileDown /> {t("issues.exportWord")}
    </Button>
  );
}
