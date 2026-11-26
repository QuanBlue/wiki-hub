"use client";

import { useId, useState } from "react";

import { DeltaBadge } from "@/components/admin/statistics/hero-kpi-card";
import { niceMax } from "@/components/admin/statistics/trend-chart";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export interface StackedBarPoint {
  day: string;
  primary: number;
  secondary: number;
}

const WIDTH = 640;
const HEIGHT = 180;
const PAD = { top: 10, right: 0, bottom: 2, left: 0 };
const INTL_LOCALE: Record<string, string> = { en: "en-US", vi: "vi-VN" };

/**
 * Pure SVG daily stacked bar chart (e.g. AI Prompt vs Completion tokens).
 * Keyboard navigable with Left/Right/Escape and fully themed via semantic tokens.
 */
export function StackedBarChart({
  title,
  points,
  primaryLabel,
  secondaryLabel,
  delta,
}: {
  title: string;
  points: StackedBarPoint[];
  primaryLabel: string;
  secondaryLabel: string;
  delta?: number | null;
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

  const totals = points.map((p) => p.primary + p.secondary);
  const grandTotal = totals.reduce((sum, v) => sum + v, 0);
  const primaryTotal = points.reduce((sum, p) => sum + p.primary, 0);
  const secondaryTotal = points.reduce((sum, p) => sum + p.secondary, 0);
  const max = niceMax(Math.max(0, ...totals));
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const count = Math.max(1, points.length);
  const slotW = WIDTH / count;
  const barW = Math.max(2, Math.min(28, slotW * 0.68));

  const peakIndex = points.reduce(
    (best, _, i) => (totals[i]! > totals[best]! ? i : best),
    0,
  );
  const dailyAvg = points.length ? Math.round(grandTotal / points.length) : 0;

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

  return (
    <figure className="border-border bg-surface flex min-w-0 flex-col rounded-xl border p-4 shadow-sm">
      <figcaption className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs font-medium">
              {title}
            </span>
            <DeltaBadge delta={delta} />
          </div>
          <p className="text-foreground mt-1 text-2xl leading-7 font-semibold tracking-tight tabular-nums">
            {number.format(grandTotal)}
            <span className="text-muted-foreground ml-1.5 text-sm font-medium">
              {t(
                grandTotal === 1
                  ? "adminStats.unitToken"
                  : "adminStats.unitTokens",
              )}
            </span>
          </p>
        </div>

        <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs tabular-nums">
          <span className="flex items-center gap-1.5">
            <span className="bg-primary size-2.5 rounded-xs" aria-hidden="true" />
            {primaryLabel}:{" "}
            <strong className="text-foreground font-medium">
              {number.format(primaryTotal)}
            </strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="bg-info size-2.5 rounded-xs" aria-hidden="true" />
            {secondaryLabel}:{" "}
            <strong className="text-foreground font-medium">
              {number.format(secondaryTotal)}
            </strong>
          </span>
        </div>
      </figcaption>

      <div
        tabIndex={0}
        role="group"
        aria-label={`${title}. ${t("adminStats.chartTotal", { total: number.format(grandTotal) })}. ${t("adminStats.chartHint")}`}
        aria-describedby={active !== null ? `${id}-live` : undefined}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        className="focus-visible:ring-ring mt-3 rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <div className="relative h-44">
          {[0, 0.5, 1].map((fraction) => (
            <span
              key={fraction}
              aria-hidden="true"
              className="text-muted-foreground absolute left-0 w-10 -translate-y-1/2 pr-1 text-right text-[11px] tabular-nums"
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
            className="absolute inset-y-0 right-0 left-11 h-full w-[calc(100%-2.75rem)]"
            aria-hidden="true"
          >
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

            {points.map((point, i) => {
              const cx = i * slotW + slotW / 2;
              const bx = cx - barW / 2;
              const pH = (point.primary / max) * innerH;
              const sH = (point.secondary / max) * innerH;
              const baseY = PAD.top + innerH;
              const isHighlighted = active === i;

              return (
                <g key={point.day} opacity={active !== null && !isHighlighted ? 0.55 : 1}>
                  {isHighlighted ? (
                    <rect
                      x={i * slotW}
                      y={PAD.top}
                      width={slotW}
                      height={innerH}
                      className="fill-surface-hover"
                      opacity={0.7}
                    />
                  ) : null}
                  {pH > 0 ? (
                    <rect
                      x={bx}
                      y={baseY - pH}
                      width={barW}
                      height={pH}
                      rx={1.5}
                      className="fill-primary"
                    />
                  ) : null}
                  {sH > 0 ? (
                    <rect
                      x={bx}
                      y={baseY - pH - sH}
                      width={barW}
                      height={sH}
                      rx={1.5}
                      className="fill-info"
                    />
                  ) : null}
                  <rect
                    data-testid="stacked-bar-hit"
                    x={i * slotW}
                    y={0}
                    width={slotW}
                    height={HEIGHT}
                    fill="transparent"
                    onMouseEnter={() => setActive(i)}
                  />
                </g>
              );
            })}
          </svg>

          {active !== null && points[active] ? (
            <div
              id={`${id}-live`}
              role="status"
              className={cn(
                "border-border bg-surface-raised text-foreground pointer-events-none absolute top-2 z-10 rounded-lg border px-3 py-2 text-xs whitespace-nowrap shadow-md",
                (active + 0.5) / count > 0.65
                  ? "-translate-x-[calc(100%+10px)]"
                  : "translate-x-2.5",
              )}
              style={{
                left: `calc(2.75rem + (100% - 2.75rem) * ${(active + 0.5) / count})`,
              }}
            >
              <p className="text-muted-foreground mb-1 text-[11px] font-medium">
                {dayFormat.format(new Date(`${points[active].day}T00:00:00Z`))}
              </p>
              <ul className="space-y-0.5 tabular-nums">
                <li className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span className="bg-primary size-2 rounded-xs" />
                    {primaryLabel}
                  </span>
                  <span className="font-semibold">
                    {number.format(points[active].primary)}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span className="bg-info size-2 rounded-xs" />
                    {secondaryLabel}
                  </span>
                  <span className="font-semibold">
                    {number.format(points[active].secondary)}
                  </span>
                </li>
                <li className="border-border mt-1 flex items-center justify-between gap-4 border-t pt-1 font-semibold">
                  <span>{t("adminStats.colTokens")}</span>
                  <span>
                    {number.format(
                      points[active].primary + points[active].secondary,
                    )}
                  </span>
                </li>
              </ul>
            </div>
          ) : null}
        </div>

        <div className="text-muted-foreground mt-1.5 flex justify-between pl-11 text-[11px]">
          <span>
            {points.length
              ? dayFormat.format(new Date(`${points[0].day}T00:00:00Z`))
              : ""}
          </span>
          {points.length > 4 ? (
            <span>
              {dayFormat.format(
                new Date(
                  `${points[Math.floor(points.length / 2)].day}T00:00:00Z`,
                ),
              )}
            </span>
          ) : null}
          <span>
            {points.length
              ? dayFormat.format(
                  new Date(`${points[points.length - 1].day}T00:00:00Z`),
                )
              : ""}
          </span>
        </div>
      </div>

      <p className="text-muted-foreground border-border mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 border-t pt-2.5 text-xs tabular-nums">
        <span>
          {t("adminStats.chartAverage", { value: number.format(dailyAvg) })}
        </span>
        {points.length ? (
          <span className="ml-auto">
            {t("adminStats.chartPeak", {
              value: number.format(totals[peakIndex]!),
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
