"use client";

import {
  Check,
  CircleAlert,
  Loader2,
  Power,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatBytes, ProgressBar } from "@/components/ui/job-progress";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OllamaStatus } from "@/lib/admin-ai";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/** A bar with its percentage beside it: the share of the cap in use, never above 100. */
function UsageBar({ percent, label }: { percent: number; label: string }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex items-center gap-3 [&>div]:flex-1">
      <ProgressBar
        percent={value}
        label={label}
        trackClassName="bg-surface-sunken"
      />
      <span className="mt-2 w-10 text-right text-xs">{value}%</span>
    </div>
  );
}

/** A whole-number cap reads "3 GB", not "3.00 GB". */
function formatLimit(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${Number(gb.toFixed(1))} GB` : formatBytes(bytes);
}

/** The container's memory cap in bytes: what is applied, else the configured "3g" style value. */
function memoryLimitBytes(status: {
  applied_memory_mb: number | null;
  memory_limit: string;
}): number {
  if (status.applied_memory_mb) return status.applied_memory_mb * 1024 * 1024;
  const match = /^(\d+(?:\.\d+)?)\s*([kmg])?b?$/i.exec(
    status.memory_limit.trim(),
  );
  if (!match) return 1;
  const unit = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[
    (match[2] ?? "m").toLowerCase() as "k" | "m" | "g"
  ];
  return Number(match[1]) * unit;
}

const POLL_WHILE_BUSY_MS = 1500;
const POLL_IDLE_MS = 20000;
const STEPS = ["image", "start", "ready", "model"] as const;
const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  image: "adminAi.ollamaStepImage",
  start: "adminAi.ollamaStepStart",
  ready: "adminAi.ollamaStepReady",
  model: "adminAi.ollamaStepModel",
};

/**
 * The self-hosted Ollama's status, kept fresh: every 1.5 s while it installs or
 * starts (that is what makes the progress bar move), rarely otherwise.
 */
export function useOllama(enabled: boolean) {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await api.get<OllamaStatus>("/api/v1/ai/ollama");
      if (!alive.current) return;
      setStatus(next);
      setFailed(false);
      return next;
    } catch {
      if (alive.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    async function tick() {
      const next = await refresh();
      const busy = next?.state === "installing" || next?.state === "starting";
      timer.current = setTimeout(
        () => void tick(),
        busy ? POLL_WHILE_BUSY_MS : POLL_IDLE_MS,
      );
    }
    void tick();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, refresh]);

  return { status, failed, refresh, setStatus };
}

function StepRow({
  state,
  label,
  detail,
}: {
  state: "done" | "active" | "waiting";
  label: string;
  detail?: string;
}) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border",
          state === "done" && "border-success/40 bg-success-bg text-success",
          state === "active" && "border-info/40 bg-info-bg text-info",
          state === "waiting" && "border-border text-muted-foreground",
        )}
      >
        {state === "done" ? (
          <Check className="size-3" />
        ) : state === "active" ? (
          <Loader2 className="size-3 animate-spin" />
        ) : null}
      </span>
      <span
        className={cn(
          state === "waiting" ? "text-muted-foreground" : "text-foreground",
          state === "active" && "font-medium",
        )}
      >
        {label}
      </span>
      {detail ? (
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {detail}
        </span>
      ) : null}
    </li>
  );
}

/**
 * Administration > AI assistant > Semantic search: install, run and stop the
 * Ollama that WikiHub hosts itself. While it is off nothing runs at all.
 */
export function OllamaCard({
  status,
  failed,
  onChange,
  onRefresh,
  children,
  actions,
}: {
  status: OllamaStatus | null;
  failed: boolean;
  /** Called after any action, with the fresh status, so the page can follow along. */
  onChange: (next: OllamaStatus) => void;
  /** Ask for the status again (the "Try again" of an unreachable controller). */
  onRefresh: () => void;
  /** Shown while Ollama runs, under its numbers: the model WikiHub uses for search. */
  children?: ReactNode;
  /** Buttons that go on the same row as Disable, to its right. */
  actions?: ReactNode;
}) {
  const { t, apiErrorText } = useTranslation();
  const [model, setModel] = useState<string>("bge-m3");
  const [busy, setBusy] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState("");
  const [confirm, setConfirm] = useState<"disable" | "delete" | null>(null);

  async function run(action: () => Promise<OllamaStatus>, errorKey: string) {
    setBusy(true);
    try {
      onChange(await action());
    } catch (error) {
      toast.error(apiErrorText(error, errorKey));
    } finally {
      setBusy(false);
    }
  }

  const enable = (name: string) =>
    run(
      () => api.post<OllamaStatus>("/api/v1/ai/ollama/enable", { model: name }),
      "adminAi.ollamaActionError",
    );

  if (!status) {
    return (
      <div
        className="border-border bg-surface rounded-xl border p-4 text-sm"
        role="status"
      >
        {failed ? (
          <p className="text-danger flex items-center gap-2">
            <CircleAlert className="size-4" aria-hidden />
            {t("adminAi.ollamaLoadError")}
          </p>
        ) : (
          <p className="text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("adminAi.ollamaLoading")}
          </p>
        )}
      </div>
    );
  }

  const installing = status.state === "installing";
  const stateBadge: Record<
    string,
    { variant: "success" | "info" | "neutral" | "danger"; label: string }
  > = {
    running: { variant: "success", label: t("adminAi.ollamaStateRunning") },
    starting: { variant: "info", label: t("adminAi.ollamaStateStarting") },
    installing: { variant: "info", label: t("adminAi.ollamaStateInstalling") },
    stopped: { variant: "neutral", label: t("adminAi.ollamaStateStopped") },
    not_installed: {
      variant: "neutral",
      label: t("adminAi.ollamaStateNotInstalled"),
    },
    error: { variant: "danger", label: t("adminAi.ollamaStateError") },
    controller_down: {
      variant: "danger",
      label: t("adminAi.ollamaStateError"),
    },
    docker_unavailable: {
      variant: "danger",
      label: t("adminAi.ollamaStateError"),
    },
  };
  const badge = stateBadge[status.state] ?? stateBadge.not_installed!;
  const missingModels = status.available_models.filter(
    (choice) =>
      !status.models.some(
        (name) => name.split(":")[0] === choice.name.split(":")[0],
      ),
  );
  const currentStep = STEPS.indexOf(status.step as (typeof STEPS)[number]);
  // Running: only models not downloaded yet can be picked. Off: any of them.
  const offered =
    status.state === "running" ? missingModels : status.available_models;
  const target = offered.some((choice) => choice.name === model)
    ? model
    : (offered[0]?.name ?? model);
  const chosen = offered.find((choice) => choice.name === target);

  const modelPicker = (
    <div className="space-y-1.5">
      <Label htmlFor="ollama-model">{t("adminAi.ollamaModelLabel")}</Label>
      <Select value={target} onValueChange={setModel}>
        <SelectTrigger
          id="ollama-model"
          aria-label={t("adminAi.ollamaModelLabel")}
        >
          <SelectValue>{target}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          {offered.map((choice) => (
            <SelectItem key={choice.name} value={choice.name}>
              <span className="font-mono text-xs">{choice.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const modelNote = chosen ? (
    <p className="text-muted-foreground text-xs">{chosen.note}</p>
  ) : null;

  return (
    <div className="border-border bg-surface space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t("adminAi.ollamaTitle")}</h4>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      {status.state === "controller_down" ||
      status.state === "docker_unavailable" ? (
        <div role="alert" className="space-y-2">
          <p className="text-danger flex items-start gap-2 text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {status.error}
          </p>
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            <RotateCw aria-hidden />
            {t("adminAi.ollamaRetry")}
          </Button>
        </div>
      ) : null}

      {status.state === "not_installed" || status.state === "stopped" ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {t("adminAi.ollamaIntro")}
          </p>
          {status.state === "not_installed" ? (
            <p className="text-muted-foreground text-xs">
              {t("adminAi.ollamaCost")}
            </p>
          ) : null}
          {modelPicker}
          {modelNote}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={() => void enable(target)}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Power aria-hidden />
              )}
              {t("adminAi.ollamaEnable")}
            </Button>
            {status.state === "stopped" && status.volume_present ? (
              <Button
                variant="ghost"
                onClick={() => setConfirm("delete")}
                disabled={busy}
              >
                <Trash2 aria-hidden />
                {t("adminAi.ollamaDeleteModels")}
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            {t("adminAi.ollamaControllerNote")}
          </p>
        </div>
      ) : null}

      {installing ? (
        <div className="space-y-3">
          <ol className="space-y-2" aria-label={t("adminAi.ollamaTitle")}>
            {STEPS.map((step, index) => {
              const state =
                index < currentStep
                  ? "done"
                  : index === currentStep
                    ? "active"
                    : "waiting";
              const active = state === "active";
              return (
                <StepRow
                  key={step}
                  state={state}
                  label={t(STEP_LABEL[step], { model: status.model || model })}
                  detail={
                    active && status.total > 0
                      ? `${formatBytes(status.current)} / ${formatBytes(status.total)} · ${status.percent}%`
                      : undefined
                  }
                />
              );
            })}
          </ol>
          <ProgressBar
            percent={status.overall}
            label={t("adminAi.ollamaStepAria", { percent: status.overall })}
            trackClassName="bg-surface-sunken border border-border"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              {t("adminAi.ollamaInstallHint")}
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(
                  () => api.post<OllamaStatus>("/api/v1/ai/ollama/cancel"),
                  "adminAi.ollamaActionError",
                )
              }
            >
              <X aria-hidden />
              {t("adminAi.ollamaCancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {status.state === "starting" ? (
        <p
          className="text-muted-foreground flex items-center gap-2 text-sm"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("adminAi.ollamaStarting")}
        </p>
      ) : null}

      {status.state === "error" ? (
        <div role="alert" className="space-y-3">
          <p className="text-danger flex items-start gap-2 text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {status.error}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void enable(target)}
            disabled={busy}
          >
            <RotateCw aria-hidden />
            {t("adminAi.ollamaRetry")}
          </Button>
        </div>
      ) : null}

      {status.state === "running" ? (
        <div className="space-y-3">
          {status.notice && dismissedNotice !== status.notice ? (
            <div
              role="status"
              className="border-warning/40 bg-warning-bg flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <p className="flex items-start gap-2">
                <CircleAlert
                  className="text-warning mt-0.5 size-4 shrink-0"
                  aria-hidden
                />
                {status.notice}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDismissedNotice(status.notice ?? "")}
              >
                {t("adminAi.ollamaDismiss")}
              </Button>
            </div>
          ) : null}
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            {status.memory_bytes ? (
              <>
                <dt className="text-muted-foreground">
                  {t("adminAi.ollamaMemory")}
                </dt>
                <dd className="max-w-sm tabular-nums">
                  {formatBytes(status.memory_bytes)} /{" "}
                  {formatLimit(memoryLimitBytes(status))}
                  <UsageBar
                    percent={Math.round(
                      (status.memory_bytes / memoryLimitBytes(status)) * 100,
                    )}
                    label={t("adminAi.ollamaMemory")}
                  />
                </dd>
              </>
            ) : null}
            {status.cpu_percent != null && status.memory_bytes ? (
              <>
                <dt className="text-muted-foreground">
                  {t("adminAi.ollamaCpu")}
                </dt>
                <dd className="max-w-sm tabular-nums">
                  {t("adminAi.ollamaCpuValue", {
                    used: (status.cpu_percent / 100).toFixed(1),
                    total: status.applied_cpus || status.host_cpus,
                  })}
                  <UsageBar
                    percent={Math.round(
                      status.cpu_percent /
                        (status.applied_cpus || status.host_cpus),
                    )}
                    label={t("adminAi.ollamaCpu")}
                  />
                </dd>
              </>
            ) : null}
          </dl>

          {children}

          {status.restart_needed ? (
            <div
              role="status"
              className="border-warning/40 bg-warning-bg space-y-2 rounded-md border p-3 text-sm"
            >
              <p>
                {t("adminAi.ollamaRestartNeeded", {
                  memory: status.applied_memory_mb
                    ? `${(status.applied_memory_mb / 1024).toFixed(1)} GB`
                    : "-",
                  cpus: status.applied_cpus
                    ? t("adminAi.tuneCoresCount", {
                        count: status.applied_cpus,
                      })
                    : t("adminAi.tuneAllCores"),
                  keep: t(
                    `adminAi.tuneKeepAlive_${status.applied_keep_alive ?? "5m"}`,
                  ),
                })}
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void enable(status.models[0]?.split(":")[0] ?? target)
                }
              >
                {busy ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <RotateCw aria-hidden />
                )}
                {t("adminAi.ollamaRestart")}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirm("disable")}
              disabled={busy}
            >
              <Power aria-hidden />
              {t("adminAi.ollamaDisable")}
            </Button>
            {actions}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === "disable"}
        onOpenChange={(open) => setConfirm(open ? "disable" : null)}
        title={t("adminAi.ollamaDisableTitle")}
        description={t("adminAi.ollamaDisableBody")}
        confirmLabel={t("adminAi.ollamaDisable")}
        cancelLabel={t("common.cancel")}
        pending={busy}
        onConfirm={() => {
          setConfirm(null);
          void run(
            () => api.post<OllamaStatus>("/api/v1/ai/ollama/disable"),
            "adminAi.ollamaActionError",
          );
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => setConfirm(open ? "delete" : null)}
        title={t("adminAi.ollamaDeleteTitle")}
        description={t("adminAi.ollamaDeleteBody")}
        confirmLabel={t("adminAi.ollamaDeleteModels")}
        cancelLabel={t("common.cancel")}
        destructive
        pending={busy}
        onConfirm={() => {
          setConfirm(null);
          void run(
            () => api.delete<OllamaStatus>("/api/v1/ai/ollama/models"),
            "adminAi.ollamaActionError",
          );
        }}
      />
    </div>
  );
}
