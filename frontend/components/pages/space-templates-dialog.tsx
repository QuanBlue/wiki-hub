"use client";

import { TemplateManager } from "@/components/templates/template-manager";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useTranslation } from "@/lib/i18n/context";
import type { Space } from "@/types/api";

export function SpaceTemplatesDialog({
  space,
  open,
  onOpenChange,
}: {
  space: Space;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent
          className="max-w-5xl"
          title={t("templates.spaceTitle")}
          description={t("templates.spaceDescription", { space: space.name })}
        >
          <TemplateManager mode="space" spaceKey={space.key} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
