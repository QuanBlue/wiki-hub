"use client";

import type { LucideIcon } from "lucide-react";
import { useId } from "react";

import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export type KpiTone = "primary" | "success" | "warning" | "info" | "neutral";

export interface HeroKpiSplit {
  leftLabel: string;
  leftPercent: number;
  rightLabel: string;
  rightPercent: number;
}

export interface HeroKpiCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  /** Percentage change vs previous equal-length period; null hides badge. */
  delta?: number | null;
  tone?: KpiTone;
  /** Optional daily series rendered as a subtle sparkline. */
  sparkline?: number[];
  /** Optional horizontal split bar (e.g. Prompt vs Completion tokens). */
  split?: HeroKpiSplit;
}

const ICON_TONE: Record<KpiTone, string> = {
  primary: "bg-primary-subtle text-primary",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  info: "bg-info-bg text-info",
  neutral: "bg-surface-sunken text-muted-foreground",
};

const SPARK_TONE: Record<KpiTone, string> = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
  neutral: "text-muted-foreground",
};

function Sparkline({
  values,
  tone,
}: {
  values: number[];
  tone: KpiTone;
}) {
  const id = useId();
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 32;
  const padY = 3;
  const innerH = h - padY * 2;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = padY + innerH - (v / max) * innerH;
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const gradId = `${id}-spark`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("h-8 w-24 shrink-0", SPARK_TONE[tone])}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function DeltaBadge({
  delta,
  hint,
}: {
  delta: number | null | undefined;
  hint?: string;
}) {
  const { t } = useTranslation();
  if (delta === null || delta === undefined) return null;
  return (
    <span
      title={hint ?? t("adminStats.vsPreviousPeriod")}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
        delta > 0 && "bg-success-bg text-success",
        delta < 0 && "bg-danger-bg text-danger",
        delta === 0 && "bg-surface-sunken text-muted-foreground",
      )}
    >
      <span aria-hidden="true">
        {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"}
      </span>
      {Math.abs(delta)}%
      <span className="sr-only">
        {" "}
        {hint ?? t("adminStats.vsPreviousPeriod")}
      </span>
    </span>
  );
}

/**
 * Primary headline KPI card with semantic icon badge, tabular figure, real
 * period-over-period delta badge, and optional inline sparkline or split bar.
 */
export function HeroKpiCard({
  icon: Icon,
  label,
  value,
  hint,
  delta,
  tone = "primary",
  sparkline,
  split,
}: HeroKpiCardProps) {
  return (
    <div className="border-border bg-surface flex min-w-0 flex-col justify-between gap-3 rounded-xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md",
              ICON_TONE[tone],
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
          <span className="text-muted-foreground truncate text-xs font-medium">
            {label}
          </span>
        </div>
        <DeltaBadge delta={delta} />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-foreground text-2xl leading-7 font-semibold tracking-tight tabular-nums">
            {value}
          </p>
          <p className="text-muted-foreground mt-1 truncate text-xs">{hint}</p>
        </div>
        {sparkline && sparkline.length >= 2 ? (
          <Sparkline values={sparkline} tone={tone} />
        ) : null}
      </div>

      {split ? (
        <div className="space-y-1">
          <div className="bg-surface-sunken flex h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full transition-[width] duration-150"
              style={{ width: `${Math.max(0, Math.min(100, split.leftPercent))}%` }}
            />
            <div
              className="bg-info h-full transition-[width] duration-150"
              style={{
                width: `${Math.max(0, Math.min(100, split.rightPercent))}%`,
              }}
            />
          </div>
          <div className="text-muted-foreground flex items-center justify-between gap-2 text-[11px] tabular-nums">
            <span className="flex items-center gap-1 truncate">
              <span className="bg-primary size-1.5 shrink-0 rounded-full" />
              {split.leftLabel} ({split.leftPercent}%)
            </span>
            <span className="flex items-center gap-1 truncate">
              <span className="bg-info size-1.5 shrink-0 rounded-full" />
              {split.rightLabel} ({split.rightPercent}%)
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
