"use client";

import {
  BookOpen,
  FilePlus2,
  PenLine,
  Plug,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

const FEATURES: Array<{ icon: LucideIcon; key: string }> = [
  { icon: Sparkles, key: "ai.setup.featureSummary" },
  { icon: FilePlus2, key: "ai.setup.featureDraft" },
  { icon: BookOpen, key: "ai.setup.featureExplain" },
  { icon: PenLine, key: "ai.setup.featureWriting" },
];

const STEPS = ["ai.setup.step1", "ai.setup.step2", "ai.setup.step3"];

/**
 * What a person sees when the AI assistant has not been connected yet. An
 * administrator gets the three steps to turn it on (the button to the settings
 * sits in the dialog footer); everyone else only learns what it will unlock and
 * who to ask - they are never pointed at a settings page they cannot open.
 *
 * `stacked` is one centred column for a narrow dialog. `split` puts the message
 * on the left and the steps and features on the right, for a wide, short area
 * such as a dialog tab, where a tall column would not fit.
 */
export function AiNotSetUp({
  canConfigure,
  layout = "stacked",
}: {
  canConfigure: boolean;
  layout?: "stacked" | "split";
}) {
  const { t } = useTranslation();
  const split = layout === "split";

  const hero = (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="relative">
        <span className="bg-primary-subtle text-primary flex size-16 items-center justify-center rounded-2xl">
          <Sparkles className="size-8" aria-hidden />
        </span>
        <span className="border-surface bg-warning-bg text-warning absolute -right-2 -bottom-2 flex size-7 items-center justify-center rounded-full border-2">
          <Plug className="size-3.5" aria-hidden />
        </span>
      </span>
      <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
        {canConfigure ? t("ai.setup.adminLead") : t("ai.setup.userLead")}
      </p>
      {canConfigure ? null : (
        <p className="text-muted-foreground text-xs">
          {t("ai.setup.askAdmin")}
        </p>
      )}
    </div>
  );

  const details = (
    <div
      className={cn("w-full max-w-md space-y-4 text-left", split && "mx-auto")}
    >
      {canConfigure ? (
        <ol className="space-y-2">
          {STEPS.map((key, index) => (
            <li
              key={key}
              className="border-border bg-surface-sunken flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                {index + 1}
              </span>
              <span className="text-sm">{t(key)}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <div>
        <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.06em] uppercase">
          {t("ai.setup.featuresTitle")}
        </p>
        <ul className="grid gap-1.5">
          {FEATURES.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-center gap-2 text-sm">
              <Icon className="text-primary size-4 shrink-0" aria-hidden />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <div
      role="status"
      className={cn(
        "py-2",
        split
          ? "grid w-full items-center gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
          : "flex flex-col items-center gap-5",
      )}
    >
      {hero}
      {details}
    </div>
  );
}
