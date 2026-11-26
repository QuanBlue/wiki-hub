"use client";

import { useId, useState } from "react";

import { DeltaBadge } from "@/components/admin/statistics/hero-kpi-card";
import { niceMax } from "@/components/admin/statistics/trend-chart";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export interface MultiTrendSeries {
  key: string;
  label: string;
  tone: "primary" | "info" | "success" | "warning";
  points: Array<{ day: string; value: number }>;
  /** Format a point or headline value; defaults to rounded whole number. */
  format?: (value: number) => string;
  /** Format the narrow Y-axis labels; defaults to `format`. */
  axisFormat?: (value: number) => string;
  /** If provided, shown as the series headline instead of sum(points). */
  average?: number;
  /** Unit noun for tooltips and headline. */
  unit?: (count: number) => string;
  /** Real period-over-period percentage delta. */
  delta?: number | null;
}

const WIDTH = 640;
const HEIGHT = 180;
const PAD = { top: 10, right: 0, bottom: 8, left: 0 };
const INTL_LOCALE: Record<string, string> = { en: "en-US", vi: "vi-VN" };

const TONE_TEXT: Record<MultiTrendSeries["tone"], string> = {
  primary: "text-primary",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
};

const TONE_DOT: Record<MultiTrendSeries["tone"], string> = {
  primary: "bg-primary",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
};

/**
 * Interactive multi-series SVG area/line chart.
 * Users can toggle individual series on/off (at least one stays active).
 * When multiple series have incompatible units (`independentScale`), each
 * overlaid series scales to its own peak and the tooltip prints every active
 * series' exact formatted value.
 */
