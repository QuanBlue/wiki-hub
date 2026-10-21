"use client";

import { Network } from "lucide-react";
import { useState } from "react";

import { SpaceGraphDialog } from "@/components/pages/space-graph";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";

/** Opens the page map of every space, for a page that is otherwise server-rendered. */
export function PageMapButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="md"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Network />
        {t("graph.mapLink")}
      </Button>
      <SpaceGraphDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
