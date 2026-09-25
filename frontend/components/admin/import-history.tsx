"use client";

import { ChevronDown, Copy, Download, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";

const RUNS_PAGE = 20;
const LINES_PAGE = 100;

export type RunKind = "confluence" | "restore";
type LogFilter = "all" | "warning" | "error";

interface JobRow {
  id: string;
  status: string;
  error: string | null;
  warning_count: number;
  error_count: number;
  created_at: string;
  updated_at: string;
  space_keys: string[];
  /** Confluence imports only. */
  import_all?: boolean;
}

interface LogLine {
  id: string;
  created_at: string;
  level: string;
  phase: string;
  entity_label: string | null;
  message: string;
}

interface LogPage {
  items: LogLine[];
  next_offset: number | null;
}

/** One past or present run, from either job table, in a common shape. */
export interface HistoryRun {
  key: string;
  kind: RunKind;
  id: string;
  status: "completed" | "failed" | "cancelled" | "running" | "queued";
  /** `null` means every space in the archive. */
  spaces: string[] | null;
  error: string | null;
  warnings: number;
  errors: number;
  createdAt: string;
  updatedAt: string;
  logsPath: string;
}

export function normaliseStatus(status: string): HistoryRun["status"] {
  if (status === "complete" || status === "completed") return "completed";
  if (status === "failed" || status === "cancelled" || status === "queued") {
    return status;
  }
  // "running", "retrying" and any phase-like value all mean "not finished".
  return "running";
}

export function toRuns(kind: RunKind, rows: JobRow[]): HistoryRun[] {
  return rows.map((row) => ({
    key: `${kind}:${row.id}`,
    kind,
    id: row.id,
    status: normaliseStatus(row.status),
    spaces:
      kind === "confluence" && row.import_all
        ? null
        : row.space_keys.length
          ? row.space_keys
          : null,
    error: row.error,
    warnings: row.warning_count,
    errors: row.error_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    logsPath:
      kind === "confluence"
        ? `/api/v1/confluence-imports/jobs/${row.id}/logs`
        : `/api/v1/backup/jobs/${row.id}/logs`,
  }));
}

/** "45s", "12m", "3h 12m" - language-neutral, for run durations. */
export function formatDuration(fromIso: string, toIso: string): string {
  const seconds = Math.max(
    0,
    Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function logTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function statusVariant(status: HistoryRun["status"]) {
  switch (status) {
    case "completed":
      return "success" as const;
    case "failed":
      return "danger" as const;
    case "cancelled":
      return "warning" as const;
    default:
      return "info" as const;
  }
}

function levelClass(level: string): string | undefined {
  const value = level.toLowerCase();
  if (value === "warning") return "text-warning";
  if (value === "error") return "text-danger";
  return undefined;
}

function RunLog({ run }: { run: HistoryRun }) {
  const { t, locale } = useTranslation();
  const [filter, setFilter] = useState<LogFilter>("all");
  const [lines, setLines] = useState<LogLine[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (offset: number, level: LogFilter) => {
      return api.get<LogPage>(run.logsPath, {
        query: {
          offset,
          limit: LINES_PAGE,
          order: "asc",
          level: level === "all" ? undefined : level,
        },
      });
    },
    [run.logsPath],
  );

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restart the list whenever the filter changes
    setState("loading");
    fetchPage(0, filter)
      .then((page) => {
        if (cancelled) return;
        setLines(page.items);
        setNextOffset(page.next_offset);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, filter]);

  async function loadMore() {
    if (nextOffset === null) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextOffset, filter);
      setLines((current) => [...current, ...page.items]);
      setNextOffset(page.next_offset);
    } catch {
      toast.error(t("importHistory.logLoadError"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function copyLog() {
    const text = lines
      .map(
        (line) =>
          `${line.created_at} ${line.level.toUpperCase()} ${line.phase}${
            line.entity_label ? ` ${line.entity_label}:` : ""
          } ${line.message}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("importHistory.copied"));
    } catch {
      toast.error(t("importHistory.copyFailed"));
    }
  }

  const filters: { value: LogFilter; label: string }[] = [
    { value: "all", label: t("importHistory.filterAll") },
    { value: "warning", label: t("importHistory.filterWarnings") },
    { value: "error", label: t("importHistory.filterErrors") },
  ];

  return (
    <div className="border-border border-t">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div
          role="group"
          aria-label={t("importHistory.filterAria")}
          className="flex items-center gap-1"
        >
          {filters.map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={filter === item.value ? "secondary" : "ghost"}
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void copyLog()}
            disabled={!lines.length}
          >
            <Copy /> {t("importHistory.copy")}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={`${run.logsPath}/download`} download>
              <Download /> {t("importHistory.download")}
            </a>
          </Button>
        </div>
      </div>

      {state === "loading" ? (
        <p className="text-muted-foreground flex items-center gap-2 px-3 pb-3 text-xs">
          <Loader2 className="size-4 animate-spin" />{" "}
          {t("importHistory.logLoading")}
        </p>
      ) : state === "error" ? (
        <p className="text-danger px-3 pb-3 text-xs">
          {t("importHistory.logLoadError")}
        </p>
      ) : lines.length === 0 ? (
        <p className="text-muted-foreground px-3 pb-3 text-xs">
          {t("importHistory.logEmpty")}
        </p>
      ) : (
        <>
          <ul className="border-border max-h-80 divide-y overflow-y-auto border-t text-xs">
            {lines.map((line) => (
              <li key={line.id} className="px-3 py-2">
                <span className="text-muted-foreground tabular-nums">
                  {logTime(line.created_at, locale)}
                </span>{" "}
                <span className={cn("font-medium", levelClass(line.level))}>
                  {line.level}
                </span>{" "}
                · {line.entity_label ? `${line.entity_label}: ` : ""}
                {line.message}
              </li>
            ))}
          </ul>
          {nextOffset !== null ? (
            <div className="border-border border-t px-3 py-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? <Loader2 className="animate-spin" /> : null}
                {t("importHistory.logLoadMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Past and current Confluence imports and WikiHub restores, each expandable
 * into its stored log. The logs live on the server, so a run left going for
 * hours (browser closed, laptop asleep) is still explainable afterwards.
 */
export function ImportHistory() {
  const { t, locale } = useTranslation();
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const loaded = useRef({ confluence: 0, restore: 0 });

  const fetchRuns = useCallback(async (offsets: typeof loaded.current) => {
    const [confluence, restore] = await Promise.allSettled([
      api.get<JobRow[]>("/api/v1/confluence-imports/jobs", {
        query: { limit: RUNS_PAGE, offset: offsets.confluence },
      }),
      api.get<JobRow[]>("/api/v1/backup/jobs", {
        query: { kind: "full_import", limit: RUNS_PAGE, offset: offsets.restore },
      }),
    ]);
    if (confluence.status === "rejected" && restore.status === "rejected") {
      throw confluence.reason;
    }
    const confluenceRows =
      confluence.status === "fulfilled" ? confluence.value : [];
    const restoreRows = restore.status === "fulfilled" ? restore.value : [];
    return {
      runs: [
        ...toRuns("confluence", confluenceRows),
        ...toRuns("restore", restoreRows),
      ],
      counts: { confluence: confluenceRows.length, restore: restoreRows.length },
    };
  }, []);

  const reload = useCallback(async () => {
    setState("loading");
    try {
      const result = await fetchRuns({ confluence: 0, restore: 0 });
      loaded.current = result.counts;
      setRuns(sortRuns(result.runs));
      setHasMore(
        result.counts.confluence === RUNS_PAGE ||
          result.counts.restore === RUNS_PAGE,
      );
      setState("ready");
    } catch {
      setState("error");
    }
  }, [fetchRuns]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load persisted server state on mount
    void reload();
  }, [reload]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const result = await fetchRuns(loaded.current);
      loaded.current = {
        confluence: loaded.current.confluence + result.counts.confluence,
        restore: loaded.current.restore + result.counts.restore,
      };
      setRuns((current) => {
        const known = new Set(current.map((run) => run.key));
        return sortRuns([
          ...current,
          ...result.runs.filter((run) => !known.has(run.key)),
        ]);
      });
      setHasMore(
        result.counts.confluence === RUNS_PAGE ||
          result.counts.restore === RUNS_PAGE,
      );
    } catch {
      toast.error(t("importHistory.loadError"));
    } finally {
      setLoadingMore(false);
    }
  }

  const statusLabel: Record<HistoryRun["status"], string> = {
    completed: t("importHistory.statusCompleted"),
    failed: t("importHistory.statusFailed"),
    cancelled: t("importHistory.statusCancelled"),
    running: t("importHistory.statusRunning"),
    queued: t("importHistory.statusQueued"),
  };

  return (
    <section
      aria-labelledby="import-history-title"
      className="border-border bg-surface-raised mt-4 rounded-lg border p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="import-history-title" className="text-base font-semibold">
            {t("importHistory.title")}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("importHistory.description")}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void reload()}
          disabled={state === "loading"}
        >
          <RefreshCw className={cn(state === "loading" && "animate-spin")} />
          {t("importHistory.refresh")}
        </Button>
      </div>

      {state === "loading" && runs.length === 0 ? (
        <p className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />{" "}
          {t("importHistory.loading")}
        </p>
      ) : state === "error" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-danger">{t("importHistory.loadError")}</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void reload()}
          >
            {t("importHistory.retry")}
          </Button>
        </div>
      ) : runs.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">
          {t("importHistory.empty")}
        </p>
      ) : (
        <>
          <ul className="border-border mt-4 divide-y rounded-md border">
            {runs.map((run) => {
              const open = expanded === run.key;
              const scope = run.spaces
                ? run.spaces.join(", ")
                : t("importHistory.scopeAll");
              return (
                <li key={run.key}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : run.key)}
                    className="hover:bg-surface-hover focus-visible:ring-ring flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                  >
                    <span className="font-medium">
                      {run.kind === "confluence"
                        ? t("importHistory.kindConfluence")
                        : t("importHistory.kindRestore")}
                    </span>
                    <span
                      className="text-muted-foreground min-w-0 max-w-xs truncate"
                      title={scope}
                    >
                      {scope}
                    </span>
                    <Badge variant={statusVariant(run.status)}>
                      {statusLabel[run.status]}
                    </Badge>
                    {run.errors > 0 ? (
                      <Badge variant="danger">
                        {t("importHistory.errorsLabel", { count: run.errors })}
                      </Badge>
                    ) : null}
                    {run.warnings > 0 ? (
                      <Badge variant="warning">
                        {t("importHistory.warningsLabel", {
                          count: run.warnings,
                        })}
                      </Badge>
                    ) : null}
                    {run.errors === 0 && run.warnings === 0 ? (
                      <span className="text-muted-foreground text-xs">
                        {t("importHistory.noProblems")}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground ml-auto text-xs">
                      {t("importHistory.started", {
                        time: formatDateTime(run.createdAt, locale),
                      })}
                      {" · "}
                      {run.status === "running" || run.status === "queued"
                        ? t("importHistory.inProgress")
                        : t("importHistory.duration", {
                            duration: formatDuration(
                              run.createdAt,
                              run.updatedAt,
                            ),
                          })}
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "text-muted-foreground size-4 shrink-0 transition-transform duration-150",
                        open && "rotate-180",
                      )}
                    />
                    <span className="sr-only">
                      {open
                        ? t("importHistory.hideLog")
                        : t("importHistory.showLog")}
                    </span>
                  </button>
                  {open ? (
                    <>
                      {run.error ? (
                        <p className="text-danger px-3 pb-2 text-xs">
                          {t("importHistory.errorPrefix", {
                            message: run.error,
                          })}
                        </p>
                      ) : null}
                      <RunLog run={run} />
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {hasMore ? (
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? <Loader2 className="animate-spin" /> : null}
                {t("importHistory.loadMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function sortRuns(runs: HistoryRun[]): HistoryRun[] {
  return [...runs].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}
