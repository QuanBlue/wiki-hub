"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/lib/i18n/context";

/**
 * A small "i" button that explains a field on hover or keyboard focus, so the
 * explanation does not take up permanent room under the input. Put it next to
 * the field's label.
 */
export function InfoTip({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("common.moreInfo")}
            className="text-muted-foreground hover:text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring inline-flex size-5 cursor-help items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent>{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
