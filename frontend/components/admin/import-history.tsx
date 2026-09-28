"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";

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

const MAX_ERROR_LENGTH = 300;

/**
 * The point of a failure without the driver and SQL wrapped around it. Runs
 * stored before the backend shortened errors carry the whole exception, e.g.
 * `(sqlalchemy...Error) <class '...DiskFullError'>: could not extend file
 * "base/1/2": No space left on device HINT: ... [SQL: INSERT ...]`.
 */
export function conciseError(message: string): string {
  let text = message.split("[SQL:")[0].split("(Background on this error")[0];
  text = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:\([\w.]+\)\s*)?(?:<class '[^']+'>:\s*)?/, "")
    .replace(/^could not [^"]*"[^"]*":\s*/, "")
    .trim();
  if (text.length > MAX_ERROR_LENGTH) {
    text = `${text.slice(0, MAX_ERROR_LENGTH - 1).trimEnd()}…`;
  }
  return text || message.slice(0, MAX_ERROR_LENGTH);
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
    <div className="border-border flex min-h-0 flex-1 flex-col border-t">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-5 py-2">
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

      {/* One scroll area of fixed size: switching filters swaps what is inside
          it instead of resizing the modal. */}
      <div className="border-border min-h-0 flex-1 overflow-y-auto border-t pb-3">
        {state !== "loading" && run.error && filter !== "warning" ? (
          <p
            role="alert"
            className="text-danger border-border border-b px-5 py-3 text-sm"
          >
            {t("importHistory.errorPrefix", { message: conciseError(run.error) })}
          </p>
        ) : null}
        {state === "loading" ? (
          <p className="text-muted-foreground flex items-center gap-2 px-5 py-4 text-sm">
            <Loader2 className="size-4 animate-spin" />{" "}
            {t("importHistory.logLoading")}
          </p>
        ) : state === "error" ? (
          <p className="text-danger px-5 py-4 text-sm">
            {t("importHistory.logLoadError")}
          </p>
        ) : lines.length === 0 ? (
          <p className="text-muted-foreground px-5 py-4 text-sm">
            {t("importHistory.logEmpty")}
          </p>
        ) : (
          <>
            <ul className="divide-border divide-y text-xs">
              {lines.map((line) => (
                <li key={line.id} className="px-5 py-2.5 leading-relaxed">
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
              <div className="border-border border-t px-5 py-3">
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
    </div>
  );
}

const SERVER_PAGE = 100;
const PAGE_SIZES = [10, 20, 50];
const STATUS_ORDER: HistoryRun["status"][] = [
  "queued",
  "running",
  "completed",
  "cancelled",
  "failed",
];

export type SortKey = "run" | "status" | "problems" | "started" | "duration";
export type SortDir = "asc" | "desc";
export type StatusFilter = "all" | HistoryRun["status"];

function runMillis(run: HistoryRun): number {
  return Math.max(0, Date.parse(run.updatedAt) - Date.parse(run.createdAt));
}

function compareBy(a: HistoryRun, b: HistoryRun, key: SortKey): number {
  switch (key) {
    case "run":
      return (
        a.kind.localeCompare(b.kind) ||
        (a.spaces?.join(",") ?? "").localeCompare(b.spaces?.join(",") ?? "")
      );
    case "status":
      return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    case "problems":
      return a.errors - b.errors || a.warnings - b.warnings;
    case "duration":
      return runMillis(a) - runMillis(b);
    default:
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  }
}

/** Newest first among equals, so a sort by status still reads chronologically. */
export function sortRuns(
  runs: HistoryRun[],
  key: SortKey,
  dir: SortDir,
): HistoryRun[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...runs].sort(
    (a, b) =>
      sign * compareBy(a, b, key) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/** Every page of one job list; the history is small enough to hold whole. */
async function fetchAllRows(
  path: string,
  extra: Record<string, string>,
): Promise<JobRow[]> {
  const rows: JobRow[] = [];
  for (let offset = 0; ; offset += SERVER_PAGE) {
    const page = await api.get<JobRow[]>(path, {
      query: { ...extra, limit: SERVER_PAGE, offset },
    });
    rows.push(...page);
    if (page.length < SERVER_PAGE) return rows;
  }
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (column: SortKey) => void;
}) {
  const active = sort.key === column;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className="px-4 py-2 font-medium"
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "hover:text-foreground focus-visible:ring-ring -mx-1 inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon className="size-3" aria-hidden />
      </button>
    </th>
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
  const [selected, setSelected] = useState<HistoryRun | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "started",
    dir: "desc",
  });
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(0);

  const reload = useCallback(async () => {
    setState("loading");
    const [confluence, restore] = await Promise.allSettled([
      fetchAllRows("/api/v1/confluence-imports/jobs", {}),
      fetchAllRows("/api/v1/backup/jobs", { kind: "full_import" }),
    ]);
    if (confluence.status === "rejected" && restore.status === "rejected") {
      setState("error");
      return;
    }
    setRuns([
      ...toRuns("confluence", confluence.status === "fulfilled" ? confluence.value : []),
      ...toRuns("restore", restore.status === "fulfilled" ? restore.value : []),
    ]);
    setState("ready");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load persisted server state on mount
    void reload();
  }, [reload]);

  const filtered = runs.filter(
    (run) => statusFilter === "all" || run.status === statusFilter,
  );
  const sorted = sortRuns(filtered, sort.key, sort.dir);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const offset = currentPage * pageSize;
  const visible = sorted.slice(offset, offset + pageSize);

  function changeSort(column: SortKey) {
    setSort((current) =>
      current.key === column
        ? { key: column, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key: column, dir: column === "started" ? "desc" : "asc" },
    );
    setPage(0);
  }

  const statusLabel: Record<HistoryRun["status"], string> = {
    completed: t("importHistory.statusCompleted"),
    failed: t("importHistory.statusFailed"),
    cancelled: t("importHistory.statusCancelled"),
    running: t("importHistory.statusRunning"),
    queued: t("importHistory.statusQueued"),
  };

  const kindLabel = (run: HistoryRun) =>
    run.kind === "confluence"
      ? t("importHistory.kindConfluence")
      : t("importHistory.kindRestore");

  return (
    <section
      aria-labelledby="import-history-title"
      className="border-border bg-surface-raised mt-4 rounded-lg border shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 id="import-history-title" className="text-sm font-semibold">
            {t("importHistory.title")}
          </h3>
          <p className="text-muted-foreground truncate text-xs">
            {t("importHistory.description")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="min-w-40">
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as StatusFilter);
                setPage(0);
              }}
            >
              <SelectTrigger
                className="h-8"
                aria-label={t("importHistory.filterStatusAria")}
              >
                <SelectValue>
                  {statusFilter === "all"
                    ? t("importHistory.statusAll")
                    : statusLabel[statusFilter]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("importHistory.statusAll")}</SelectItem>
                {STATUS_ORDER.map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusLabel[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void reload()}
            disabled={state === "loading"}
            aria-label={t("importHistory.refresh")}
            title={t("importHistory.refresh")}
          >
            <RefreshCw className={cn(state === "loading" && "animate-spin")} />
            <span className="hidden sm:inline">{t("importHistory.refresh")}</span>
          </Button>
        </div>
      </div>

      {state === "loading" && runs.length === 0 ? (
        <p className="text-muted-foreground border-border flex items-center gap-2 border-t px-4 py-3 text-sm">
          <Loader2 className="size-4 animate-spin" />{" "}
          {t("importHistory.loading")}
        </p>
      ) : state === "error" ? (
        <div className="border-border flex flex-wrap items-center gap-3 border-t px-4 py-3 text-sm">
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
        <p className="text-muted-foreground border-border border-t px-4 py-3 text-sm">
          {t("importHistory.empty")}
        </p>
      ) : (
        <>
          <div className="border-border overflow-x-auto border-t">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left text-xs">
                  <SortHeader
                    label={t("importHistory.columnRun")}
                    column="run"
                    sort={sort}
                    onSort={changeSort}
                  />
                  <SortHeader
                    label={t("importHistory.columnStatus")}
                    column="status"
                    sort={sort}
                    onSort={changeSort}
                  />
                  <SortHeader
                    label={t("importHistory.columnProblems")}
                    column="problems"
                    sort={sort}
                    onSort={changeSort}
                  />
                  <SortHeader
                    label={t("importHistory.columnStarted")}
                    column="started"
                    sort={sort}
                    onSort={changeSort}
                  />
                  <SortHeader
                    label={t("importHistory.columnDuration")}
                    column="duration"
                    sort={sort}
                    onSort={changeSort}
                  />
                  <th className="px-4 py-2 text-right font-medium">
                    <span className="sr-only">
                      {t("importHistory.columnActions")}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((run) => {
                  const scope = run.spaces
                    ? run.spaces.join(", ")
                    : t("importHistory.scopeAll");
                  return (
                    <tr
                      key={run.key}
                      className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0"
                    >
                      <td className="px-4 py-2">
                        <div className="font-medium">{kindLabel(run)}</div>
                        <div
                          className="text-muted-foreground max-w-56 truncate text-xs"
                          title={scope}
                        >
                          {scope}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={statusVariant(run.status)}>
                          {statusLabel[run.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          {run.errors > 0 ? (
                            <Badge variant="danger">
                              {t("importHistory.errorsLabel", {
                                count: run.errors,
                              })}
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
                        </div>
                      </td>
                      <td className="text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">
                        {formatDateTime(run.createdAt, locale)}
                      </td>
                      <td className="text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">
                        {run.status === "running" || run.status === "queued"
                          ? t("importHistory.inProgress")
                          : formatDuration(run.createdAt, run.updatedAt)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setSelected(run)}
                          aria-label={`${t("importHistory.viewDetails")}: ${kindLabel(run)} ${formatDateTime(run.createdAt, locale)}`}
                        >
                          <Eye /> {t("importHistory.viewDetails")}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sorted.length === 0 ? (
            <p className="text-muted-foreground border-border border-t px-4 py-3 text-sm">
              {t("importHistory.noMatch")}
            </p>
          ) : null}
          <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2">
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {sorted.length === 0
                ? t("importHistory.noResults")
                : t("importHistory.showing", {
                    from: offset + 1,
                    to: Math.min(offset + pageSize, sorted.length),
                    total: sorted.length,
                  })}
            </p>
            <div className="flex items-center gap-2">
              <label
                htmlFor="import-history-page-size"
                className="text-muted-foreground text-xs"
              >
                {t("importHistory.rowsPerPage")}
              </label>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setPage(0);
                }}
              >
                <SelectTrigger
                  id="import-history-page-size"
                  className="h-8 w-20"
                  aria-label={t("importHistory.rowsPerPage")}
                >
                  <SelectValue>{pageSize}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground hidden text-xs sm:inline">
                {t("importHistory.pageOf", {
                  page: currentPage + 1,
                  count: pageCount,
                })}
              </span>
              <span className="border-border h-5 border-l" aria-hidden />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
                aria-label={t("importHistory.previousPage")}
                title={t("importHistory.previousPage")}
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
                aria-label={t("importHistory.nextPage")}
                title={t("importHistory.nextPage")}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {selected ? (
          <DialogContent
            title={t("importHistory.detailsTitle", {
              kind: kindLabel(selected),
            })}
            description={t("importHistory.detailsDescription", {
              time: formatDateTime(selected.createdAt, locale),
              status: statusLabel[selected.status],
            })}
            className="flex h-[min(40rem,calc(100vh-4rem))] max-w-3xl flex-col overflow-hidden p-0 [&>div:first-child]:shrink-0 [&>div:first-child]:px-5 [&>div:first-child]:pt-5"
          >
            <RunLog run={selected} />
          </DialogContent>
        ) : null}
      </Dialog>
    </section>
  );
}
