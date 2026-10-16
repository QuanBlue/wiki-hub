"use client";

import { Copy, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ContainerInfo, ContainerLogs } from "@/lib/admin-monitor";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

const TAILS = [100, 200, 500, 1000] as const;
const FOLLOW_MS = 4000;

/** Colour a line by how serious it reads: logs are scanned, not read. */
function tone(line: string): string {
  if (/\b(error|exception|traceback|fatal|critical|failed)\b/i.test(line))
    return "text-danger";
  if (/\b(warn|warning)\b/i.test(line)) return "text-warning";
  return "text-foreground";
}

/**
 * The last lines of one container's output, with a filter, a length choice and an
 * optional "follow" that refreshes every few seconds. Credentials are hidden by the
 * server before they get here.
 */
export function LogsDialog({
  container,
  onClose,
}: {
  container: ContainerInfo | null;
  onClose: () => void;
}) {
  const { t, apiErrorText } = useTranslation();
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tail, setTail] = useState<(typeof TAILS)[number]>(200);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(false);
  const box = useRef<HTMLPreElement>(null);
  const name = container?.name;

  const load = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    try {
      const result = await api.get<ContainerLogs>(
        `/api/v1/admin/monitor/containers/${encodeURIComponent(name)}/logs?tail=${tail}`,
      );
      setLines(result.lines);
      setError("");
    } catch (failure) {
      setError(apiErrorText(failure, "adminMonitor.logsError"));
    } finally {
      setLoading(false);
    }
  }, [name, tail, apiErrorText]);

  useEffect(() => {
    if (!name) return;
    // Deferred a tick: the first load sets state, which an effect may not do synchronously.
    const first = setTimeout(() => void load(), 0);
    const timer = follow
      ? setInterval(() => void load(), FOLLOW_MS)
      : undefined;
    return () => {
      clearTimeout(first);
      if (timer) clearInterval(timer);
    };
  }, [name, load, follow]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (lines ?? []).filter(
      (line) => !needle || line.toLowerCase().includes(needle),
    );
  }, [lines, filter]);

  // Newest line in view, like `docker logs -f`, unless the reader scrolled up.
  useEffect(() => {
    const element = box.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [shown]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown.join("\n"));
      toast.success(t("adminMonitor.logsCopied"));
    } catch {
      toast.error(t("adminMonitor.logsCopyError"));
    }
  }

  return (
    <Dialog
      open={container !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogContent
        className="max-w-4xl"
        title={t("adminMonitor.logsTitle", { name: container?.name ?? "" })}
        description={t("adminMonitor.logsDescription")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("adminMonitor.logsFilter")}
            aria-label={t("adminMonitor.logsFilter")}
            className="min-w-48 flex-1"
            autoComplete="off"
          />
          <div
            role="group"
            aria-label={t("adminMonitor.logsLines")}
            className="flex items-center gap-1"
          >
            {TAILS.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={tail === size}
                onClick={() => setTail(size)}
                className={cn(
                  "focus-visible:ring-ring cursor-pointer rounded-md px-2 py-1 text-xs tabular-nums transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  tail === size
                    ? "bg-surface-selected text-primary font-semibold"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {size}
              </button>
            ))}
          </div>
          <label className="hover:bg-surface-hover flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors duration-150">
            <input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
              className="accent-primary focus-visible:ring-ring size-4 cursor-pointer focus-visible:ring-2 focus-visible:outline-none"
            />
            {t("adminMonitor.logsFollow")}
          </label>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void load()}
            disabled={loading}
            aria-label={t("adminMonitor.refresh")}
            title={t("adminMonitor.refresh")}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void copy()}
            disabled={shown.length === 0}
            aria-label={t("adminMonitor.logsCopy")}
            title={t("adminMonitor.logsCopy")}
          >
            <Copy />
          </Button>
        </div>

        {error ? (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        ) : null}

        <pre
          ref={box}
          tabIndex={0}
          aria-label={t("adminMonitor.logsTitle", {
            name: container?.name ?? "",
          })}
          className="bg-surface-sunken border-border wh-scroll focus-visible:ring-ring h-[55vh] overflow-auto rounded-md border p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap focus-visible:ring-2 focus-visible:outline-none"
        >
          {lines === null && !error ? (
            <span className="text-muted-foreground">
              {t("adminMonitor.loading")}
            </span>
          ) : shown.length === 0 ? (
            <span className="text-muted-foreground">
              {lines && lines.length
                ? t("adminMonitor.logsNoMatch")
                : t("adminMonitor.logsEmpty")}
            </span>
          ) : (
            shown.map((line, index) => (
              <span key={index} className={cn("block", tone(line))}>
                {line}
              </span>
            ))
          )}
        </pre>
        <p className="text-muted-foreground text-xs">
          {t("adminMonitor.logsCount", {
            shown: shown.length,
            total: lines?.length ?? 0,
          })}{" "}
          · {t("adminMonitor.logsRedacted")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
