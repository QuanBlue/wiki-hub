"use client";

import {
  Bold,
  CheckSquare,
  Code,
  Heading,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Paperclip,
  Quote,
  Tag,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { LabelChip } from "@/components/issues/label-chip";
import { LabelPicker } from "@/components/issues/label-picker";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import {
  applyMarkdownFormat,
  type MarkdownFormat,
} from "@/lib/issue-markdown-edit";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types/api";

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** An unsent report kept on this device (text only; images cannot be stored). */
const DRAFT_KEY = "wikihub:issue-draft";

function readDraft(): { title: string; description: string } | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<{
      title: string;
      description: string;
    }>;
    return {
      title: typeof value.title === "string" ? value.title : "",
      description:
        typeof value.description === "string" ? value.description : "",
    };
  } catch {
    return null;
  }
}

function writeDraft(draft: { title: string; description: string } | null) {
  try {
    if (draft) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage can be unavailable (private windows); the draft is a convenience.
  }
}

const TOOLBAR: {
  format: MarkdownFormat;
  icon: LucideIcon;
  labelKey: string;
  /** A thin rule before this button, to start a new group. */
  startsGroup?: boolean;
}[] = [
  { format: "heading", icon: Heading, labelKey: "issues.fmtHeading" },
  { format: "bold", icon: Bold, labelKey: "issues.fmtBold" },
  { format: "italic", icon: Italic, labelKey: "issues.fmtItalic" },
  { format: "quote", icon: Quote, labelKey: "issues.fmtQuote" },
  { format: "code", icon: Code, labelKey: "issues.fmtCode" },
  { format: "link", icon: Link2, labelKey: "issues.fmtLink" },
  {
    format: "bullets",
    icon: List,
    labelKey: "issues.fmtBullets",
    startsGroup: true,
  },
  { format: "numbers", icon: ListOrdered, labelKey: "issues.fmtNumbers" },
  { format: "tasks", icon: CheckSquare, labelKey: "issues.fmtTasks" },
];

/**
 * Report a problem to the administrators, laid out like a familiar issue form:
 * a title, a Markdown description with Write / Preview, screenshots (picked,
 * dropped or pasted), and "Create more" to file several in a row.
 */
