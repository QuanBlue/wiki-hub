"use client";

import {
  Archive,
  ArrowUpFromLine,
  Download,
  HardDrive,
  ListChecks,
  Loader2,
} from "lucide-react";
import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PortableJobCard } from "./backup-ui-primitives";
import {
  backupFeatures,
  type JobLogEntry,
  type PortableBackupJob,
} from "./types";

export type ExportSectionProps = {
  visible: boolean;
  isDownloading: boolean;
  isPortableJobRunning: boolean;
  isFullExportRunning: boolean;
  isConfluenceExportRunning: boolean;
  confluenceExportProfile: string;
  setConfluenceExportProfile: (profile: string) => void;
  includeCredentials: boolean;
  setIncludeCredentials: (include: boolean) => void;
  exportSpaceScope: "all" | "selected";
  setExportSpaceScope: (scope: "all" | "selected") => void;
  exportSelectedSpaceKeys: string[];
  isExportOptionsOpen: boolean;
  setIsExportOptionsOpen: (open: boolean) => void;
  onOpenExportSpacePicker: () => void;
  onCreatePortableExport: (
    kind: "full_export" | "confluence_export",
  ) => Promise<void>;
  portableBackupJob: PortableBackupJob | null;
  cancelExportPending: boolean;
  onRequestCancelExport: () => void;
  restoreLogEntries: JobLogEntry[];
  restoreLogsExpanded: boolean;
  onRestoreLogsExpandedChange: (expanded: boolean) => void;
  restoreLogsListRef: Ref<HTMLUListElement>;
};

