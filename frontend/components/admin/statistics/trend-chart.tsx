"use client";

import { useId, useState } from "react";

import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export interface TrendPoint {
  /** ISO date (YYYY-MM-DD). */
  day: string;
  value: number;
}

const WIDTH = 600;
const HEIGHT = 160;
const PAD = { top: 8, right: 0, bottom: 8, left: 0 };

const INTL_LOCALE: Record<string, string> = { en: "en-US", vi: "vi-VN" };

/** A round upper bound so the tallest point never touches the top edge. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = value / magnitude;
  const rounded = step <= 1 ? 1 : step <= 2 ? 2 : step <= 5 ? 5 : 10;
  return rounded * magnitude;
}

/** Change from the first half of a series to the second, as a percentage; null when the first half is empty. */
export function halfDelta(values: number[]): number | null {
  const middle = Math.floor(values.length / 2);
  const earlier = values
    .slice(0, middle)
    .reduce((sum, value) => sum + value, 0);
  const later = values
    .slice(values.length - middle)
    .reduce((sum, value) => sum + value, 0);
  return earlier === 0 ? null : Math.round(((later - earlier) / earlier) * 100);
}

/**
 * A single-series daily line chart drawn as SVG with semantic colour tokens.
 * Keyboard users read it point by point with the arrow keys (the chart is a
 * focusable group); pointer users hover. The headline total is always in the
 * accessible name, so a screen reader gets the answer without the drawing.
 */
