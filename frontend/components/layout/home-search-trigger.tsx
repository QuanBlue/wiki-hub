"use client";

import { ArrowRight, Search } from "lucide-react";
import { useState } from "react";

import { SearchModal } from "@/components/layout/search-modal";
import { useTranslation } from "@/lib/i18n/context";

export function HomeSearchTrigger() {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-primary hover:text-primary-hover flex w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("homeSearch.findKnowledgeAria")}
      >
        <Search className="size-3.5" />
        {t("homeSearch.findKnowledge")}
        <ArrowRight className="ml-auto size-3.5" />
      </button>
      <SearchModal open={open} onOpenChange={setOpen} />
    </>
  );
}
