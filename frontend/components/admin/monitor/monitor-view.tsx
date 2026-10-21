"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CircleAlert,
  Container,
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  ScrollText,
  Server,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { LogsDialog } from "@/components/admin/monitor/logs-dialog";
import { UsageDonuts } from "@/components/admin/monitor/usage-donuts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/components/ui/job-progress";
import type { ContainerInfo, MonitorOverview } from "@/lib/admin-monitor";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;

type SortKey = "name" | "status" | "uptime" | "cpu" | "memory";
type Sort = { key: SortKey; dir: "asc" | "desc" };

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "-";
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

/** A thin bar for a share of something, with the share written at its right end; amber, then red, as it fills. */
function Meter({ percent, label }: { percent: number; label: string }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const tone =
    value >= 90 ? "bg-danger" : value >= 70 ? "bg-warning" : "bg-info";
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="bg-surface-sunken border-border h-1.5 min-w-0 flex-1 overflow-hidden rounded-full border"
      >
        <div
          className={cn(
            "h-full duration-150 motion-safe:transition-[width]",
            tone,
          )}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-muted-foreground w-9 text-right text-xs tabular-nums">
        {value}%
      </span>
    </div>
  );
}

function Stat({
  icon: Icon,
  title,
  value,
  detail,
  percent,
  extras,
}: {
  icon: typeof Cpu;
  title: string;
  value: string;
  detail: string;
  percent?: number;
  /** More figures, each with its own bar, such as swap under memory. */
  extras?: { label: string; value: string; percent: number }[];
}) {
  return (
    <div className="border-border bg-surface space-y-2 rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <Icon className="size-4" aria-hidden />
        {title}
      </div>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {percent !== undefined ? <Meter percent={percent} label={title} /> : null}
      {extras?.map((extra) => (
        <div key={extra.label} className="space-y-1 pt-1">
          <p className="text-muted-foreground flex justify-between gap-2 text-xs">
            <span>{extra.label}</span>
            <span className="tabular-nums">{extra.value}</span>
          </p>
          <Meter percent={extra.percent} label={extra.label} />
        </div>
      ))}
      <p className="text-muted-foreground text-xs whitespace-pre-line">
        {detail}
      </p>
    </div>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  hint,
}: {
  label: string;
  column: SortKey;
  sort: Sort;
  onSort: (column: SortKey) => void;
  hint: string;
}) {
  const current = sort.key === column ? sort.dir : null;
  const Icon =
    current === "asc" ? ArrowUp : current === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <th
      className="px-4 py-2 font-medium"
      aria-sort={
        current === "asc"
          ? "ascending"
          : current === "desc"
            ? "descending"
            : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        title={hint}
        className={cn(
          "hover:text-foreground focus-visible:ring-ring -mx-1 inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
          current && "text-foreground",
        )}
      >
        {label}
        <Icon className="size-3" aria-hidden />
      </button>
    </th>
  );
}

function HealthBadge({ container }: { container: ContainerInfo }) {
  const { t } = useTranslation();
  if (container.state !== "running") {
    return <Badge variant="neutral">{container.state}</Badge>;
  }
  if (container.health === "unhealthy")
    return <Badge variant="danger">{t("adminMonitor.unhealthy")}</Badge>;
  if (container.health === "starting")
    return <Badge variant="info">{t("adminMonitor.starting")}</Badge>;
  if (container.health === "healthy")
    return <Badge variant="success">{t("adminMonitor.healthy")}</Badge>;
  return <Badge variant="success">{t("adminMonitor.running")}</Badge>;
}

/**
 * Administration > Server: the machine WikiHub runs on and every Docker container on
 * it - uptime, id, CPU, memory and logs - refreshed every few seconds while the
 * page is in view. Read-only; nothing here can stop or change anything.
 */
