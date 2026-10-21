"use client";

import { Cpu, MemoryStick } from "lucide-react";
import { useMemo, useState } from "react";

import { formatBytes } from "@/components/ui/job-progress";
import type { ContainerInfo, HostInfo } from "@/lib/admin-monitor";
import { useTranslation } from "@/lib/i18n/context";
import {
  buildUsage,
  ringArc,
  type UsageChart,
  type UsageSlice,
} from "@/lib/monitor-usage";
import { cn } from "@/lib/utils";

type Scope = "whole" | "among";

const SIZE = 230;
const RING = 28;
const RADIUS = (SIZE - RING) / 2;
/** A gap of this many pixels of arc between slices, so neighbours never touch. */
const GAP_PX = 2;

/** The colour of a slice: one of the series for a container, a grey for the rest. */
function colourOf(slice: UsageSlice): string {
  if (slice.kind === "container" && slice.slot !== null)
    return `var(--chart-${slice.slot + 1})`;
  if (slice.kind === "others") return "var(--chart-other)";
  if (slice.kind === "system") return "var(--chart-system)";
  return "var(--surface-sunken)";
}

function percentText(share: number): string {
  const percent = share * 100;
  if (percent > 0 && percent < 0.1) return "<0.1%";
  return `${percent.toFixed(percent < 10 ? 1 : 0)}%`;
}