export function ExportSection({
  visible,
  isDownloading,
  isPortableJobRunning,
  isFullExportRunning,
  isConfluenceExportRunning,
  confluenceExportProfile,
  setConfluenceExportProfile,
  includeCredentials,
  setIncludeCredentials,
  exportSpaceScope,
  setExportSpaceScope,
  exportSelectedSpaceKeys,
  isExportOptionsOpen,
  setIsExportOptionsOpen,
  onOpenExportSpacePicker,
  onCreatePortableExport,
  portableBackupJob,
  cancelExportPending,
  onRequestCancelExport,
  restoreLogEntries,
  restoreLogsExpanded,
  onRestoreLogsExpandedChange,
  restoreLogsListRef,
}: ExportSectionProps) {
  return (
    <>
      <section
        id="backup-export-section"
        role="tabpanel"
        className={cn(
          "border-border bg-surface overflow-hidden rounded-xl border p-5 shadow-sm",
          !visible && "hidden",
        )}
      >
        <div className="mb-5">
          <h2 className="flex items-center gap-2.5 text-base font-semibold">
            <span className="bg-primary-subtle text-primary flex size-8 items-center justify-center rounded-md">
              <Archive className="size-4" />
            </span>
            Export & Backup workspace data
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Two separate export formats are available. They serve different
            purposes and are{" "}
            <strong className="text-foreground font-medium">
              not interchangeable
            </strong>
            .
          </p>
        </div>

        {/* 2 Export Option Cards — distinct colour accents to prevent confusion */}
        <div className="grid grid-cols-1 gap-0 md:grid-cols-[1fr_auto_1fr]">
          {/* Card 1: WikiHub Native Backup */}
          <div className="border-border bg-surface-raised flex flex-col overflow-hidden rounded-xl border shadow-sm">
            <div className="flex flex-1 flex-col p-4">
              {/* Header */}
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
                    <HardDrive className="size-4" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Export WikiHub Backup
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-[11px]">
                      Native restore package
                    </div>
                  </div>
                </div>
                <span className="bg-primary-subtle text-primary shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
                  Native
                </span>
              </div>

              {/* Purpose */}
              <p className="text-muted-foreground text-xs leading-relaxed">
                A complete{" "}
                <code className="text-foreground bg-surface-sunken rounded px-1 py-0.5 font-mono text-[11px]">
                  .zip
                </code>{" "}
                of all spaces, pages, revisions and attachments. Use this to{" "}
                <span className="text-foreground font-medium">
                  restore WikiHub itself
                </span>{" "}
                — on a new server, after data loss, or before a major upgrade.
              </p>

              <div className="mt-auto pt-4">
                <Button
                  type="button"
                  variant="primary"
                  className="w-full"
                  disabled={isDownloading || isPortableJobRunning}
                  aria-busy={isFullExportRunning}
                  onClick={() => setIsExportOptionsOpen(true)}
                >
                  {isFullExportRunning ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  {isFullExportRunning ? "Exporting…" : "Export WikiHub Backup"}
                </Button>
              </div>
            </div>
          </div>

          {/* "or" divider between the two cards */}
          <div className="flex items-center justify-center py-4 md:flex-col md:px-4 md:py-0">
            <div className="bg-border h-px w-full md:h-full md:w-px" />
            <span className="bg-surface border-border text-muted-foreground mx-3 shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium md:mx-0 md:my-3">
              or
            </span>
            <div className="bg-border h-px w-full md:h-full md:w-px" />
          </div>

          {/* Card 2: Confluence DC Export */}
          <div className="border-border bg-surface-raised flex flex-col overflow-hidden rounded-xl border shadow-sm">
            <div className="flex flex-1 flex-col p-4">
              {/* Header */}
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: "hsl(38 92% 50% / 0.12)",
                      color: "hsl(38 92% 50%)",
                    }}
                  >
                    <ArrowUpFromLine className="size-4" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Export Confluence Backup
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-[11px]">
                      Migration / hand-off format
                    </div>
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: "hsl(38 92% 50% / 0.12)",
                    color: "hsl(38 92% 50%)",
                  }}
                >
                  Incoming
                </span>
              </div>

              {/* Purpose */}
              <p className="text-muted-foreground text-xs leading-relaxed">
                An XML archive compatible with Atlassian Confluence Data Center
                restore tools. Use this to{" "}
                <span className="text-foreground font-medium">
                  hand content off to a Confluence instance
                </span>{" "}
                — it cannot be used to restore WikiHub.
                <span className="text-foreground mt-1.5 block font-medium">
                  Coming soon: this export is switched off for now while it is
                  finished.
                </span>
              </p>

              <div className="mt-auto space-y-2 pt-4">
                <Select
                  value={confluenceExportProfile}
                  onValueChange={(val) => setConfluenceExportProfile(val)}
                  disabled={
                    !backupFeatures.confluenceExport ||
                    isDownloading ||
                    isPortableJobRunning
                  }
                >
                  <SelectTrigger
                    aria-label="Confluence Data Center target version"
                    className="h-9 w-full text-xs"
                  >
                    <SelectValue placeholder="Choose target version" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dc-8">Data Center 8.x</SelectItem>
                    <SelectItem value="dc-9">Data Center 9.x</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="primary"
                  className="w-full"
                  disabled={
                    !backupFeatures.confluenceExport ||
                    isDownloading ||
                    isPortableJobRunning ||
                    !confluenceExportProfile
                  }
                  aria-busy={isDownloading || isConfluenceExportRunning}
                  onClick={() => void onCreatePortableExport("confluence_export")}
                >
                  {isDownloading || isConfluenceExportRunning ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ArrowUpFromLine />
                  )}
                  {!backupFeatures.confluenceExport
                    ? "Coming soon"
                    : isConfluenceExportRunning
                      ? "Exporting…"
                      : "Export DC XML"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <PortableJobCard
          forKind="export"
          portableBackupJob={portableBackupJob}
          isPortableJobRunning={isPortableJobRunning}
          cancelExportPending={cancelExportPending}
          onRequestCancel={onRequestCancelExport}
          restoreLogEntries={restoreLogEntries}
          restoreLogsExpanded={restoreLogsExpanded}
          onRestoreLogsExpandedChange={onRestoreLogsExpandedChange}
          restoreLogsListRef={restoreLogsListRef}
        />
      </section>

      <Dialog open={isExportOptionsOpen} onOpenChange={setIsExportOptionsOpen}>
        <DialogContent
          title="Export WikiHub Backup"
          description="A complete .zip of spaces, pages, revisions and attachments — used to restore WikiHub itself."
          className="max-w-lg"
        >
          <div className="space-y-3">
            {/* Scope — every space by default, or a hand-picked subset */}
            <div className="border-border bg-surface-sunken rounded-lg border p-3 text-xs">
              <div className="flex min-h-8 flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="export-space-scope"
                    checked={exportSpaceScope === "all"}
                    onChange={() => setExportSpaceScope("all")}
                    className="accent-primary size-3.5 cursor-pointer"
                  />
                  <span className="font-medium text-foreground">
                    All spaces
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="export-space-scope"
                    checked={exportSpaceScope === "selected"}
                    onChange={() => setExportSpaceScope("selected")}
                    className="accent-primary size-3.5 cursor-pointer"
                  />
                  <span className="font-medium text-foreground">
                    Select spaces…
                  </span>
                </label>
                {exportSpaceScope === "selected" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="ml-auto h-7 text-xs"
                    onClick={onOpenExportSpacePicker}
                  >
                    <ListChecks className="size-3.5" />
                    {exportSelectedSpaceKeys.length > 0
                      ? `${exportSelectedSpaceKeys.length} selected`
                      : "Choose spaces"}
                  </Button>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-1.5 min-h-9 leading-normal">
                {exportSpaceScope === "all"
                  ? "Every space, page, user, group and permission in this workspace."
                  : "Only the selected spaces' pages and permissions. Users and groups are always included in full."}
              </p>
            </div>

            {/* Password hashes option — only relevant to WikiHub restore */}
            <label className="border-border bg-surface-sunken flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-xs transition-colors duration-150 hover:bg-surface-hover">
              <input
                type="checkbox"
                checked={includeCredentials}
                onChange={(e) => setIncludeCredentials(e.target.checked)}
                className="accent-primary mt-0.5 size-3.5 shrink-0 cursor-pointer rounded"
              />
              <span>
                <span className="font-medium text-foreground">
                  Include password hashes
                </span>
                <span className="text-muted-foreground mt-0.5 block leading-normal">
                  Off by default. Enables offline cracking of weak passwords
                  — only enable for a migration and store the file securely.
                  Without it, restored accounts need a password set before
                  signing in.
                </span>
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsExportOptionsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={
                isDownloading ||
                isPortableJobRunning ||
                (exportSpaceScope === "selected" &&
                  exportSelectedSpaceKeys.length === 0)
              }
              aria-busy={isDownloading}
              onClick={() => void onCreatePortableExport("full_export")}
            >
              {isDownloading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              {isDownloading ? "Queueing export…" : "Create backup ZIP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