export function MonitorView({ initial }: { initial: MonitorOverview | null }) {
  const { t, apiErrorText } = useTranslation();
  const [data, setData] = useState<MonitorOverview | null>(initial);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const [logsFor, setLogsFor] = useState<ContainerInfo | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.get<MonitorOverview>("/api/v1/admin/monitor");
      if (!alive.current) return;
      setData(next);
      setError("");
    } catch (failure) {
      if (alive.current)
        setError(apiErrorText(failure, "adminMonitor.loadError"));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [apiErrorText]);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      // Nobody is looking at a hidden tab: do not sample every container for it.
      if (document.visibilityState === "visible") await refresh();
      if (alive.current) timer = setTimeout(() => void tick(), POLL_MS);
    }
    void tick();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  const rows = useMemo(() => {
    const rank = (c: ContainerInfo): number =>
      c.state !== "running"
        ? 3
        : c.health === "unhealthy"
          ? 0
          : c.health === "starting"
            ? 1
            : 2;
    const key = (c: ContainerInfo): number | string =>
      sort.key === "cpu"
        ? (c.cpu_percent ?? -1)
        : sort.key === "memory"
          ? (c.memory_bytes ?? -1)
          : sort.key === "uptime"
            ? (c.uptime_seconds ?? -1)
            : sort.key === "status"
              ? rank(c)
              : c.name;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...(data?.containers ?? [])].sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      return (
        sign *
        (typeof x === "string"
          ? x.localeCompare(String(y))
          : (x as number) - (y as number))
      );
    });
  }, [data, sort]);

  // A number column starts with the biggest, a text column with A; a second click reverses.
  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "status" ? "asc" : "desc" },
    );
  }

  const host = data?.host;
  const memoryPercent =
    host && host.memory_total
      ? (host.memory_used / host.memory_total) * 100
      : 0;
  const diskPercent =
    host && host.disk_total ? (host.disk_used / host.disk_total) * 100 : 0;
  const loadPercent =
    host && host.cpus && host.load.length
      ? (host.load[0]! / host.cpus) * 100
      : 0;

  return (
    <div className="space-y-6">
      {error ? (
        <div
          role="alert"
          className="border-danger/40 bg-danger-bg text-danger flex items-start gap-2 rounded-xl border p-3 text-sm"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </div>
      ) : null}

      {host ? (
        <section
          aria-label={t("adminMonitor.hostHeading")}
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              icon={Cpu}
              title={t("adminMonitor.load")}
              value={
                host.load.length
                  ? t("adminMonitor.loadValue", {
                      used: host.load[0]!.toFixed(2),
                      cores: host.cpus,
                    })
                  : "-"
              }
              percent={loadPercent}
              detail={t("adminMonitor.loadDetail", {
                five: host.load[1]?.toFixed(2) ?? "-",
                fifteen: host.load[2]?.toFixed(2) ?? "-",
              })}
            />
            <Stat
              icon={MemoryStick}
              title={t("adminMonitor.memory")}
              value={`${formatBytes(host.memory_used)} / ${formatBytes(host.memory_total)}`}
              percent={memoryPercent}
              extras={
                host.swap_total
                  ? [
                      {
                        label: t("adminMonitor.swap"),
                        value: `${formatBytes(host.swap_used)} / ${formatBytes(host.swap_total)}`,
                        percent: (host.swap_used / host.swap_total) * 100,
                      },
                    ]
                  : undefined
              }
              detail={t("adminMonitor.availableDetail", {
                available: formatBytes(host.memory_available),
              })}
            />
            <Stat
              icon={HardDrive}
              title={t("adminMonitor.disk")}
              value={`${formatBytes(host.disk_used)} / ${formatBytes(host.disk_total)}`}
              percent={diskPercent}
              detail={t("adminMonitor.diskDetail", {
                free: formatBytes(
                  Math.max(host.disk_total - host.disk_used, 0),
                ),
              })}
            />
            <Stat
              icon={Server}
              title={t("adminMonitor.uptime")}
              value={formatUptime(host.uptime_seconds)}
              detail={
                host.docker_version
                  ? [
                      t("adminMonitor.containersDetail", {
                        running: host.containers_running,
                        total: host.containers_total,
                      }),
                      t("adminMonitor.dockerDetail", {
                        version: host.docker_version,
                        os: host.os || host.kernel || "-",
                      }),
                    ].join("\n")
                  : t("adminMonitor.dockerUnknown")
              }
            />
          </div>
        </section>
      ) : null}

      {host && data ? (
        <UsageDonuts host={host} containers={data.containers} />
      ) : null}

      <section
        aria-label={t("adminMonitor.containersHeading")}
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Container className="text-muted-foreground size-4" aria-hidden />
            {t("adminMonitor.containersHeading")}
            {data ? (
              <span className="text-muted-foreground text-sm font-normal">
                ({rows.length})
              </span>
            ) : null}
            {loading ? (
              <Loader2
                className="text-muted-foreground size-3.5 animate-spin"
                aria-label={t("adminMonitor.refreshing")}
              />
            ) : null}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {t("adminMonitor.refresh")}
            </Button>
          </div>
        </div>

        {data && !data.docker_ok ? (
          <p
            role="alert"
            className="border-border bg-surface text-muted-foreground rounded-xl border p-4 text-sm"
          >
            {t("adminMonitor.dockerDown")}
          </p>
        ) : null}

        <div className="border-border bg-surface overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left text-xs">
                {(
                  [
                    ["name", "adminMonitor.colName"],
                    ["status", "adminMonitor.colStatus"],
                    ["uptime", "adminMonitor.colUptime"],
                    ["cpu", "adminMonitor.colCpu"],
                    ["memory", "adminMonitor.colMemory"],
                  ] as const
                ).map(([key, label]) => (
                  <SortHeader
                    key={key}
                    column={key}
                    label={t(label)}
                    sort={sort}
                    onSort={toggleSort}
                    hint={t("adminMonitor.sortBy", { column: t(label) })}
                  />
                ))}
                <th className="px-4 py-2 text-right font-medium">
                  {t("adminMonitor.colLogs")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-muted-foreground px-4 py-8 text-center text-sm"
                  >
                    {data ? t("adminMonitor.none") : t("adminMonitor.loading")}
                  </td>
                </tr>
              ) : null}
              {rows.map((container) => {
                const memoryShare =
                  container.memory_bytes !== null && container.memory_limit
                    ? (container.memory_bytes / container.memory_limit) * 100
                    : 0;
                return (
                  <tr
                    key={container.id}
                    className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-b-0"
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{container.name}</span>
                      </div>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-[11px]">
                        <code
                          className="font-mono"
                          title={t("adminMonitor.containerId")}
                        >
                          {container.id}
                        </code>
                        <span className="truncate" title={container.image}>
                          {container.image}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <HealthBadge container={container} />
                        {container.restarts > 0 ? (
                          <Badge variant="info">
                            {t("adminMonitor.restarts", {
                              count: container.restarts,
                            })}
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                      {formatUptime(container.uptime_seconds)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                      {container.cpu_percent === null
                        ? "-"
                        : `${container.cpu_percent.toFixed(1)}%`}
                    </td>
                    <td className="min-w-40 px-4 py-2">
                      {container.memory_bytes === null ? (
                        "-"
                      ) : (
                        <div className="space-y-1">
                          <span className="tabular-nums">
                            {formatBytes(container.memory_bytes)}
                            {container.memory_limit &&
                            container.memory_limit <
                              (host?.memory_total ?? Infinity) * 0.999
                              ? ` / ${formatBytes(container.memory_limit)}`
                              : ""}
                          </span>
                          {container.memory_limit &&
                          container.memory_limit <
                            (host?.memory_total ?? Infinity) * 0.999 ? (
                            <Meter
                              percent={memoryShare}
                              label={`${container.name} ${t("adminMonitor.colMemory")}`}
                            />
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setLogsFor(container)}
                          aria-label={t("adminMonitor.viewLogs", {
                            name: container.name,
                          })}
                          title={t("adminMonitor.viewLogs", {
                            name: container.name,
                          })}
                        >
                          <ScrollText />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-xs">
          {t("adminMonitor.footnote", { seconds: POLL_MS / 1000 })}
        </p>
      </section>

      <LogsDialog
        key={logsFor?.id ?? "none"}
        container={logsFor}
        onClose={() => setLogsFor(null)}
      />
    </div>
  );
}

export type { ReactNode };
