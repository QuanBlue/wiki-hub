"use client";

import {
  AlertTriangle,
  Clock3,
  Columns2,
  Copy,
  Eye,
  Pencil,
  RectangleHorizontal,
} from "lucide-react";
import type { CSSProperties, FormEvent } from "react";
import { toast } from "sonner";
import { PagePresence } from "@/components/pages/page-presence";
import {
  RichTextContent,
  RichTextEditor,
} from "@/components/pages/rich-text-editor";
import { SourceCodeEditor } from "@/components/pages/source-code-editor";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";
import { formatTime } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import type {
  PageAttachmentUpload,
  PresenceUser,
  PageSavedEvent,
  Space,
  WikiPage,
} from "@/types/api";
import { pageHref } from "./content-transforms";
import { MAX_PREVIEW_SPLIT, MIN_PREVIEW_SPLIT, type EditMode } from "./types";
import { MarkdownContent } from "./workspace-primitives";

export type PageEditorPaneProps = {
  space: Space;
  currentPage: WikiPage;
  editMode: EditMode;
  titleDraft: string;
  draftContent: string;
  markdownDraft: string;
  previewing: boolean;
  previewSplit: number;
  setPreviewSplit: React.Dispatch<React.SetStateAction<number>>;
  previewLayout: "split" | "full";
  setPreviewLayout: (layout: "split" | "full") => void;
  conflictNotice: PageSavedEvent | null;
  activeUsers: PresenceUser[];
  otherEditors: PresenceUser[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onUpdateTitleDraft: (title: string) => void;
  onUpdateDraftContent: (content: string) => void;
  onUpdateMarkdownDraft: (content: string) => void;
  onUploadFile: (file: File) => Promise<PageAttachmentUpload>;
  onSubpageCreated: (page: WikiPage) => void;
  onOpenHistoryModal: () => void;
  onOpenOverwriteConfirm: () => void;
};

export function PageEditorPane({
  space,
  currentPage,
  editMode,
  titleDraft,
  draftContent,
  markdownDraft,
  previewing,
  previewSplit,
  setPreviewSplit,
  previewLayout,
  setPreviewLayout,
  conflictNotice,
  activeUsers,
  otherEditors,
  onSubmit,
  onUpdateTitleDraft,
  onUpdateDraftContent,
  onUpdateMarkdownDraft,
  onUploadFile,
  onSubpageCreated,
  onOpenHistoryModal,
  onOpenOverwriteConfirm,
}: PageEditorPaneProps) {
  const { t, locale } = useTranslation();
  const splitPreview = previewing && previewLayout === "split";
  const fullPreview = previewing && previewLayout === "full";

  return (
    <form
      id="page-editor-form"
      onSubmit={onSubmit}
      className="space-y-5"
      noValidate
    >
      {conflictNotice ? (
        <div className="bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200 flex flex-col gap-2 rounded-lg border p-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <AlertTriangle className="text-amber-600 dark:text-amber-400 mt-0.5 size-5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider">
                {t("workspace.concurrentEditWarningTitle")}
              </p>
              <p className="mt-0.5 text-xs">
                {conflictNotice.actor_name
                  ? t("workspace.concurrentEditWarningBody", {
                      actor: conflictNotice.actor_name,
                      time: conflictNotice.saved_at
                        ? formatTime(conflictNotice.saved_at, locale)
                        : "",
                    })
                  : t("workspace.concurrentEditWarningTitle")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 self-end sm:self-auto">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 gap-1 text-xs"
              onClick={onOpenHistoryModal}
            >
              <Clock3 className="size-3.5" />
              {t("workspace.viewLatestRevision")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 gap-1 text-xs"
              onClick={() => {
                const content = editMode === "markdown" ? markdownDraft : draftContent;
                void navigator.clipboard.writeText(content).then(() => {
                  toast.success(t("workspace.draftCopied"));
                });
              }}
            >
              <Copy className="size-3.5" />
              {t("workspace.copyMyDraft")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              className="h-7 text-xs"
              onClick={onOpenOverwriteConfirm}
            >
              {t("workspace.overwriteAndSave")}
            </Button>
          </div>
        </div>
      ) : otherEditors.length > 0 ? (
        <div className="bg-blue-500/10 border-blue-500/20 text-blue-900 dark:text-blue-200 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
          <Pencil className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
          <span>
            {t("workspace.concurrentEditingNotice", {
              name: otherEditors.map((u) => u.full_name).join(", "),
            })}
          </span>
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-3 min-w-0">
          <input
            type="text"
            id="page-editor-title"
            aria-label={t("workspace.pageTitleAria")}
            value={titleDraft}
            onChange={(event) => onUpdateTitleDraft(event.target.value)}
            maxLength={255}
            required
            className="text-foreground wikihub-page-header flex-1 min-w-[200px] rounded-md border border-transparent bg-transparent text-3xl font-semibold tracking-normal outline-none transition-colors duration-150 hover:border-border-strong focus-visible:border-border-strong focus-visible:ring-ring focus-visible:ring-2"
          />
        </div>
        <PagePresence users={activeUsers} className="shrink-0 pt-1" />
      </div>
      <div
        className={cn(
          "min-w-0",
          splitPreview &&
            "xl:grid xl:[grid-template-columns:var(--live-preview-columns)]",
        )}
        style={
          splitPreview
            ? ({
                "--live-preview-columns": `minmax(0, ${previewSplit}fr) 12px minmax(0, ${100 - previewSplit}fr)`,
              } as CSSProperties)
            : undefined
        }
      >
        <div className={cn("min-w-0", fullPreview && "hidden")}>
          {editMode === "normal" ? (
            <RichTextEditor
              content={draftContent}
              onChange={onUpdateDraftContent}
              onUploadFile={onUploadFile}
              pageLinkContext={{
                spaceKey: space.key,
                currentPageId: currentPage.id,
              }}
              onSubpageCreated={(page) => {
                // Keep pageHref referenced consistently when navigating to subpages
                void pageHref(space.key, page.slug);
                onSubpageCreated(page);
              }}
            />
          ) : (
            <SourceCodeEditor
              language={editMode}
              value={
                editMode === "markdown" ? markdownDraft : draftContent
              }
              onChange={(value) => {
                if (editMode === "markdown") {
                  onUpdateMarkdownDraft(value);
                } else {
                  onUpdateDraftContent(value);
                }
              }}
            />
          )}
        </div>

        {previewing ? (
          <>
            {splitPreview ? (
              <button
                type="button"
                role="separator"
                aria-label={t("workspace.resizePreviewAria")}
                aria-orientation="vertical"
                aria-valuemin={MIN_PREVIEW_SPLIT}
                aria-valuemax={MAX_PREVIEW_SPLIT}
                aria-valuenow={previewSplit}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(
                    event.pointerId,
                  );
                  document.body.style.cursor = "col-resize";
                  document.body.style.userSelect = "none";
                }}
                onPointerMove={(event) => {
                  if (
                    !event.currentTarget.hasPointerCapture(
                      event.pointerId,
                    )
                  )
                    return;
                  const container = event.currentTarget.parentElement;
                  if (!container) return;
                  const bounds = container.getBoundingClientRect();
                  const next = Math.round(
                    ((event.clientX - bounds.left) / bounds.width) *
                      100,
                  );
                  setPreviewSplit(
                    Math.min(
                      MAX_PREVIEW_SPLIT,
                      Math.max(MIN_PREVIEW_SPLIT, next),
                    ),
                  );
                }}
                onPointerUp={(event) => {
                  event.currentTarget.releasePointerCapture(
                    event.pointerId,
                  );
                  document.body.style.cursor = "";
                  document.body.style.userSelect = "";
                }}
                onPointerCancel={() => {
                  document.body.style.cursor = "";
                  document.body.style.userSelect = "";
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    setPreviewSplit((current) =>
                      Math.max(MIN_PREVIEW_SPLIT, current - 2),
                    );
                  }
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    setPreviewSplit((current) =>
                      Math.min(MAX_PREVIEW_SPLIT, current + 2),
                    );
                  }
                  if (event.key === "Home") {
                    event.preventDefault();
                    setPreviewSplit(MIN_PREVIEW_SPLIT);
                  }
                  if (event.key === "End") {
                    event.preventDefault();
                    setPreviewSplit(MAX_PREVIEW_SPLIT);
                  }
                }}
                className="group focus-visible:ring-ring relative hidden cursor-col-resize touch-none items-stretch justify-center outline-none select-none focus-visible:ring-2 focus-visible:ring-offset-2 xl:flex"
              >
                <span className="bg-border group-hover:bg-border-strong group-active:bg-primary h-full w-px transition-colors duration-150" />
                <span
                  aria-hidden
                  className="border-border-strong bg-surface-raised text-muted-foreground group-hover:border-primary group-hover:text-primary group-active:bg-primary group-active:text-primary-foreground absolute top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded border text-xs font-semibold shadow-sm transition-[color,background-color,border-color] duration-150"
                >
                  ⋮
                </span>
              </button>
            ) : null}

            <div
              className={cn(
                "min-w-0 xl:flex",
                splitPreview ? "mt-6 xl:mt-0" : "mt-0",
              )}
            >
              <section
                aria-label={t("workspace.livePreviewAria")}
                className="border-border bg-surface-raised min-w-0 rounded-md border shadow-sm xl:h-full xl:flex-1"
              >
                <div className="border-border bg-surface-sunken flex items-center gap-2 border-b px-4 py-1">
                  <Eye className="text-primary size-4" aria-hidden />
                  <p className="text-xs font-semibold tracking-wide uppercase">
                    {t("workspace.livePreview")}
                  </p>
                  <span className="text-muted-foreground ml-auto hidden text-xs sm:inline">
                    {t("workspace.updatesAsYouType")}
                  </span>
                  <div
                    role="group"
                    aria-label={t("workspace.previewLayoutAria")}
                    className="border-border bg-surface-raised ml-auto flex items-center gap-0.5 rounded-md border p-0.5 sm:ml-3"
                  >
                    <Button
                      type="button"
                      variant={
                        previewLayout === "split"
                          ? "secondary"
                          : "ghost"
                      }
                      size="sm"
                      className="h-6 gap-1 px-2 text-xs"
                      aria-pressed={previewLayout === "split"}
                      title={t("workspace.splitTitle")}
                      onClick={() => setPreviewLayout("split")}
                    >
                      <Columns2 />
                      {t("workspace.split")}
                    </Button>
                    <Button
                      type="button"
                      variant={
                        previewLayout === "full"
                          ? "secondary"
                          : "ghost"
                      }
                      size="sm"
                      className="h-6 gap-1 px-2 text-xs"
                      aria-pressed={previewLayout === "full"}
                      title={t("workspace.fullTitle")}
                      onClick={() => setPreviewLayout("full")}
                    >
                      <RectangleHorizontal />
                      {t("workspace.full")}
                    </Button>
                  </div>
                </div>
                <div className="p-4">
                  {(
                    editMode === "markdown"
                      ? markdownDraft
                      : draftContent
                  ) ? (
                    editMode === "markdown" ? (
                      <MarkdownContent content={markdownDraft} />
                    ) : (
                      <RichTextContent content={draftContent} />
                    )
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      {t("workspace.nothingToPreview")}
                    </p>
                  )}
                </div>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </form>
  );
}