export function ReportIssueDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, apiErrorText } = useTranslation();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  // Starts from a draft saved earlier on this device, if there is one.
  const [title, setTitle] = useState(() => readDraft()?.title ?? "");
  const [description, setDescription] = useState(
    () => readDraft()?.description ?? "",
  );
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [images, setImages] = useState<File[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [createMore, setCreateMore] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  /** Whether closing would lose something: typed text not already saved as the draft, or images. */
  function hasUnsavedWork(): boolean {
    if (images.length > 0) return true;
    const draft = readDraft();
    return (
      (title.trim() !== "" || description.trim() !== "") &&
      (draft?.title !== title || draft?.description !== description)
    );
  }

  const previews = useMemo(
    () => images.map((file) => URL.createObjectURL(file)),
    [images],
  );
  useEffect(
    () => () => previews.forEach((url) => URL.revokeObjectURL(url)),
    [previews],
  );

  function reset() {
    setTitle("");
    setDescription("");
    setImages([]);
    setLabels([]);
    setTab("write");
  }

  function addImages(files: File[]) {
    if (files.length === 0) return;
    const accepted = files.filter(
      (file) => ACCEPTED.includes(file.type) && file.size <= MAX_IMAGE_BYTES,
    );
    if (accepted.length < files.length) toast.error(t("issues.imageRejected"));
    setImages((current) => [...current, ...accepted].slice(0, MAX_IMAGES));
  }

  function onPaste(event: React.ClipboardEvent) {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    event.preventDefault();
    addImages(files);
  }

  function format(kind: MarkdownFormat) {
    const field = descriptionInput.current;
    if (!field) return;
    const result = applyMarkdownFormat(
      kind,
      field.value,
      field.selectionStart,
      field.selectionEnd,
    );
    setDescription(result.value);
    // The value is applied on the next render; put the selection back after it.
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (pending || !title.trim()) return;
    setPending(true);
    try {
      const issue = await api.post<Issue>("/api/v1/issues", {
        title: title.trim(),
        description: description.trim(),
        page_url: window.location.pathname + window.location.search,
        labels,
      });
      let failedImages = 0;
      for (const file of images) {
        const form = new FormData();
        form.append("file", file, file.name || "screenshot.png");
        try {
          await api.post(`/api/v1/issues/${issue.id}/attachments`, undefined, {
            rawBody: form,
          });
        } catch {
          failedImages += 1;
        }
      }
      writeDraft(null);
      toast.success(t("issues.reported"));
      if (failedImages > 0) toast.error(t("issues.imagesFailed"));
      reset();
      router.refresh();
      if (createMore) {
        titleInput.current?.focus();
      } else {
        onOpenChange(false);
      }
    } catch (error) {
      toast.error(apiErrorText(error, "issues.reportError"));
    } finally {
      setPending(false);
    }
  }

  /** Every way out (X, Cancel, Escape, a click outside) asks first if there is anything to lose. */
  function requestClose() {
    if (pending) return;
    if (hasUnsavedWork()) setConfirmClose(true);
    else onOpenChange(false);
  }

  function discard() {
    writeDraft(null);
    reset();
    setConfirmClose(false);
    onOpenChange(false);
  }

  function saveDraftAndClose() {
    writeDraft({ title, description });
    // The form keeps its text, so reopening picks up where it left off.
    setImages([]);
    setConfirmClose(false);
    onOpenChange(false);
    toast.success(t("issues.draftSaved"));
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else requestClose();
        }}
      >
        <DialogContent title={t("issues.reportTitle")} className="max-w-3xl">
          <form
            onSubmit={(event) => void submit(event)}
            onPaste={onPaste}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="issue-title"
                  className="block text-sm font-medium"
                >
                  {t("issues.titleLabel")}{" "}
                  <span className="text-danger" aria-hidden>
                    *
                  </span>
                </label>
                <Input
                  id="issue-title"
                  ref={titleInput}
                  value={title}
                  maxLength={200}
                  autoFocus
                  required
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t("issues.titlePlaceholder")}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <LabelPicker
                  selected={labels}
                  onChange={setLabels}
                  title={t("issueLabels.pickerTitle")}
                  trigger={
                    <>
                      <Tag className="size-3.5" aria-hidden />
                      {t("issueLabels.labels")}
                    </>
                  }
                  triggerClassName="border-border border"
                />
                {labels.length === 0 ? (
                  <span className="text-muted-foreground text-xs">
                    {t("issueLabels.noneChosen")}
                  </span>
                ) : (
                  labels.map((slug) => <LabelChip key={slug} slug={slug} />)
                )}
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="issue-description"
                  className="block text-sm font-medium"
                >
                  {t("issues.descriptionLabel")}
                </label>
                <div
                  className="border-border bg-surface focus-within:border-border-strong focus-within:ring-ring overflow-hidden rounded-md border focus-within:ring-2"
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes("Files"))
                      event.preventDefault();
                  }}
                  onDrop={(event) => {
                    const files = Array.from(event.dataTransfer.files);
                    if (files.length === 0) return;
                    event.preventDefault();
                    addImages(files);
                  }}
                >
                  <div className="border-border bg-surface-sunken flex flex-wrap items-center justify-between gap-2 border-b pr-1">
                    <div role="tablist" className="flex">
                      {(["write", "preview"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="tab"
                          aria-selected={tab === value}
                          onClick={() => setTab(value)}
                          className={cn(
                            "focus-visible:ring-ring -mb-px cursor-pointer border-b-2 px-4 py-2 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
                            tab === value
                              ? "border-primary text-foreground bg-surface font-medium"
                              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground border-transparent",
                          )}
                        >
                          {t(
                            value === "write"
                              ? "issues.write"
                              : "issues.preview",
                          )}
                        </button>
                      ))}
                    </div>
                    {tab === "write" ? (
                      <div
                        role="toolbar"
                        aria-label={t("issues.formatting")}
                        className="flex items-center gap-0.5"
                      >
                        {TOOLBAR.map(
                          ({
                            format: kind,
                            icon: Icon,
                            labelKey,
                            startsGroup,
                          }) => (
                            <span key={kind} className="flex items-center">
                              {startsGroup ? (
                                <span
                                  aria-hidden
                                  className="bg-border mx-1 h-5 w-px"
                                />
                              ) : null}
                              <button
                                type="button"
                                title={t(labelKey)}
                                aria-label={t(labelKey)}
                                onClick={() => format(kind)}
                                className="text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected focus-visible:ring-ring flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                              >
                                <Icon className="size-4" aria-hidden />
                              </button>
                            </span>
                          ),
                        )}
                      </div>
                    ) : null}
                  </div>

                  {tab === "write" ? (
                    <textarea
                      id="issue-description"
                      ref={descriptionInput}
                      value={description}
                      maxLength={10000}
                      onChange={(event) => setDescription(event.target.value)}
                      onKeyDown={(event) => {
                        if (!(event.ctrlKey || event.metaKey) || event.shiftKey)
                          return;
                        const key = event.key.toLowerCase();
                        if (key === "b" || key === "i") {
                          event.preventDefault();
                          format(key === "b" ? "bold" : "italic");
                        }
                      }}
                      placeholder={t("issues.descriptionPlaceholder")}
                      className="placeholder:text-muted-foreground block h-72 w-full resize-y bg-transparent p-3 font-mono text-sm outline-none"
                    />
                  ) : (
                    <div className="h-72 overflow-y-auto p-3">
                      {description.trim() ? (
                        <IssueMarkdown source={description} />
                      ) : (
                        <p className="text-muted-foreground text-sm">
                          {t("issues.nothingToPreview")}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {previews.length > 0 ? (
                  <ul className="flex flex-wrap gap-2 pt-1">
                    {previews.map((url, index) => (
                      <li key={url} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={images[index]?.name ?? ""}
                          className="border-border h-20 w-28 rounded-md border object-cover"
                        />
                        <button
                          type="button"
                          aria-label={t("issues.removeImage")}
                          onClick={() =>
                            setImages((current) =>
                              current.filter((_, i) => i !== index),
                            )
                          }
                          className="bg-surface border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring absolute -top-1.5 -right-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full border transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <button
                  type="button"
                  disabled={images.length >= MAX_IMAGES}
                  onClick={() => fileInput.current?.click()}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-1 flex cursor-pointer items-center gap-1.5 rounded px-1 py-1 text-xs transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
                >
                  <Paperclip className="size-3.5" aria-hidden />
                  {t("issues.attachHint", { max: MAX_IMAGES })}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPTED.join(",")}
                  multiple
                  className="sr-only"
                  tabIndex={-1}
                  aria-label={t("issues.addImage")}
                  onChange={(event) => {
                    addImages(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
              </div>
            </div>

            <DialogFooter className="items-center">
              <label className="text-muted-foreground hover:text-foreground mr-2 flex cursor-pointer items-center gap-2 text-sm transition-colors duration-150">
                <input
                  type="checkbox"
                  checked={createMore}
                  disabled={pending}
                  onChange={(event) => setCreateMore(event.target.checked)}
                  className="accent-primary size-4 cursor-pointer"
                />
                {t("issues.createMore")}
              </label>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={requestClose}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={pending || !title.trim()}
                title={t("issues.submitShortcut")}
              >
                {pending ? <Loader2 className="animate-spin" /> : null}
                {t("issues.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t("issues.discardTitle")}
        description={t("issues.discardDescription")}
        confirmLabel={t("issues.saveDraft")}
        cancelLabel={t("issues.keepEditing")}
        secondaryLabel={t("issues.discard")}
        onSecondary={discard}
        onConfirm={saveDraftAndClose}
      />
    </>
  );
}
