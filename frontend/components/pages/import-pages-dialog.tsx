"use client";

import { FileUp, Loader2, Upload, X } from "lucide-react";
import type { ChangeEvent, DragEvent, FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatBytes } from "@/components/ui/job-progress";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import type { DocumentImportJob, InstanceInfo, WikiPage } from "@/types/api";
import { DocumentImportProgress } from "@/components/pages/document-import-progress";

/** Mirrors `DOCUMENT_IMPORT_EXTENSIONS` on the backend. Rejecting here as well
 *  is a courtesy, not a control: the server decides. */
const ACCEPTED_EXTENSIONS = [
  "docx",
  "odt",
  "rtf",
  "epub",
  "html",
  "htm",
  "md",
  "markdown",
  "pdf",
] as const;

const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",");

/** Mirrors `MAX_DOCUMENT_IMPORT_FILES`. */
const MAX_FILES = 20;

type Candidate = {
  /** Stable across re-renders so removing one does not re-key the list. */
  key: string;
  file: File;
};

type ConflictMode = "ask" | "rename" | "replace";

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1).toLowerCase();
}

function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim();
}

function titleVariantsFromFilename(name: string): string[] {
  const title = titleFromFilename(name);
  const withoutCopySuffix = title.replace(/\s*\(\d+\)$/, "").trim();
  return withoutCopySuffix && withoutCopySuffix !== title
    ? [title, withoutCopySuffix]
    : [title];
}

function inspect(file: File, maxUploadBytes: number): string | null {
  const extension = extensionOf(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number])) {
    return `WikiHub cannot import .${extension || "files without an extension"}`;
  }
  if (file.size === 0) return "This file is empty";
  if (maxUploadBytes > 0 && file.size > maxUploadBytes) {
    return `Larger than the ${formatBytes(maxUploadBytes)} upload limit`;
  }
  return null;
}

