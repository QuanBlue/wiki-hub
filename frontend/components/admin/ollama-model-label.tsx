"use client";

import { Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/lib/i18n/context";

/** Which description belongs to which model: by name without the tag ("bge-m3:latest" is "bge-m3"). */
const INFO_KEYS: Record<string, string> = {
  "bge-m3": "adminAi.modelInfo_bgeM3",
  "snowflake-arctic-embed2": "adminAi.modelInfo_snowflake",
  "granite-embedding": "adminAi.modelInfo_granite",
  "nomic-embed-text": "adminAi.modelInfo_nomic",
};

/**
 * One self-hosted model in the list: its name, whether it is already on the server, and an
 * "i" that says on hover what the model is good at and when to pick it. The "i" is not a
 * button: the whole row is the option, and a button inside an option cannot be reached by
 * keyboard in a sensible way.
 */
export function OllamaModelLabel({
  name,
  downloaded,
}: {
  name: string;
  downloaded: boolean;
}) {
  const { t } = useTranslation();
  const key = INFO_KEYS[name.split(":")[0]!];
  return (
    <span className="flex w-full items-center gap-2">
      <span className="font-mono text-xs">{name}</span>
      <Badge variant={downloaded ? "success" : "neutral"}>
        {downloaded
          ? t("adminAi.modelDownloaded")
          : t("adminAi.modelNotDownloaded")}
      </Badge>
      {key ? (
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="text-muted-foreground hover:text-foreground hover:bg-surface-hover ml-auto inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-full transition-colors duration-150"
                aria-label={t("common.moreInfo")}
              >
                <Info className="size-3.5" aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" className="z-[110] max-w-xs">
              {t(key)}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </span>
  );
}