export function TrendChart({
  title,
  points,
  tone = "primary",
  unit,
}: {
  title: string;
  /** The noun for a count of this series (\"views\"), singular or plural to match. */
  unit?: (count: number) => string;
  points: TrendPoint[];
  tone?: "primary" | "info" | "success" | "warning";
}) {
  const { t, locale } = useTranslation();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);

  const number = new Intl.NumberFormat(INTL_LOCALE[locale] ?? "en-US");
  const dayFormat = new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const max = niceMax(Math.max(0, ...points.map((point) => point.value)));
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left +
    (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (value: number) => PAD.top + innerH - (value / max) * innerH;

  const delta = halfDelta(points.map((point) => point.value));
  const average = points.length ? total / points.length : 0;
  const peakIndex = points.reduce(
    (best, point, index) => (point.value > points[best]!.value ? index : best),
    0,
  );
  const gradientId = `${id}-fill`;

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`)
    .join(" ");
  const area = points.length
    ? `${line} L${x(points.length - 1)},${PAD.top + innerH} L${x(0)},${PAD.top + innerH} Z`
    : "";

  const label = (i: number) =>
    t("adminStats.chartPoint", {
      day: dayFormat.format(new Date(`${points[i].day}T00:00:00Z`)),
      value: number.format(points[i].value),
      unit: unit ? ` ${unit(points[i].value)}` : "",
    });

  function onKeyDown(event: React.KeyboardEvent) {
    if (!points.length) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActive((current) => Math.min(points.length - 1, (current ?? -1) + 1));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActive((current) => Math.max(0, (current ?? points.length) - 1));
    } else if (event.key === "Escape") {
      setActive(null);
    }
  }

  const textClass = {
    primary: "text-primary",
    info: "text-info",
    success: "text-success",
    warning: "text-warning",
  }[tone];

  return (
    <figure className="border-border bg-surface min-w-0 rounded-xl border p-4 shadow-sm">
      <figcaption className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-muted-foreground block text-xs font-medium">
            {title}
          </span>
          <span className="text-foreground mt-1 block text-2xl leading-7 font-semibold tracking-tight tabular-nums">
            {number.format(total)}
            {unit ? (
              <span className="text-muted-foreground ml-1.5 text-sm font-medium">
                {unit(total)}
              </span>
            ) : null}
          </span>
        </div>
        {delta !== null ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums",
              delta > 0 && "bg-success-bg text-success",
              delta < 0 && "bg-danger-bg text-danger",
              delta === 0 && "bg-surface-sunken text-muted-foreground",
            )}
          >
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"} {Math.abs(delta)}%
            <span className="sr-only">{t("adminStats.chartDeltaHint")}</span>
          </span>
        ) : null}
      </figcaption>
      <div
        tabIndex={0}
        role="group"
        aria-label={`${title}. ${t("adminStats.chartTotal", { total: number.format(total) })}. ${t("adminStats.chartHint")}`}
        aria-describedby={active !== null ? `${id}-live` : undefined}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        className="focus-visible:ring-ring mt-2 rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <div className="relative h-36">
          {[0, 0.5, 1].map((fraction) => (
            <span
              key={fraction}
              aria-hidden="true"
              className="text-muted-foreground absolute left-0 w-8 -translate-y-1/2 pr-1 text-right text-[11px] tabular-nums"
              style={{
                top: `${((PAD.top + innerH * (1 - fraction)) / HEIGHT) * 100}%`,
              }}
            >
              {number.format(Math.round(max * fraction))}
            </span>
          ))}
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className={cn(
              "absolute inset-y-0 right-0 left-9 h-full w-[calc(100%-2.25rem)]",
              textClass,
            )}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
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
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {area ? <path d={area} fill={`url(#${gradientId})`} /> : null}
            {line ? (
              <path
                d={line}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {points.map((point, i) => (
              <rect
                key={point.day}
                data-testid="trend-hit"
                x={x(i) - innerW / Math.max(1, points.length - 1) / 2}
                y={0}
                width={innerW / Math.max(1, points.length - 1)}
                height={HEIGHT}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
              />
            ))}
            {active !== null && points[active] ? (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={PAD.top + innerH}
                className="stroke-border-strong"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          {active !== null && points[active] ? (
            <span
              aria-hidden="true"
              className={cn(
                "border-surface absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-current",
                textClass,
              )}
              style={{
                left: `calc(2.25rem + (100% - 2.25rem) * ${x(active) / WIDTH})`,
                top: `${(y(points[active].value) / HEIGHT) * 100}%`,
              }}
            />
          ) : null}
          {active !== null && points[active] ? (
            <span
              id={`${id}-live`}
              role="status"
              className={cn(
                "border-border bg-surface text-foreground pointer-events-none absolute z-10 -translate-y-full rounded-md border px-2.5 py-1.5 whitespace-nowrap shadow-md",
                x(active) / WIDTH > 0.75
                  ? "-translate-x-full"
                  : x(active) / WIDTH < 0.25
                    ? "translate-x-0"
                    : "-translate-x-1/2",
              )}
              style={{
                left: `calc(2.25rem + (100% - 2.25rem) * ${x(active) / WIDTH})`,
                top: `calc(${(y(points[active].value) / HEIGHT) * 100}% - 10px)`,
              }}
            >
              <span className="sr-only">{label(active)}</span>
              <span
                aria-hidden="true"
                className="text-muted-foreground block text-[11px] leading-4 font-normal"
              >
                {dayFormat.format(new Date(`${points[active].day}T00:00:00Z`))}
              </span>
              <span
                aria-hidden="true"
                className="block text-sm leading-5 font-semibold tabular-nums"
              >
                {number.format(points[active].value)}
                {unit ? (
                  <span className="text-muted-foreground ml-1 text-xs font-medium">
                    {unit(points[active].value)}
                  </span>
                ) : null}
              </span>
            </span>
          ) : null}
        </div>
        <div className="text-muted-foreground mt-1 flex justify-between pl-9 text-[11px]">
          <span>
            {points.length
              ? dayFormat.format(new Date(`${points[0].day}T00:00:00Z`))
              : ""}
          </span>
          <span>
            {points.length
              ? dayFormat.format(
                  new Date(`${points[points.length - 1].day}T00:00:00Z`),
                )
              : ""}
          </span>
        </div>
      </div>
      <p className="text-muted-foreground border-border mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 border-t pt-2.5 text-xs">
        <span>
          {t("adminStats.chartAverage", {
            value: number.format(Math.round(average)),
          })}
        </span>
        {points.length ? (
          <span>
            {t("adminStats.chartPeak", {
              value: number.format(points[peakIndex]!.value),
              day: dayFormat.format(
                new Date(`${points[peakIndex]!.day}T00:00:00Z`),
              ),
            })}
          </span>
        ) : null}
      </p>
    </figure>
  );
}
