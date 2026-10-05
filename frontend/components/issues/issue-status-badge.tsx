"use client";

import { CheckCircle2, CircleDot, Timer, type LucideIcon } from "lucide-react";

import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { IssueStatus } from "@/types/api";

const STAGES: IssueStatus[] = ["open", "in_progress", "done"];

const LABEL: Record<IssueStatus, string> = {
  open: "issues.statusOpen",
  in_progress: "issues.statusInProgress",
  done: "issues.statusDone",
};

const LOOK: Record<
  IssueStatus,
  { icon: LucideIcon; pill: string; fill: string; text: string }
> = {
  open: {
    icon: CircleDot,
    pill: "border-warning/30 bg-warning-bg text-warning",
    fill: "bg-warning",
    text: "text-warning",
  },
  in_progress: {
    icon: Timer,
    pill: "border-primary/30 bg-primary-subtle text-primary",
    fill: "bg-primary",
    text: "text-primary",
  },
  done: {
    icon: CheckCircle2,
    pill: "border-success/30 bg-success-bg text-success",
    fill: "bg-success",
    text: "text-success",
  },
};

/** A rounded pill with the stage's icon, tinted for how far the issue has got. */
export function IssueStatusBadge({
  status,
  className,
}: {
  status: IssueStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const { icon: Icon, pill } = LOOK[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        pill,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(LABEL[status])}
    </span>
  );
}

/**
 * Where an issue is on its way - Open, In progress, Done - as three segments
 * that fill up to the current stage in that stage's colour. The compact form is
 * a thin bar for list rows; the full form names each stage underneath.
 */
export function IssueStatusBar({
  status,
  compact = false,
  className,
}: {
  status: IssueStatus;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const current = STAGES.indexOf(status);
  const { fill } = LOOK[status];
  return (
    <div
      role="img"
      aria-label={t("issues.statusStep", {
        status: t(LABEL[status]),
        step: current + 1,
        total: STAGES.length,
      })}
      className={cn(compact ? "w-24" : "w-full", className)}
    >
      <div className="flex gap-1">
        {STAGES.map((stage, index) => (
          <span
            key={stage}
            className={cn(
              "flex-1 rounded-full transition-colors duration-150",
              compact ? "h-1" : "h-1.5",
              index <= current ? fill : "bg-border",
            )}
          />
        ))}
      </div>
      {compact ? null : (
        <div className="mt-1.5 flex gap-1 text-[11px]">
          {STAGES.map((stage, index) => (
            <span
              key={stage}
              className={cn(
                "flex-1 first:text-left last:text-right [&:not(:first-child):not(:last-child)]:text-center",
                index === current
                  ? cn("font-semibold", LOOK[status].text)
                  : "text-muted-foreground",
              )}
            >
              {t(LABEL[stage])}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
