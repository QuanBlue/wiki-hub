"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileArchive,
  FolderOpen,
  Info,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { formatDuration } from "@/components/ui/job-progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimezoneCombobox } from "@/components/ui/timezone-combobox";
import { ApiError, apiFetch, describeApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  AutomatedBackupStatusBadge,
  SortableAutomatedJobsHeader,
  automatedJobDuration,
  formatCompletedAt,
} from "./backup-ui-primitives";
import {
  AUTOMATED_JOBS_PAGE_SIZES,
  errorMessage,
  type AutomatedBackupSettings,
  type AutomatedJobsSort,
  type AutomatedJobsSortKey,
  type PortableBackupJob,
} from "./types";

export function AutomatedBackupsSection({ visible }: { visible: boolean }) {
  const [automatedSettings, setAutomatedSettings] =
    useState<AutomatedBackupSettings | null>(null);
  const [automatedJobs, setAutomatedJobs] = useState<PortableBackupJob[]>([]);
  const [automatedPending, setAutomatedPending] = useState(false);
  const [automatedError, setAutomatedError] = useState<string | null>(null);
  //: Fields start read-only - editing takes a deliberate "Edit" click - so a
  //: scroll-wheel nudge on the retention number field or a stray click while
  //: skimming the schedule can't silently change a live schedule. Saving (or
  //: cancelling) drops back to read-only.
  const [isEditingAutomatedSchedule, setIsEditingAutomatedSchedule] =
    useState(false);
  //: What "Cancel" restores - the last value actually confirmed from the
  //: server, never mutated in place (every edit replaces `automatedSettings`
  //: with a new object), so this stays untouched while the fields above it
  //: are being edited.
  const automatedSettingsSnapshotRef = useRef<AutomatedBackupSettings | null>(
    null,
  );
  //: Row selection for the history table's Actions column, which now offers
  //: only Download per row - deleting is a bulk action ("tick the rows you
  //: want gone, then Delete") rather than a button on every row. Scoped to
  //: the *current page* only - it is cleared whenever the page changes below.
  const [selectedAutomatedJobIds, setSelectedAutomatedJobIds] = useState<
    string[]
  >([]);
  const [confirmBulkDeleteAutomatedJobs, setConfirmBulkDeleteAutomatedJobs] =
    useState(false);
  const [cancelAutomatedJobId, setCancelAutomatedJobId] = useState<
    string | null
  >(null);
  const [cancelAutomatedJobPending, setCancelAutomatedJobPending] =
    useState(false);
  const [automatedJobsSort, setAutomatedJobsSort] =
    useState<AutomatedJobsSort>(null);
  const [automatedJobsOffset, setAutomatedJobsOffset] = useState(0);
  const [automatedJobsLimit, setAutomatedJobsLimit] = useState<number>(
    AUTOMATED_JOBS_PAGE_SIZES[0],
  );
  const [automatedJobsTotal, setAutomatedJobsTotal] = useState(0);

  const refreshAutomatedBackups = useCallback(async () => {
    try {
      const config = await apiFetch<AutomatedBackupSettings>(
        "/api/v1/backup/automatic",
      );
      automatedSettingsSnapshotRef.current = config;
      if (!isEditingAutomatedSchedule) {
        setAutomatedSettings(config);
      }
      setAutomatedError(null);
      try {
        const page = await apiFetch<{
          items: PortableBackupJob[];
          total: number;
        }>(
          `/api/v1/backup/automatic/jobs?offset=${automatedJobsOffset}&limit=${automatedJobsLimit}`,
        );
        setAutomatedJobs(page.items);
        setAutomatedJobsTotal(page.total);
      } catch (error) {
        setAutomatedJobs([]);
        setAutomatedJobsTotal(0);
        setAutomatedError(
          error instanceof ApiError
            ? `Schedule loaded, but backup history could not load: ${error.message}`
            : "Schedule loaded, but backup history could not load.",
        );
      }
    } catch (error) {
      if (!isEditingAutomatedSchedule) {
        setAutomatedSettings(null);
      }
      setAutomatedError(
        errorMessage(error, "Could not load automatic backup settings."),
      );
    }
  }, [isEditingAutomatedSchedule, automatedJobsOffset, automatedJobsLimit]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load persisted server state on mount
    void refreshAutomatedBackups();
  }, [refreshAutomatedBackups]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- selection does not survive a page change
    setSelectedAutomatedJobIds([]);
  }, [automatedJobsOffset, automatedJobsLimit]);

  const automatedLastStatus = automatedSettings?.last_status ?? null;
  useEffect(() => {
    if (automatedLastStatus !== "queued" && automatedLastStatus !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshAutomatedBackups();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [automatedLastStatus, refreshAutomatedBackups]);

  async function saveAutomatedBackups() {
    if (!automatedSettings) return;
    setAutomatedPending(true);
    try {
      const saved = await apiFetch<AutomatedBackupSettings>(
        "/api/v1/backup/automatic",
        {
          method: "PATCH",
          body: {
            enabled: automatedSettings.enabled,
            interval_unit: automatedSettings.interval_unit,
            interval_value: automatedSettings.interval_value,
            time_of_day: automatedSettings.time_of_day,
            timezone: automatedSettings.timezone,
            retention_count: automatedSettings.retention_count,
            subdirectory: automatedSettings.subdirectory,
          },
        },
      );
      automatedSettingsSnapshotRef.current = saved;
      setAutomatedSettings(saved);
      setIsEditingAutomatedSchedule(false);
      toast.success("Automatic backup settings saved.");
    } catch (error) {
      toast.error(describeApiError(error, "Could not save automatic backups."));
    } finally {
      setAutomatedPending(false);
    }
  }

  function cancelEditingAutomatedSchedule() {
    if (automatedSettingsSnapshotRef.current) {
      setAutomatedSettings(automatedSettingsSnapshotRef.current);
    }
    setIsEditingAutomatedSchedule(false);
  }

  async function runAutomatedBackupNow() {
    setAutomatedPending(true);
    try {
      await apiFetch("/api/v1/backup/automatic/run", { method: "POST" });
      toast.success("Automatic backup queued.");
      await refreshAutomatedBackups();
    } catch (error) {
      toast.error(errorMessage(error, "Could not queue automatic backup."));
    } finally {
      setAutomatedPending(false);
    }
  }

  function toggleSelectAutomatedJob(id: string) {
    setSelectedAutomatedJobIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  function toggleSelectAllAutomatedJobsOnPage() {
    const idsOnPage = automatedJobs.map((job) => job.id);
    const allSelected =
      idsOnPage.length > 0 &&
      idsOnPage.every((id) => selectedAutomatedJobIds.includes(id));
    setSelectedAutomatedJobIds(allSelected ? [] : idsOnPage);
  }

  const [sortNowMs, setSortNowMs] = useState<number>(() => Date.now());

  function toggleAutomatedJobsSort(key: AutomatedJobsSortKey) {
    setSortNowMs(Date.now());
    setAutomatedJobsSort((current) => {
      if (current?.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }

  const sortedAutomatedJobs = useMemo(() => {
    if (!automatedJobsSort) return automatedJobs;
    const { key, direction } = automatedJobsSort;
    const factor = direction === "asc" ? 1 : -1;
    const valueOf = (job: PortableBackupJob): number | string | null => {
      switch (key) {
        case "backup":
          return (job.output_filename ?? job.created_at).toLocaleLowerCase();
        case "status":
          return job.status;
        case "completed_at":
          return job.status === "complete"
            ? new Date(job.updated_at).getTime()
            : null;
        case "duration": {
          if (!job.started_at) return null;
          const start = new Date(job.started_at).getTime();
          const isTerminal =
            job.status === "complete" || job.status === "failed";
          const end = isTerminal
            ? new Date(job.updated_at).getTime()
            : sortNowMs;
          return end - start;
        }
      }
    };
    return [...automatedJobs].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va < vb) return -1 * factor;
      if (va > vb) return 1 * factor;
      return 0;
    });
  }, [automatedJobs, automatedJobsSort, sortNowMs]);

  async function bulkDeleteAutomatedBackups() {
    const ids = selectedAutomatedJobIds;
    if (ids.length === 0) return;
    setAutomatedPending(true);
    try {
      await apiFetch("/api/v1/backup/automatic/jobs/bulk-delete", {
        method: "POST",
        body: { job_ids: ids },
      });
      toast.success(
        `${ids.length} automatic backup${ids.length === 1 ? "" : "s"} deleted.`,
      );
      setSelectedAutomatedJobIds([]);
      if (ids.length >= automatedJobs.length && automatedJobsOffset > 0) {
        setAutomatedJobsOffset((current) =>
          Math.max(0, current - automatedJobsLimit),
        );
      } else {
        await refreshAutomatedBackups();
      }
    } catch (error) {
      toast.error(
        errorMessage(error, "Could not delete the selected backups."),
      );
    } finally {
      setAutomatedPending(false);
      setConfirmBulkDeleteAutomatedJobs(false);
    }
  }

  async function cancelAutomatedJob() {
    if (!cancelAutomatedJobId) return;
    setCancelAutomatedJobPending(true);
    try {
      await apiFetch(`/api/v1/backup/jobs/${cancelAutomatedJobId}/cancel`, {
        method: "POST",
      });
      toast.success("Cancellation requested.");
      await refreshAutomatedBackups();
    } catch (error) {
      toast.error(errorMessage(error, "Could not cancel the backup."));
    } finally {
      setCancelAutomatedJobPending(false);
      setCancelAutomatedJobId(null);
    }
  }

  return (
    <>
      <section
        id="automatic-backups-section"
        role="region"
        aria-labelledby="automatic-backups-title"
        className={cn(
          "border-border bg-surface overflow-hidden rounded-xl border shadow-sm",
          !visible && "hidden",
        )}
      >
        <div className="border-border bg-surface flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
              <RotateCcw className="size-4" />
            </span>
            <div className="min-w-0 sm:max-w-55 lg:max-w-xs">
              <h3
                id="automatic-backups-title"
                className="text-foreground text-sm font-semibold sm:text-base"
              >
                Automatic backups
              </h3>
              <p className="text-muted-foreground mt-0.5 hidden text-xs sm:block">
                A full recovery package - including password hashes - is
                written on a recurring schedule, with no confirmation step
                the way a manual export has.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="group/schedule-info relative inline-flex">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring border-border inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                aria-describedby="automated-backup-run-history"
              >
                <Info className="size-3.5" />
                Run history
              </button>
              <div
                id="automated-backup-run-history"
                role="tooltip"
                className="border-border bg-surface invisible absolute top-full right-0 z-10 mt-1.5 w-72 space-y-3 rounded-lg border p-3 text-xs opacity-0 shadow-lg transition-opacity duration-150 group-hover/schedule-info:visible group-hover/schedule-info:opacity-100 group-focus-within/schedule-info:visible group-focus-within/schedule-info:opacity-100"
              >
                <div className="flex items-center gap-2.5">
                  <Clock className="text-muted-foreground size-4 shrink-0" />
                  <div>
                    <p className="text-muted-foreground">Last run</p>
                    <p className="text-foreground mt-0.5 flex items-center gap-1.5 font-medium">
                      {automatedSettings?.last_run_at
                        ? new Date(automatedSettings.last_run_at).toLocaleString()
                        : "Never"}
                      {automatedSettings?.last_status ? (
                        <AutomatedBackupStatusBadge
                          status={automatedSettings.last_status}
                        />
                      ) : null}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <Clock className="text-muted-foreground size-4 shrink-0" />
                  <div>
                    <p className="text-muted-foreground">Next run</p>
                    <p className="text-foreground mt-0.5 font-medium">
                      {automatedSettings?.next_run_at
                        ? new Date(automatedSettings.next_run_at).toLocaleString()
                        : "Calculated after saving"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <label
              className={cn(
                "border-border bg-surface has-disabled:opacity-60 flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium",
                "has-disabled:cursor-not-allowed",
                "has-not-disabled:hover:bg-surface-hover has-not-disabled:hover:border-border-strong",
              )}
            >
              <input
                type="checkbox"
                checked={automatedSettings?.enabled ?? false}
                disabled={
                  !isEditingAutomatedSchedule ||
                  !automatedSettings ||
                  !automatedSettings.directory_configured
                }
                onChange={(event) =>
                  automatedSettings &&
                  setAutomatedSettings({
                    ...automatedSettings,
                    enabled: event.target.checked,
                  })
                }
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="bg-border-strong peer-checked:bg-success relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150"
              >
                <span className="bg-surface absolute top-0.5 left-0.5 size-3 rounded-full shadow-sm transition-transform duration-150 peer-checked:translate-x-3" />
              </span>
              {automatedSettings?.enabled ? "Enabled" : "Disabled"}
            </label>
            <Button
              type="button"
              size="sm"
              variant="primary"
              className="text-xs h-8"
              disabled={
                automatedPending || !automatedSettings?.directory_configured
              }
              onClick={() => void runAutomatedBackupNow()}
            >
              <Play className="size-3.5" /> Run now
            </Button>
            {isEditingAutomatedSchedule ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-xs h-8"
                  disabled={automatedPending}
                  onClick={cancelEditingAutomatedSchedule}
                >
                  <X className="size-3.5" /> Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  className="text-xs h-8"
                  disabled={automatedPending}
                  aria-busy={automatedPending}
                  onClick={() => void saveAutomatedBackups()}
                >
                  {automatedPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  Save schedule
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="text-xs h-8"
                disabled={!automatedSettings}
                onClick={() => setIsEditingAutomatedSchedule(true)}
              >
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
          </div>
        </div>
        {automatedSettings ? (
          <div className="space-y-6 p-6">
            {!automatedSettings.directory_configured ? (
              <div className="border-danger/30 bg-danger/10 flex items-start gap-2 rounded-lg border p-2.5 text-xs">
                <FolderOpen className="text-danger mt-0.5 size-4 shrink-0" />
                <p className="font-medium">
                  No backup directory is available. Set
                  WIKIHUB_AUTOMATED_BACKUP_DIRECTORY and mount a volume
                  there.
                </p>
              </div>
            ) : null}

            <div
              className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-border"
              aria-label="Schedule"
            >
              <div className="space-y-1 sm:pr-4">
                <label
                  htmlFor="automated-backup-interval"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Every
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="automated-backup-interval"
                    type="number"
                    min="1"
                    max="720"
                    value={automatedSettings.interval_value}
                    disabled={!isEditingAutomatedSchedule}
                    className="w-16 shrink-0"
                    onChange={(event) =>
                      setAutomatedSettings({
                        ...automatedSettings,
                        interval_value: Number(event.target.value) || 1,
                      })
                    }
                  />
                  <Select
                    value={automatedSettings.interval_unit}
                    disabled={!isEditingAutomatedSchedule}
                    onValueChange={(value) =>
                      setAutomatedSettings({
                        ...automatedSettings,
                        interval_unit: value as "hours" | "days",
                      })
                    }
                  >
                    <SelectTrigger aria-label="Interval unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hours">Hour</SelectItem>
                      <SelectItem value="days">Day</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1 sm:px-4">
                <label
                  htmlFor="automated-backup-time"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Start time
                </label>
                <Input
                  id="automated-backup-time"
                  type="time"
                  value={automatedSettings.time_of_day}
                  disabled={!isEditingAutomatedSchedule}
                  onChange={(event) =>
                    setAutomatedSettings({
                      ...automatedSettings,
                      time_of_day: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1 sm:px-4">
                <label
                  htmlFor="automated-backup-timezone"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Timezone
                </label>
                <TimezoneCombobox
                  id="automated-backup-timezone"
                  value={automatedSettings.timezone}
                  disabled={!isEditingAutomatedSchedule}
                  onValueChange={(timezone) =>
                    setAutomatedSettings({
                      ...automatedSettings,
                      timezone,
                    })
                  }
                />
              </div>
              <div className="space-y-1 sm:pl-4">
                <label
                  htmlFor="automated-backup-retention"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Keep backups
                </label>
                <Input
                  id="automated-backup-retention"
                  type="number"
                  min="1"
                  max="1000"
                  value={automatedSettings.retention_count}
                  disabled={!isEditingAutomatedSchedule}
                  onChange={(event) =>
                    setAutomatedSettings({
                      ...automatedSettings,
                      retention_count: Number(event.target.value) || 1,
                    })
                  }
                />
              </div>
            </div>

            {automatedSettings.last_error ? (
              <p className="text-danger text-xs">
                Last error: {automatedSettings.last_error}
              </p>
            ) : null}
            {automatedError ? (
              <p className="text-warning text-xs">{automatedError}</p>
            ) : null}

            {/* Recent backups */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h4 className="sr-only">Backup history</h4>
                {selectedAutomatedJobIds.length > 0 ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {selectedAutomatedJobIds.length} selected
                    </span>
                    <button
                      type="button"
                      className="text-danger hover:bg-danger-bg inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setConfirmBulkDeleteAutomatedJobs(true)}
                    >
                      <Trash2 className="size-3.5" /> Delete selected
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="border-border overflow-hidden rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-sunken text-muted-foreground">
                    <tr>
                      <th className="w-8 p-2">
                        <input
                          type="checkbox"
                          className="cursor-pointer disabled:cursor-not-allowed"
                          checked={
                            automatedJobs.length > 0 &&
                            automatedJobs.every((job) =>
                              selectedAutomatedJobIds.includes(job.id),
                            )
                          }
                          onChange={toggleSelectAllAutomatedJobsOnPage}
                          disabled={automatedJobs.length === 0}
                          aria-label="Select all backups on this page"
                        />
                      </th>
                      <SortableAutomatedJobsHeader
                        label="Backup"
                        sortKey="backup"
                        sort={automatedJobsSort}
                        onSort={toggleAutomatedJobsSort}
                      />
                      <SortableAutomatedJobsHeader
                        label="Status"
                        sortKey="status"
                        sort={automatedJobsSort}
                        onSort={toggleAutomatedJobsSort}
                      />
                      <SortableAutomatedJobsHeader
                        label="Completed at"
                        sortKey="completed_at"
                        sort={automatedJobsSort}
                        onSort={toggleAutomatedJobsSort}
                      />
                      <SortableAutomatedJobsHeader
                        label="Duration"
                        sortKey="duration"
                        sort={automatedJobsSort}
                        onSort={toggleAutomatedJobsSort}
                      />
                      <th className="p-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAutomatedJobs.length ? (
                      sortedAutomatedJobs.map((job) => (
                        <tr
                          key={job.id}
                          className="border-border hover:bg-surface-hover border-t"
                        >
                          <td className="p-2">
                            <input
                              type="checkbox"
                              className="cursor-pointer"
                              checked={selectedAutomatedJobIds.includes(job.id)}
                              onChange={() => toggleSelectAutomatedJob(job.id)}
                              aria-label={`Select ${job.output_filename ?? "this backup"}`}
                            />
                          </td>
                          <td className="p-2">
                            <span className="flex items-center gap-1.5">
                              <FileArchive className="text-muted-foreground size-3.5 shrink-0" />
                              {job.output_filename ??
                                new Date(job.created_at).toLocaleString()}
                            </span>
                          </td>
                          <td className="p-2">
                            <AutomatedBackupStatusBadge status={job.status} />
                          </td>
                          <td className="text-muted-foreground p-2">
                            {job.status === "complete" ? (
                              formatCompletedAt(job.updated_at)
                            ) : job.status === "running" ? (
                              <div className="w-28">
                                <div className="bg-surface-sunken h-1 overflow-hidden rounded-full">
                                  <div
                                    className="bg-primary h-full rounded-full transition-all duration-300"
                                    style={{
                                      width: `${job.percent ?? 0}%`,
                                    }}
                                  />
                                </div>
                                <p className="text-muted-foreground mt-0.5 text-[10px] whitespace-nowrap">
                                  {job.percent != null
                                    ? `${job.percent}% · ${formatDuration(job.eta_seconds)}`
                                    : "Starting…"}
                                </p>
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="text-muted-foreground p-2">
                            {automatedJobDuration(job)}
                          </td>
                          <td className="p-2">
                            {job.status === "queued" ||
                            job.status === "running" ? (
                              <button
                                type="button"
                                className="text-danger hover:bg-danger-bg disabled:text-muted-foreground disabled:pointer-events-none inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                disabled={job.cancel_requested}
                                onClick={() => setCancelAutomatedJobId(job.id)}
                              >
                                <X className="size-3.5" />{" "}
                                {job.cancel_requested ? "Cancelling…" : "Cancel"}
                              </button>
                            ) : job.download_url ? (
                              <a
                                className="text-primary hover:bg-primary/10 inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                href={job.download_url}
                              >
                                <Download className="size-3.5" /> Download
                              </a>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={6}
                          className="text-muted-foreground p-3 text-center"
                        >
                          No scheduled backups have run yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-0.5 text-xs">
                <p className="text-muted-foreground" aria-live="polite">
                  {automatedJobsTotal === 0
                    ? "No results"
                    : `Showing ${automatedJobsOffset + 1}–${Math.min(
                        automatedJobsOffset + automatedJobsLimit,
                        automatedJobsTotal,
                      )} of ${automatedJobsTotal}`}
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="automated-jobs-page-size"
                      className="text-muted-foreground"
                    >
                      Rows per page
                    </label>
                    <Select
                      value={String(automatedJobsLimit)}
                      onValueChange={(value) => {
                        setAutomatedJobsLimit(Number(value));
                        setAutomatedJobsOffset(0);
                      }}
                    >
                      <SelectTrigger
                        id="automated-jobs-page-size"
                        className="h-8 w-20"
                        aria-label="Rows per page"
                      >
                        <SelectValue>{automatedJobsLimit}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {AUTOMATED_JOBS_PAGE_SIZES.map((size) => (
                          <SelectItem key={size} value={String(size)}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <span className="text-muted-foreground hidden sm:inline">
                    Page{" "}
                    {automatedJobsTotal === 0
                      ? 0
                      : Math.floor(automatedJobsOffset / automatedJobsLimit) + 1}{" "}
                    of{" "}
                    {Math.max(
                      1,
                      Math.ceil(automatedJobsTotal / automatedJobsLimit),
                    )}
                  </span>
                  <span className="border-border h-5 border-l" aria-hidden />
                  <Button
                    variant="secondary"
                    size="icon"
                    disabled={automatedJobsOffset === 0}
                    onClick={() =>
                      setAutomatedJobsOffset((current) =>
                        Math.max(0, current - automatedJobsLimit),
                      )
                    }
                    aria-label="Previous page"
                    title="Previous page"
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    disabled={
                      automatedJobsOffset + automatedJobsLimit >=
                      automatedJobsTotal
                    }
                    onClick={() =>
                      setAutomatedJobsOffset(
                        (current) => current + automatedJobsLimit,
                      )
                    }
                    aria-label="Next page"
                    title="Next page"
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="flex flex-wrap items-center gap-3 p-6 text-sm"
            role="status"
          >
            <p className="text-muted-foreground">
              {automatedError ?? "Loading automatic backup settings…"}
            </p>
            {automatedError ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void refreshAutomatedBackups()}
              >
                <RotateCcw /> Retry
              </Button>
            ) : null}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmBulkDeleteAutomatedJobs}
        onOpenChange={(open) => {
          if (!open) setConfirmBulkDeleteAutomatedJobs(false);
        }}
        title={`Delete ${selectedAutomatedJobIds.length} automatic backup${selectedAutomatedJobIds.length === 1 ? "" : "s"}?`}
        description="This permanently removes the backup ZIP(s) from the configured server partition."
        confirmLabel="Delete backups"
        destructive
        pending={automatedPending}
        onConfirm={() => void bulkDeleteAutomatedBackups()}
      />
      <ConfirmDialog
        open={cancelAutomatedJobId !== null}
        onOpenChange={(open) => {
          if (!open) setCancelAutomatedJobId(null);
        }}
        title="Cancel this backup?"
        description="The scheduled backup in progress will stop at its next checkpoint and its partial file will be discarded."
        confirmLabel="Cancel backup"
        destructive
        pending={cancelAutomatedJobPending}
        onConfirm={() => void cancelAutomatedJob()}
      />
    </>
  );
}