export function MultiTrendChart({
  title,
  series,
  initialActiveKeys,
  independentScale = false,
}: {
  title: string;
  series: MultiTrendSeries[];
  initialActiveKeys?: string[];
  /** True when series use different units (e.g. people vs minutes). */
  independentScale?: boolean;
}) {
  const { t, locale } = useTranslation();
  const id = useId();
  const defaultKeys =
    initialActiveKeys && initialActiveKeys.length > 0
      ? initialActiveKeys
      : series.length > 0
        ? [series[0].key]
        : [];
  const [activeKeys, setActiveKeys] = useState<string[]>(defaultKeys);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const number = new Intl.NumberFormat(INTL_LOCALE[locale] ?? "en-US");
  const dayFormat = new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  const activeSeries = series.filter((s) => activeKeys.includes(s.key));
  const primary = activeSeries[0] ?? series[0];
  const pointCount = primary?.points.length ?? 0;

  function toggleSeries(key: string) {
    setActiveKeys((prev) => {
      if (prev.includes(key)) {
        // Keep at least one series active
        if (prev.length === 1) return prev;
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  }

  const formatOf = (s: MultiTrendSeries) =>
    s.format ?? ((v: number) => number.format(Math.round(v)));

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left +
    (pointCount <= 1 ? innerW / 2 : (i / (pointCount - 1)) * innerW);

  const sharedMax = niceMax(
    Math.max(
      0,
      ...activeSeries.flatMap((s) => s.points.map((p) => p.value)),
    ),
  );

  const maxFor = (s: MultiTrendSeries) =>
    independentScale && activeSeries.length > 1
      ? niceMax(Math.max(0, ...s.points.map((p) => p.value)))
      : sharedMax;

  const yFor = (s: MultiTrendSeries, value: number) => {
    const max = maxFor(s);
    return PAD.top + innerH - (value / max) * innerH;
  };

  function onKeyDown(event: React.KeyboardEvent) {
    if (!pointCount) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setHoverIndex((current) => Math.min(pointCount - 1, (current ?? -1) + 1));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setHoverIndex((current) => Math.max(0, (current ?? pointCount) - 1));
    } else if (event.key === "Escape") {
      setHoverIndex(null);
    }
  }

  if (!primary) return null;

  const primaryFormat = formatOf(primary);
  const primaryTotal = primary.points.reduce((sum, p) => sum + p.value, 0);
  const primaryHeadline = primary.average ?? primaryTotal;
  const primaryDailyAvg = pointCount ? primaryTotal / pointCount : 0;
  const peakIndex = primary.points.reduce(
    (best, point, idx) =>
      point.value > primary.points[best]!.value ? idx : best,
    0,
  );
  const showAxis = !(independentScale && activeSeries.length > 1);
  const axisMax = maxFor(primary);
  const axisFormat = primary.axisFormat ?? primaryFormat;

  const ariaSummary = activeSeries
    .map((s) => {
      const fmt = formatOf(s);
      const total = s.points.reduce((sum, p) => sum + p.value, 0);
      return `${s.label}: ${s.average !== undefined ? t("adminStats.chartAverageName", { value: fmt(s.average) }) : t("adminStats.chartTotal", { total: fmt(total) })}`;
    })
    .join("; ");

  return (
    <figure className="border-border bg-surface flex min-w-0 flex-col rounded-xl border p-4 shadow-sm">
      <figcaption className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs font-medium">
              {title}
            </span>
            <DeltaBadge delta={primary.delta} />
          </div>
          <div className="text-foreground mt-1 flex flex-wrap items-baseline gap-x-1.5 text-2xl leading-7 font-semibold tracking-tight tabular-nums">
            <span>{primaryFormat(primaryHeadline)}</span>
            {primary.unit ? (
              <span className="text-muted-foreground text-sm font-medium">
                {primary.unit(primaryHeadline)}
              </span>
            ) : null}
            {primary.average !== undefined ? (
              <span className="text-muted-foreground text-sm font-medium">
                {t("adminStats.chartOnAverage")}
              </span>
            ) : null}
          </div>
        </div>

        <div
          role="group"
          aria-label={t("adminStats.seriesToggle")}
          className="flex flex-wrap items-center gap-1"
        >
          {series.map((s) => {
            const selected = activeKeys.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleSeries(s.key)}
                className={cn(
                  "focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  selected
                    ? "border-border-strong bg-surface-selected text-foreground hover:bg-surface-selected-hover"
                    : "border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground opacity-75",
                )}
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    selected ? TONE_DOT[s.tone] : "bg-muted-foreground/40",
                  )}
                  aria-hidden="true"
                />
                {s.label}
              </button>
            );
          })}
        </div>
      </figcaption>

      <div
        tabIndex={0}
        role="group"
        aria-label={`${title}. ${ariaSummary}. ${t("adminStats.chartHint")}`}
        aria-describedby={hoverIndex !== null ? `${id}-live` : undefined}
        onKeyDown={onKeyDown}
        onBlur={() => setHoverIndex(null)}
        onMouseLeave={() => setHoverIndex(null)}
        className="focus-visible:ring-ring mt-3 rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <div className="relative h-44">
          {showAxis
            ? [0, 0.5, 1].map((fraction) => (
                <span
                  key={fraction}
                  aria-hidden="true"
                  className="text-muted-foreground absolute left-0 w-9 -translate-y-1/2 pr-1 text-right text-[11px] tabular-nums"
                  style={{
                    top: `${((PAD.top + innerH * (1 - fraction)) / HEIGHT) * 100}%`,
                  }}
                >
                  {axisFormat(axisMax * fraction)}
                </span>
              ))
            : null}

          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className={cn(
              "absolute inset-y-0 right-0 h-full",
              showAxis ? "left-10 w-[calc(100%-2.5rem)]" : "left-0 w-full",
            )}
            aria-hidden="true"
          >
            <defs>
              {activeSeries.map((s) => (
                <linearGradient
                  key={s.key}
                  id={`${id}-fill-${s.key}`}
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor="currentColor"
                    stopOpacity={activeSeries.length === 1 ? 0.24 : 0.12}
                  />
                  <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>

            {[0, 0.5, 1].map((fraction) => (
              <line
                key={fraction}
                x1={0}
                x2={WIDTH}
                y1={PAD.top + innerH * fraction}
                y2={PAD.top + innerH * fraction}
                className="stroke-border"
                strokeWidth={1}
                strokeDasharray={fraction === 1 ? undefined : "3 3"}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {activeSeries.map((s) => {
              if (s.points.length === 0) return null;
              const line = s.points
                .map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${yFor(s, p.value)}`)
                .join(" ");
              const area = `${line} L${x(s.points.length - 1)},${PAD.top + innerH} L${x(0)},${PAD.top + innerH} Z`;
              return (
                <g key={s.key} className={TONE_TEXT[s.tone]}>
                  <path d={area} fill={`url(#${id}-fill-${s.key})`} />
                  <path
                    d={line}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}

            {primary.points.map((point, i) => (
              <rect
                key={point.day}
                data-testid="multi-trend-hit"
                x={x(i) - innerW / Math.max(1, pointCount - 1) / 2}
                y={0}
                width={innerW / Math.max(1, pointCount - 1)}
                height={HEIGHT}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
              />
            ))}

            {hoverIndex !== null && primary.points[hoverIndex] ? (
              <line
                x1={x(hoverIndex)}
                x2={x(hoverIndex)}
                y1={PAD.top}
                y2={PAD.top + innerH}
                className="stroke-border-strong"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>

          {hoverIndex !== null && primary.points[hoverIndex]
            ? activeSeries.map((s) => {
                const pt = s.points[hoverIndex];
                if (!pt) return null;
                const leftExpr = showAxis
                  ? `calc(2.5rem + (100% - 2.5rem) * ${x(hoverIndex) / WIDTH})`
                  : `${(x(hoverIndex) / WIDTH) * 100}%`;
                return (
                  <span
                    key={s.key}
                    aria-hidden="true"
                    className={cn(
                      "border-surface pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-current",
                      TONE_TEXT[s.tone],
                    )}
                    style={{
                      left: leftExpr,
                      top: `${(yFor(s, pt.value) / HEIGHT) * 100}%`,
                    }}
                  />
                );
              })
            : null}

          {hoverIndex !== null && primary.points[hoverIndex] ? (
            <div
              id={`${id}-live`}
              role="status"
              className={cn(
                "border-border bg-surface-raised text-foreground pointer-events-none absolute top-2 z-10 rounded-lg border px-3 py-2 text-xs whitespace-nowrap shadow-md",
                x(hoverIndex) / WIDTH > 0.65
                  ? "-translate-x-[calc(100%+10px)]"
                  : "translate-x-2.5",
              )}
              style={{
                left: showAxis
                  ? `calc(2.5rem + (100% - 2.5rem) * ${x(hoverIndex) / WIDTH})`
                  : `${(x(hoverIndex) / WIDTH) * 100}%`,
              }}
            >
              <p className="text-muted-foreground mb-1 text-[11px] font-medium">
                {dayFormat.format(
                  new Date(`${primary.points[hoverIndex].day}T00:00:00Z`),
                )}
              </p>
              <ul className="space-y-0.5">
                {activeSeries.map((s) => {
                  const pt = s.points[hoverIndex];
                  if (!pt) return null;
                  const fmt = formatOf(s);
                  return (
                    <li
                      key={s.key}
                      className="flex items-center justify-between gap-4 tabular-nums"
                    >
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <span
                          className={cn("size-2 rounded-full", TONE_DOT[s.tone])}
                          aria-hidden="true"
                        />
                        {s.label}
                      </span>
                      <span className="font-semibold">
                        {fmt(pt.value)}
                        {s.unit ? ` ${s.unit(pt.value)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            "text-muted-foreground mt-1.5 flex justify-between text-[11px]",
            showAxis && "pl-10",
          )}
        >
          <span>
            {pointCount
              ? dayFormat.format(new Date(`${primary.points[0].day}T00:00:00Z`))
              : ""}
          </span>
          {pointCount > 4 ? (
            <span>
              {dayFormat.format(
                new Date(
                  `${primary.points[Math.floor(pointCount / 2)].day}T00:00:00Z`,
                ),
              )}
            </span>
          ) : null}
          <span>
            {pointCount
              ? dayFormat.format(
                  new Date(`${primary.points[pointCount - 1].day}T00:00:00Z`),
                )
              : ""}
          </span>
        </div>
      </div>

      <p className="text-muted-foreground border-border mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-2.5 text-xs">
        {primary.average === undefined ? (
          <span>
            {t("adminStats.chartAverage", {
              value: primaryFormat(primaryDailyAvg),
            })}
          </span>
        ) : (
          <span>
            {independentScale && activeSeries.length > 1
              ? t("adminStats.independentScaleNote")
              : primary.label}
          </span>
        )}
        {pointCount > 0 ? (
          <span className="ml-auto tabular-nums">
            {t("adminStats.chartPeak", {
              value: primaryFormat(primary.points[peakIndex]!.value),
              day: dayFormat.format(
                new Date(`${primary.points[peakIndex]!.day}T00:00:00Z`),
              ),
            })}
          </span>
        ) : null}
      </p>
    </figure>
  );
}