function Donut({
  chart,
  active,
  onActive,
  centre,
  ariaLabel,
}: {
  chart: UsageChart;
  active: string | null;
  onActive: (key: string | null) => void;
  centre: { value: string; caption: string };
  ariaLabel: string;
}) {
  const circumference = 2 * Math.PI * RADIUS;
  const gapTurns = GAP_PX / circumference;
  // Where each slice begins: the shares before it, added up.
  const arcs = chart.slices.map((slice, index) => {
    const from = chart.slices
      .slice(0, index)
      .reduce((sum, earlier) => sum + earlier.share, 0);
    return { slice, from, to: from + slice.share };
  });
  return (
    <div className="relative mx-auto size-44 shrink-0 @xl:size-57.5">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={ariaLabel}
        className="size-full"
      >
        {/* The track: what is left of the ring when nothing is drawn on it. */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--surface-sunken)"
          strokeWidth={RING}
        />
        {arcs.map(({ slice, from, to }) => {
          const dimmed = active !== null && active !== slice.key;
          const common = {
            fill: "none",
            stroke: colourOf(slice),
            strokeWidth: active === slice.key ? RING + 4 : RING,
            opacity: dimmed ? 0.3 : 1,
            className: "cursor-default transition-opacity duration-150",
            onPointerEnter: () => onActive(slice.key),
            onPointerLeave: () => onActive(null),
          };
          // A slice that is the whole ring is a circle: an arc cannot close on itself.
          if (to - from >= 0.9999) {
            return (
              <circle
                key={slice.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                {...common}
              />
            );
          }
          const gap = arcs.length > 1 ? Math.min(gapTurns, (to - from) / 3) : 0;
          return (
            <path
              key={slice.key}
              d={ringArc(RADIUS, from + gap / 2, to - gap / 2, SIZE / 2)}
              {...common}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-12 text-center">
        <span className="text-xl font-semibold tabular-nums">
          {centre.value}
        </span>
        <span className="text-muted-foreground line-clamp-2 text-[11px] leading-tight break-words">
          {centre.caption}
        </span>
      </div>
    </div>
  );
}

/** One chart with its legend: every slice named, with its figure and its share of the whole. */
function UsageCard({
  icon: Icon,
  title,
  charts,
  format,
  totalLabel,
  usedLabel,
}: {
  icon: typeof Cpu;
  title: string;
  /** Against the whole server, and among the containers alone. */
  charts: Record<Scope, UsageChart>;
  format: (value: number) => string;
  totalLabel: string;
  usedLabel: string;
}) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<Scope>("whole");
  const [active, setActive] = useState<string | null>(null);
  const chart = charts[scope];
  const shown = chart.slices.find((slice) => slice.key === active) ?? null;
  // Among the containers alone, the middle says how much they use together.
  const centre = shown
    ? {
        value: percentText(shown.share),
        caption: `${shown.label} · ${format(shown.value)}`,
      }
    : scope === "whole"
      ? { value: percentText(chart.used / chart.total), caption: usedLabel }
      : { value: format(chart.used), caption: t("adminMonitor.usageInTotal") };
  return (
    <div className="border-border bg-surface @container min-w-0 space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
          <Icon className="size-4" aria-hidden />
          {title}
          <span className="font-normal tabular-nums">{totalLabel}</span>
        </div>
        <div
          role="group"
          aria-label={t("adminMonitor.usageScope")}
          className="bg-surface-sunken border-border inline-flex shrink-0 gap-0.5 rounded-md border p-0.5"
        >
          {(["whole", "among"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={scope === option}
              onClick={() => {
                setScope(option);
                setActive(null);
              }}
              className={cn(
                "focus-visible:ring-ring cursor-pointer rounded-sm px-2 py-1 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                scope === option
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-hover active:bg-surface-selected",
              )}
            >
              {t(
                option === "whole"
                  ? "adminMonitor.usageScopeWhole"
                  : "adminMonitor.usageScopeAmong",
              )}
            </button>
          ))}
        </div>
      </div>
      {chart.slices.length === 0 ? null : (
        <div className="flex flex-col items-center gap-4 @md:flex-row @md:items-center @md:justify-center">
          <Donut
            chart={chart}
            active={active}
            onActive={setActive}
            centre={centre}
            ariaLabel={
              scope === "whole"
                ? `${title}: ${usedLabel} ${percentText(chart.used / chart.total)}`
                : `${title}: ${t("adminMonitor.usageScopeAmong")}`
            }
          />
          <ul className="w-full min-w-0 text-[13px] leading-5 @md:max-w-96 @md:flex-1">
            {chart.slices.map((slice) => (
              <li key={slice.key}>
                <button
                  type="button"
                  aria-pressed={active === slice.key}
                  onPointerEnter={() => setActive(slice.key)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(slice.key)}
                  onBlur={() => setActive(null)}
                  className={cn(
                    "hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex w-full cursor-default items-center gap-2 rounded-sm px-1.5 py-px text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    active === slice.key && "bg-surface-hover",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      slice.kind === "free" && "border-border-strong border",
                    )}
                    style={{ background: colourOf(slice) }}
                  />
                  <span className="min-w-0 flex-1 truncate" title={slice.label}>
                    {slice.label}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {format(slice.value)}
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums">
                    {percentText(slice.share)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Two donut charts under the host figures: how much of the server's memory, and of its
 * CPU, each container takes. A slice is read against the whole machine, so what the
 * containers leave over - the system's own use, and what is free - has a slice too.
 * Colours follow the container, not its rank: it keeps its colour as others overtake it.
 */
export function UsageDonuts({
  host,
  containers,
}: {
  host: HostInfo;
  containers: ContainerInfo[];
}) {
  const { t } = useTranslation();

  const { memory, cpu } = useMemo(() => {
    const running = containers.filter((c) => c.state === "running");
    const common = {
      systemLabel: t("adminMonitor.usageSystem"),
      freeLabel: t("adminMonitor.usageFree"),
      othersLabel: (count: number) =>
        count === 1
          ? t("adminMonitor.usageOthersOne")
          : t("adminMonitor.usageOthers", { count }),
    };
    const charts = (
      items: { key: string; label: string; value: number }[],
      total: number,
      hostUsed?: number,
    ): Record<Scope, UsageChart> => ({
      whole: buildUsage({ items, total, hostUsed, ...common }),
      // No total: the chart is just the containers, and fills its ring.
      among: buildUsage({ items, total: 0, ...common }),
    });
    return {
      memory: charts(
        running.map((c) => ({
          key: c.id,
          label: c.name,
          value: c.memory_bytes ?? 0,
        })),
        host.memory_total,
        host.memory_used,
      ),
      // One core is 100%, so the whole machine is 100% for each of its cores.
      cpu: charts(
        running.map((c) => ({
          key: c.id,
          label: c.name,
          value: c.cpu_percent ?? 0,
        })),
        Math.max(host.cpus, 1) * 100,
      ),
    };
  }, [containers, host, t]);

  if (host.memory_total <= 0 || containers.length === 0) return null;
  return (
    <section aria-label={t("adminMonitor.usageHeading")} className="space-y-3">
      <h3 className="text-base font-semibold">
        {t("adminMonitor.usageHeading")}
      </h3>
      <div className="grid gap-3 lg:grid-cols-2">
        <UsageCard
          icon={MemoryStick}
          title={t("adminMonitor.usageMemory")}
          charts={memory}
          format={formatBytes}
          totalLabel={t("adminMonitor.usageOf", {
            total: formatBytes(host.memory_total),
          })}
          usedLabel={t("adminMonitor.usageContainers")}
        />
        <UsageCard
          icon={Cpu}
          title={t("adminMonitor.usageCpu")}
          charts={cpu}
          format={(value) =>
            t("adminMonitor.usageCores", { cores: (value / 100).toFixed(2) })
          }
          totalLabel={t("adminMonitor.usageOfCores", { cores: host.cpus })}
          usedLabel={t("adminMonitor.usageContainers")}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {t("adminMonitor.usageFootnote")}
      </p>
    </section>
  );
}