export function ImportPagesDialog({
  spaceKey,
  parentPage,
  existingPages = [],
  onStarted,
  onDismiss,
  onFinished,
  open: controlledOpen,
  onOpenChange: onControlledOpenChange,
  trigger,
  triggerLabel = "Import",
  triggerVariant = "ghost",
  triggerSize = "sm",
}: {
  spaceKey: string;
  parentPage?: Pick<WikiPage, "id" | "title"> | null;
  existingPages?: Pick<WikiPage, "title" | "parent_id">[];
  onStarted: (job: DocumentImportJob) => void;
  onDismiss?: () => void;
  onFinished?: (job: DocumentImportJob) => void;
  /** Controlled mode, so a dropdown item can open the one shared dialog
   *  instead of nesting a second Radix trigger inside a menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Replaces the default button. Omit entirely in controlled mode. */
  trigger?: ReactNode | null;
  triggerLabel?: string;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onControlledOpenChange ?? setUncontrolledOpen;
  // Learned from the instance rather than assumed: an operator can change the
  // ceiling, and guessing it would reject files the server would have taken.
  const [maxUploadBytes, setMaxUploadBytes] = useState(0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [importJob, setImportJob] = useState<DocumentImportJob | null>(null);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [serverConflictNames, setServerConflictNames] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const [dragging, setDragging] = useState(false);

  // Derived, never stored: the upload ceiling arrives asynchronously, and a
  // `problem` kept in state would have to be re-synced when it does.
  const inspected = candidates.map((candidate) => ({
    ...candidate,
    problem: inspect(candidate.file, maxUploadBytes),
  }));
  const sendable = inspected.filter((c) => c.problem === null);
  const conflicts = sendable.filter((candidate) =>
    existingPages.some(
      (page) =>
        page.parent_id === (parentPage?.id ?? null) &&
        titleVariantsFromFilename(candidate.file.name).some(
          (title) =>
            page.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase(),
        ),
    ),
  );
  const firstConflictName = serverConflictNames[0] ?? conflicts[0]?.file.name;

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      setCandidates((current) => {
        const seen = new Set(
          current.map((c) => `${c.file.name}:${c.file.size}:${c.file.lastModified}`),
        );
        const next = [...current];
        for (const file of Array.from(incoming)) {
          const identity = `${file.name}:${file.size}:${file.lastModified}`;
          if (seen.has(identity)) continue;
          seen.add(identity);
          next.push({ key: `${identity}:${next.length}`, file });
        }
        if (next.length > MAX_FILES) {
          toast.error(`Import at most ${MAX_FILES} documents at a time.`);
          return next.slice(0, MAX_FILES);
        }
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!open || maxUploadBytes > 0) return;
    let cancelled = false;
    api
      .get<InstanceInfo>("/api/v1/meta")
      .then((meta) => {
        if (!cancelled) setMaxUploadBytes(meta.max_upload_size_bytes);
      })
      .catch(() => {
        // Not knowing the ceiling only costs the client-side courtesy check;
        // the server still enforces it.
      });
    return () => {
      cancelled = true;
    };
  }, [open, maxUploadBytes]);

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    // Reset so picking the same file twice in a row still fires a change event.
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
  }

  function reset() {
    setCandidates([]);
    setUploadPercent(0);
    setUploading(false);
    setImportJob(null);
    setServerConflictNames([]);
    requestRef.current = null;
  }

  function onOpenChange(next: boolean) {
    // Closing mid-upload aborts it: nothing has been queued server-side yet,
    // so there is no half-started job to explain.
    if (!next && uploading) requestRef.current?.abort();
    if (!next) reset();
    setOpen(next);
  }

  // Only while the bytes are still in flight. Once the job is queued the work
  // is durable server-side and leaving the page costs nothing.
  useEffect(() => {
    if (!uploading) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendable.length === 0 || uploading) return;
    if (conflicts.length > 0) {
      // A filename already visible in this page list matches - ask upfront
      // rather than spend a round trip finding out what the server would
      // have said anyway.
      setConflictDialogOpen(true);
      return;
    }
    // Word and PDF titles are discovered only while their contents are
    // converted on the server, so this filename-only preflight cannot
    // reliably find every duplicate. Send the batch with the server free to
    // decide ("ask"); the catch below reacts to a real conflict instead of
    // this dialog assuming one exists for every import.
    void startImport("ask");
  }

  async function startImport(conflictMode: ConflictMode) {

    const form = new FormData();
    for (const candidate of sendable) form.append("files", candidate.file);
    if (parentPage?.id) form.append("parent_id", parentPage.id);
    form.append("conflict_mode", conflictMode);

    setUploading(true);
    setUploadPercent(0);

    try {
      // XMLHttpRequest rather than fetch: upload progress events are the only
      // way to show a bar for a batch that can be several hundred megabytes.
      const job = await new Promise<DocumentImportJob>((resolve, reject) => {
        const request = new XMLHttpRequest();
        requestRef.current = request;
        request.open(
          "POST",
          `/api/v1/spaces/${encodeURIComponent(spaceKey)}/document-imports`,
        );
        request.withCredentials = true;
        request.setRequestHeader("Accept", "application/json");
        request.upload.onprogress = (progress) => {
          if (progress.lengthComputable && progress.total > 0) {
            setUploadPercent(Math.round((progress.loaded / progress.total) * 100));
          }
        };
        request.onload = () => {
          if (request.status >= 200 && request.status < 300) {
            try {
              resolve(JSON.parse(request.responseText) as DocumentImportJob);
            } catch {
              reject(new Error("The server sent a response WikiHub could not read."));
            }
            return;
          }
          let message = "The import could not be started.";
          let errorCode: string | undefined;
          let conflictNames: string[] = [];
          try {
            const parsed = JSON.parse(request.responseText);
            errorCode = parsed?.error?.code ?? parsed?.detail?.code;
            conflictNames = Array.isArray(parsed?.error?.details?.conflicts)
              ? parsed.error.details.conflicts
                  .map((conflict: { filename?: unknown }) => conflict.filename)
                  .filter((filename: unknown): filename is string => typeof filename === "string")
              : [];
            message =
              parsed?.error?.message ??
              parsed?.detail?.message ??
              parsed?.detail ??
              parsed?.message ??
              message;
          } catch {
            /* keep the fallback */
          }
          const error = new Error(
            typeof message === "string" ? message : "The import could not be started.",
          ) as Error & { code?: string; conflictNames?: string[] };
          error.code = errorCode;
          error.conflictNames = conflictNames;
          reject(error);
        };
        request.onerror = () =>
          reject(new Error("The upload failed. Check your connection and try again."));
        request.onabort = () => reject(new DOMException("Aborted", "AbortError"));
        request.send(form);
      });

      setCandidates([]);
      setUploadPercent(0);
      setUploading(false);
      setImportJob(job);
      requestRef.current = null;
      onStarted(job);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setUploading(false);
        return;
      }
      if (error instanceof Error && (error as Error & { code?: string }).code === "document_import_conflict") {
        setServerConflictNames(
          (error as Error & { conflictNames?: string[] }).conflictNames ?? [],
        );
        setConflictDialogOpen(true);
      } else {
        toast.error(error instanceof Error ? error.message : "The import could not be started.");
      }
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant={triggerVariant} size={triggerSize}>
              <FileUp />
              {triggerLabel}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent
        className="max-w-2xl"
        title="Import pages from files"
        description={
          parentPage
            ? `Each file becomes a new page under "${parentPage.title}".`
            : "Each file becomes a new top-level page in this space."
        }
      >
        {importJob ? (
          <DocumentImportProgress
            job={importJob}
            spaceKey={spaceKey}
            onJobChange={setImportJob}
            onDismiss={() => {
              setImportJob(null);
              setOpen(false);
              onDismiss?.();
            }}
            onFinished={(job) => onFinished?.(job)}
          />
        ) : <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="import-files">Documents</Label>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "border-border hover:border-primary/50 hover:bg-surface-hover flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-6 text-center transition-colors duration-150",
                dragging && "border-primary bg-surface-hover",
              )}
            >
              <Upload className="text-muted-foreground size-5" />
              <p className="text-muted-foreground text-sm">
                Drop Word, PDF, HTML or Markdown files here
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                Choose files
              </Button>
              <input
                ref={inputRef}
                id="import-files"
                type="file"
                multiple
                accept={ACCEPT_ATTRIBUTE}
                onChange={onPick}
                className="sr-only"
              />
            </div>
          </div>

          {inspected.length > 0 ? (
            <ul className="border-border divide-border max-h-52 divide-y overflow-y-auto rounded-md border text-sm">
              {inspected.map((candidate) => (
                <li
                  key={candidate.key}
                  className="flex items-start justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{candidate.file.name}</p>
                    {candidate.problem ? (
                      // Inline, next to the file it is about, rather than a
                      // toast that leaves you guessing which one it meant.
                      <p className="text-danger text-xs">{candidate.problem}</p>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        {formatBytes(candidate.file.size)}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${candidate.file.name}`}
                    onClick={() =>
                      setCandidates((current) =>
                        current.filter((c) => c.key !== candidate.key),
                      )
                    }
                    disabled={uploading}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          {uploading ? (
            <div
              aria-label={`Upload ${uploadPercent}% complete`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={uploadPercent}
              className="bg-surface h-2 overflow-hidden rounded-full"
              role="progressbar"
            >
              <div
                className="bg-info h-full duration-150 motion-safe:transition-[width]"
                style={{ width: `${uploadPercent}%` }}
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="submit"
              variant="primary"
              disabled={uploading || sendable.length === 0}
            >
              {uploading ? <Loader2 className="animate-spin" /> : <FileUp />}
              {uploading
                ? `Uploading… ${uploadPercent}%`
                : sendable.length > 1
                  ? `Import ${sendable.length} files`
                  : "Import"}
            </Button>
          </DialogFooter>
        </form>}
      </DialogContent>
      <Dialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
        <DialogContent
          title="Page already exists"
          description={
            serverConflictNames.length === 1 || conflicts.length === 1
              ? `A page matching “${firstConflictName ? titleFromFilename(firstConflictName) : "this file"}” already exists.`
              : serverConflictNames.length > 1 || conflicts.length > 1
                ? `${serverConflictNames.length || conflicts.length} pages with the same names already exist.`
                : "Choose how to handle pages whose imported titles already exist."
          }
        >
          <p className="text-muted-foreground text-sm leading-5">
            If a matching page is found, replace its content or keep both pages by adding a
            numbered suffix such as <span className="text-foreground font-medium">(1)</span> or <span className="text-foreground font-medium">(2)</span>.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setConflictDialogOpen(false);
                void startImport("rename");
              }}
            >
              Keep both
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setConflictDialogOpen(false);
                void startImport("replace");
              }}
            >
              Replace existing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
