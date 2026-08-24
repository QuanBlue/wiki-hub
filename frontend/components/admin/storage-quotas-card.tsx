"use client";

import { Check, ChevronDown, ChevronRight, HardDrive, Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import type { SiteSettings } from "@/types/api";

/**
 * Import/upload size limits and allowed attachment types. Lives on Admin >
 * Storage rather than a Settings tab - it governs the same object-storage
 * bucket the file browser below manages, so editing it here keeps the quota
 * next to the usage it actually limits.
 *
 * Collapsed by default: browsing/monitoring the bucket is what this page is
 * opened for most of the time, and quotas are an occasional edit. The
 * collapsed header still surfaces the current effective values so there is
 * no need to expand it just to check them.
 */
export function StorageQuotasCard({ settings }: { settings: SiteSettings }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const initialMaxUpload = settings.overrides.max_upload_size_mb?.toString() ?? "";
  const initialMaxBackup =
    settings.overrides.max_backup_import_size_mb?.toString() ?? "";
  const initialTypes = settings.overrides.allowed_attachment_types?.join(", ") ?? "";

  const [maxUpload, setMaxUpload] = useState(initialMaxUpload);
  const [maxBackupImport, setMaxBackupImport] = useState(initialMaxBackup);
  const [types, setTypes] = useState(initialTypes);
  const [pending, setPending] = useState(false);

  const isChanged =
    maxUpload.trim() !== initialMaxUpload.trim() ||
    maxBackupImport.trim() !== initialMaxBackup.trim() ||
    types.trim() !== initialTypes.trim();

  const inheritedTag = (overridden: boolean) =>
    overridden ? null : (
      <span className="text-muted-foreground text-[11px] font-normal italic">
        (inherited from environment)
      </span>
    );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await api.patch<SiteSettings>("/api/v1/settings", {
        max_upload_size_mb: maxUpload.trim() ? Number(maxUpload) : null,
        max_backup_import_size_mb: maxBackupImport.trim()
          ? Number(maxBackupImport)
          : null,
        allowed_attachment_types: types.trim()
          ? types
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : null,
      });
      toast.success("Storage settings saved successfully.");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not save the settings.",
      );
    } finally {
      setPending(false);
    }
  }

  const summary = `Max attachment ${settings.effective.max_upload_size_mb} MB · Max archive ${settings.effective.max_backup_import_size_mb} MB · ${
    settings.effective.allowed_attachment_types.includes("*")
      ? "all file types allowed"
      : `${settings.effective.allowed_attachment_types.length} extension${settings.effective.allowed_attachment_types.length === 1 ? "" : "s"} allowed`
  }`;

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border bg-surface rounded-xl border shadow-sm"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 rounded-t-xl px-6 py-3.5 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {expanded ? (
            <ChevronDown className="text-muted-foreground size-4 shrink-0" />
          ) : (
            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
          )}
          <HardDrive className="text-info size-5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-foreground font-semibold text-sm sm:text-base">
              Storage &amp; File Quotas
            </h3>
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {expanded ? "Control imports and attachment limits for this bucket." : summary}
            </p>
          </div>
        </div>
        {isChanged ? (
          <span className="text-warning bg-warning/10 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
            Unsaved changes
          </span>
        ) : null}
      </button>

      {expanded ? (
        <>
          <div className="border-border bg-surface/98 backdrop-blur-md flex flex-wrap items-center justify-end gap-2 border-t px-6 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs h-8"
              disabled={pending || (!isChanged && !maxUpload && !maxBackupImport && !types)}
              onClick={() => {
                setMaxUpload("");
                setMaxBackupImport("");
                setTypes("");
              }}
            >
              <RotateCcw className="size-3.5" />
              Reset Storage
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="text-xs h-8 font-semibold shadow-xs gap-1.5"
              disabled={pending || !isChanged}
            >
              {pending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="size-3.5" />
                  Save Storage
                </>
              )}
            </Button>
          </div>

          <div className="border-border border-t p-6 space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              {/* Max Backup Import */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="max-backup-import" className="text-sm font-semibold">
                    Max Confluence / Backup Archive (MB)
                  </Label>
                  {inheritedTag(settings.overrides.max_backup_import_size_mb !== null)}
                </div>
                <Input
                  id="max-backup-import"
                  type="number"
                  min={1}
                  max={102400}
                  value={maxBackupImport}
                  onChange={(e) => setMaxBackupImport(e.target.value)}
                  placeholder={String(settings.effective.max_backup_import_size_mb)}
                  disabled={pending}
                  className="text-sm"
                />
                <p className="text-muted-foreground text-[11px]">
                  Upper limit for uploaded Confluence spaces or full backups. Default:
                  1024 MB.
                </p>
              </div>

              {/* Max Attachment Size */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="max-upload-size" className="text-sm font-semibold">
                    Max Single Attachment Size (MB)
                  </Label>
                  {inheritedTag(settings.overrides.max_upload_size_mb !== null)}
                </div>
                <Input
                  id="max-upload-size"
                  type="number"
                  min={1}
                  max={10240}
                  value={maxUpload}
                  onChange={(e) => setMaxUpload(e.target.value)}
                  placeholder={String(settings.effective.max_upload_size_mb)}
                  disabled={pending}
                  className="text-sm"
                />
                <p className="text-muted-foreground text-[11px]">
                  Upper limit for inline files attached to pages. Default: 50 MB.
                </p>
              </div>

              {/* Allowed File Types */}
              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="allowed-types" className="text-sm font-semibold">
                    Allowed Attachment File Extensions
                  </Label>
                  {inheritedTag(settings.overrides.allowed_attachment_types !== null)}
                </div>
                <Input
                  id="allowed-types"
                  value={types}
                  onChange={(e) => setTypes(e.target.value)}
                  placeholder={settings.effective.allowed_attachment_types.join(", ")}
                  disabled={pending}
                  className="text-sm font-mono"
                />
                <p className="text-muted-foreground text-[11px]">
                  Comma-separated list (e.g.{" "}
                  <code className="text-foreground">png, jpg, pdf, zip</code>). Use{" "}
                  <code className="text-foreground">*</code> to permit all file types.
                </p>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </form>
  );
}
