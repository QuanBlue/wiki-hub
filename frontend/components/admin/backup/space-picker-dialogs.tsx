"use client";

import {
  ArrowUpFromLine,
  FileArchive,
  Loader2,
  Search,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/components/ui/job-progress";
import { cn } from "@/lib/utils";
import type {
  BackupArchive,
  BackupArchiveUploadProgress,
  ConfluenceArchive,
  Space,
} from "@/types/api";

export function ExportSpacePickerDialog({
  open,
  onOpenChange,
  availableSpaces,
  isLoadingAvailableSpaces,
  exportSpaceFilter,
  setExportSpaceFilter,
  exportSelectedSpaceKeys,
  setExportSelectedSpaceKeys,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableSpaces: Space[] | null;
  isLoadingAvailableSpaces: boolean;
  exportSpaceFilter: string;
  setExportSpaceFilter: (value: string) => void;
  exportSelectedSpaceKeys: string[];
  setExportSelectedSpaceKeys: (keys: string[]) => void;
}) {
  const normalizedExportSpaceFilter = exportSpaceFilter.trim().toLocaleLowerCase();
  const filteredAvailableSpaces = (availableSpaces ?? []).filter(
    (space) =>
      !normalizedExportSpaceFilter ||
      space.name.toLocaleLowerCase().includes(normalizedExportSpaceFilter) ||
      space.key.toLocaleLowerCase().includes(normalizedExportSpaceFilter),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Select Spaces to Export" className="max-w-2xl">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {exportSelectedSpaceKeys.length}/{(availableSpaces ?? []).length}{" "}
              Space(s) selected
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                type="search"
                value={exportSpaceFilter}
                onChange={(event) => setExportSpaceFilter(event.target.value)}
                placeholder="Filter by space name or key"
                aria-label="Filter spaces to export"
                className="pl-9"
              />
            </div>
            <span className="text-muted-foreground text-xs" aria-live="polite">
              {filteredAvailableSpaces.length} of {(availableSpaces ?? []).length}{" "}
              shown
            </span>
          </div>
          <div className="border-border max-h-64 overflow-y-auto rounded-md border">
            {isLoadingAvailableSpaces ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 px-3 py-8 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Loading spaces…
              </div>
            ) : filteredAvailableSpaces.length ? (
              filteredAvailableSpaces.map((space) => (
                <label
                  key={space.key}
                  className="border-border hover:bg-surface-sunken flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0"
                >
                  <input
                    type="checkbox"
                    checked={exportSelectedSpaceKeys.includes(space.key)}
                    onChange={(event) => {
                      setExportSelectedSpaceKeys(
                        event.target.checked
                          ? [...exportSelectedSpaceKeys, space.key]
                          : exportSelectedSpaceKeys.filter(
                              (key) => key !== space.key,
                            ),
                      );
                    }}
                    className="accent-primary size-4"
                  />
                  <span className="font-medium">{space.name}</span>
                  <span className="text-muted-foreground">
                    {space.key} · {space.status}
                  </span>
                </label>
              ))
            ) : (
              <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                No spaces match “{exportSpaceFilter}”.
              </p>
            )}
          </div>
          <DialogFooter className="justify-between sm:justify-between">
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setExportSelectedSpaceKeys(
                    Array.from(
                      new Set([
                        ...exportSelectedSpaceKeys,
                        ...filteredAvailableSpaces.map((space) => space.key),
                      ]),
                    ),
                  );
                }}
              >
                {normalizedExportSpaceFilter ? "Select visible" : "Select all"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExportSelectedSpaceKeys([])}
              >
                Clear selection
              </Button>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Done
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ImportSpacePickerDialog({
  open,
  onOpenChange,
  backupArchive,
  importSpaceFilter,
  setImportSpaceFilter,
  importSelectedSpaceKeys,
  setImportSelectedSpaceKeys,
  restoreInputsLocked,
  pending,
  onRequestImportRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backupArchive: BackupArchive | null;
  importSpaceFilter: string;
  setImportSpaceFilter: (value: string) => void;
  importSelectedSpaceKeys: string[];
  setImportSelectedSpaceKeys: (keys: string[]) => void;
  restoreInputsLocked: boolean;
  pending: "apply" | null;
  onRequestImportRestore: () => void;
}) {
  const normalizedImportSpaceFilter = importSpaceFilter.trim().toLocaleLowerCase();
  const filteredArchiveSpaces = (backupArchive?.spaces ?? []).filter(
    (space) =>
      !normalizedImportSpaceFilter ||
      space.name.toLocaleLowerCase().includes(normalizedImportSpaceFilter) ||
      space.key.toLocaleLowerCase().includes(normalizedImportSpaceFilter),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Select Spaces to Restore" className="max-w-2xl">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {importSelectedSpaceKeys.length}/
              {(backupArchive?.spaces ?? []).length} Space(s) selected
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                type="search"
                value={importSpaceFilter}
                onChange={(event) => setImportSpaceFilter(event.target.value)}
                placeholder="Filter by space name or key"
                aria-label="Filter spaces to restore"
                className="pl-9"
              />
            </div>
            <span className="text-muted-foreground text-xs" aria-live="polite">
              {filteredArchiveSpaces.length} of{" "}
              {(backupArchive?.spaces ?? []).length} shown
            </span>
          </div>
          <div className="border-border max-h-64 overflow-y-auto rounded-md border">
            {filteredArchiveSpaces.length ? (
              filteredArchiveSpaces.map((space) => (
                <label
                  key={space.key}
                  className="border-border hover:bg-surface-sunken flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0"
                >
                  <input
                    type="checkbox"
                    checked={importSelectedSpaceKeys.includes(space.key)}
                    onChange={(event) => {
                      setImportSelectedSpaceKeys(
                        event.target.checked
                          ? [...importSelectedSpaceKeys, space.key]
                          : importSelectedSpaceKeys.filter(
                              (key) => key !== space.key,
                            ),
                      );
                    }}
                    className="accent-primary size-4"
                  />
                  <span className="font-medium">{space.name}</span>
                  <span className="text-muted-foreground">
                    {space.key} · {space.page_count} pages
                  </span>
                  {space.conflict ? (
                    <Badge variant="warning">Existed</Badge>
                  ) : null}
                </label>
              ))
            ) : (
              <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                {backupArchive?.spaces.length
                  ? `No spaces match "${importSpaceFilter}".`
                  : "This archive has no spaces."}
              </p>
            )}
          </div>
          <DialogFooter className="justify-between sm:justify-between">
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setImportSelectedSpaceKeys(
                    Array.from(
                      new Set([
                        ...importSelectedSpaceKeys,
                        ...filteredArchiveSpaces.map((space) => space.key),
                      ]),
                    ),
                  );
                }}
              >
                {normalizedImportSpaceFilter ? "Select visible" : "Select all"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImportSelectedSpaceKeys([])}
              >
                Clear selection
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={
                  restoreInputsLocked ||
                  pending !== null ||
                  importSelectedSpaceKeys.length === 0
                }
                aria-busy={pending === "apply"}
                onClick={onRequestImportRestore}
              >
                {pending === "apply" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload />
                )}
                Start restore
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConfluenceSpacePickerDialog({
  open,
  onOpenChange,
  confluenceArchive,
  spaceFilter,
  setSpaceFilter,
  selectedSpaces,
  setSelectedSpaces,
  importAllSpaces,
  setImportAllSpaces,
  importInProgress,
  confluencePending,
  onRequestConfluenceImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confluenceArchive: ConfluenceArchive | null;
  spaceFilter: string;
  setSpaceFilter: (value: string) => void;
  selectedSpaces: string[];
  setSelectedSpaces: (keys: string[]) => void;
  importAllSpaces: boolean;
  setImportAllSpaces: (all: boolean) => void;
  importInProgress: boolean;
  confluencePending: boolean;
  onRequestConfluenceImport: () => void;
}) {
  const normalizedSpaceFilter = spaceFilter.trim().toLocaleLowerCase();
  const filteredConfluenceSpaces =
    confluenceArchive?.spaces.filter(
      (space) =>
        !normalizedSpaceFilter ||
        space.name.toLocaleLowerCase().includes(normalizedSpaceFilter) ||
        space.key.toLocaleLowerCase().includes(normalizedSpaceFilter),
    ) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Select Spaces to Import" className="max-w-2xl">
        {confluenceArchive ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {selectedSpaces.length}/{confluenceArchive.spaces.length}{" "}
                Space(s) selected
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-52 flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  type="search"
                  value={spaceFilter}
                  disabled={importInProgress}
                  onChange={(event) => setSpaceFilter(event.target.value)}
                  placeholder="Filter by space name or key"
                  aria-label="Filter spaces to import"
                  className="pl-9"
                />
              </div>
              <span
                className="text-muted-foreground text-xs"
                aria-live="polite"
              >
                {filteredConfluenceSpaces.length} of{" "}
                {confluenceArchive.spaces.length} shown
              </span>
            </div>
            <div className="border-border max-h-64 overflow-y-auto rounded-md border">
              {filteredConfluenceSpaces.length ? (
                filteredConfluenceSpaces.map((space) => (
                  <label
                    key={space.key}
                    className={cn(
                      "border-border flex items-center gap-3 border-b px-3 py-2 text-sm last:border-0",
                      importInProgress
                        ? "cursor-not-allowed opacity-60"
                        : "hover:bg-surface-sunken cursor-pointer",
                    )}
                  >
                    <input
                      type="checkbox"
                      disabled={importInProgress}
                      checked={selectedSpaces.includes(space.key)}
                      onChange={(event) => {
                        const nextSelected = event.target.checked
                          ? [...selectedSpaces, space.key]
                          : selectedSpaces.filter((key) => key !== space.key);
                        const availableCount = confluenceArchive.spaces.length;
                        setSelectedSpaces(nextSelected);
                        setImportAllSpaces(
                          nextSelected.length === availableCount,
                        );
                      }}
                      className="accent-primary size-4"
                    />
                    <span className="font-medium">{space.name}</span>
                    <span className="text-muted-foreground">
                      {space.key} · {space.page_count} pages
                    </span>
                    {space.conflict ? (
                      <Badge variant="warning">Existed</Badge>
                    ) : null}
                  </label>
                ))
              ) : (
                <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                  No spaces match “{spaceFilter}”.
                </p>
              )}
            </div>
            <DialogFooter className="justify-between sm:justify-between">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={importInProgress}
                  onClick={() => {
                    const nextSelected = Array.from(
                      new Set([
                        ...selectedSpaces,
                        ...filteredConfluenceSpaces.map((space) => space.key),
                      ]),
                    );
                    const availableCount = confluenceArchive.spaces.length;
                    setSelectedSpaces(nextSelected);
                    setImportAllSpaces(
                      nextSelected.length === availableCount,
                    );
                  }}
                >
                  {normalizedSpaceFilter ? "Select visible" : "Select all"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={importInProgress}
                  onClick={() => {
                    setSelectedSpaces([]);
                    setImportAllSpaces(false);
                  }}
                >
                  Clear selection
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={importInProgress}
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={
                    importInProgress ||
                    confluencePending ||
                    (!importAllSpaces && selectedSpaces.length === 0)
                  }
                  onClick={onRequestConfluenceImport}
                >
                  {confluencePending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}{" "}
                  Start import
                </Button>
              </div>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function MismatchedResumeFileDialog({
  mismatchedResumeFile,
  onDismiss,
  pendingRestoreUpload,
  pendingRestoreUploadedBytes,
  onUploadMismatchedFileInstead,
  onReselectFileForResume,
}: {
  mismatchedResumeFile: File | null;
  onDismiss: () => void;
  pendingRestoreUpload: BackupArchiveUploadProgress | null;
  pendingRestoreUploadedBytes: number;
  onUploadMismatchedFileInstead: () => Promise<void>;
  onReselectFileForResume: () => void;
}) {
  return (
    <Dialog
      open={mismatchedResumeFile !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent
        title="That is a different file"
        description="The parts already uploaded only fit the file they came from, so resuming needs that one back."
      >
        <div className="border-border bg-surface-sunken divide-border divide-y rounded-md border">
          <div className="flex gap-2.5 p-3">
            <ArrowUpFromLine className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Being uploaded
              </p>
              <p className="text-foreground mt-0.5 text-xs break-all">
                {pendingRestoreUpload?.filename}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {formatBytes(pendingRestoreUploadedBytes)} of{" "}
                {formatBytes(pendingRestoreUpload?.size_bytes ?? 0)} already
                in storage
              </p>
            </div>
          </div>
          <div className="flex gap-2.5 p-3">
            <FileArchive className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                You chose
              </p>
              <p className="text-foreground mt-0.5 text-xs break-all">
                {mismatchedResumeFile?.name}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {formatBytes(mismatchedResumeFile?.size ?? 0)} · nothing
                uploaded yet
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="danger"
            onClick={() => void onUploadMismatchedFileInstead()}
          >
            Discard and upload this
          </Button>
          <Button variant="primary" onClick={onReselectFileForResume}>
            Choose the original
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
