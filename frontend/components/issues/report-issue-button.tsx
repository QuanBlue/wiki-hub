"use client";

import { Bug } from "lucide-react";
import { useState } from "react";

import { ReportIssueDialog } from "@/components/issues/report-issue-dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";

/** A button that opens the "report an issue" dialog. */
export function ReportIssueButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        <Bug /> {t("issues.reportButton")}
      </Button>
      <ReportIssueDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
