"use client";

import {
  Bookmark,
  Check,
  ChevronDown,
  Clock3,
  CodeXml,
  Download,
  Eye,
  EyeOff,
  FileText,
  FileType,
  FolderInput,
  Globe,
  LayoutTemplate,
  Link2,
  Lock,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Network,
  Pencil,
  Pin,
  RefreshCw,
  Save,
  Share2,
  Sparkles,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { CreatePageDialog } from "@/components/pages/create-page-dialog";
import { WatchButton } from "@/components/pages/watch-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { PageRelated, Space, WikiPage } from "@/types/api";
import { pageHref } from "./content-transforms";
import type { EditMode, PageAccess } from "./types";
import { PageAccessIcon } from "./workspace-primitives";

export type WorkspaceHeaderProps = {
  space: Space;
  currentPage?: WikiPage | null;
  homeHref: string;
  isHomePage: boolean;
  compactBreadcrumbPages: (WikiPage | null)[];
  currentPageAccess: PageAccess;
  isSticky: boolean;
  showHeader: boolean;
  canEdit: boolean;
  canExport: boolean;
  canManageRestrictions: boolean;
  canManageTemplates?: boolean;
  publicSharesEnabled: boolean;
  overviewEditing: boolean;
  overviewSavePending: boolean;
  saveOverview: () => Promise<void>;
  cancelOverviewEditing: () => void;
  beginOverviewEditing: () => void;
  editing: boolean;
  previewing: boolean;
  setPreviewing: React.Dispatch<React.SetStateAction<boolean>>;
  autoSaveEnabled: boolean;
  setAutoSaveEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  autoSaveStatus: "idle" | "saving" | "saved";
  markAutoSaveStatus: (status: "idle" | "saving" | "saved") => void;
  savePending: boolean;
  draftNowPending: boolean;
  draftDirty: boolean;
  pageEditDirty: boolean;
  saveDraftNow: () => Promise<boolean>;
  requestCancelEditing: () => void;
  beginEditing: (mode: EditMode) => void;
  savedForLater: boolean;
  toggleSavedForLater: () => void;
  pinned: boolean;
  pinPending: boolean;
  togglePinned: () => Promise<void>;
  shareCurrentPage: () => Promise<void>;
  exportPage: (format: "pdf" | "html" | "docx") => Promise<void>;
  viewFullWidth: boolean;
  setViewFullWidth: (fullWidth: boolean) => void;
  related: PageRelated | null;
  onOpenSummary: () => void;
  onOpenShareDialog: () => void;
  onOpenPublicShareDialog: () => void;
  onOpenMovePage: () => void;
  onOpenHistoryModal: () => void;
  onOpenPageAccess: () => void;
  onOpenLabelsDialog: () => void;
  onOpenRelated: () => void;
  onOpenAttachmentsDialog: () => void;
  onOpenSaveAsTemplate?: () => void;
  onOpenDeletePage: () => void;
};

export function WorkspaceHeader({
  space,
  currentPage,
  homeHref,
  isHomePage,
  compactBreadcrumbPages,
  currentPageAccess,
  isSticky,
  showHeader,
  canEdit,
  canExport,
  canManageRestrictions,
  canManageTemplates = false,
  publicSharesEnabled,
  overviewEditing,
  overviewSavePending,
  saveOverview,
  cancelOverviewEditing,
  beginOverviewEditing,
  editing,
  previewing,
  setPreviewing,
  autoSaveEnabled,
  setAutoSaveEnabled,
  autoSaveStatus,
  markAutoSaveStatus,
  savePending,
  draftNowPending,
  draftDirty,
  pageEditDirty,
  saveDraftNow,
  requestCancelEditing,
  beginEditing,
  savedForLater,
  toggleSavedForLater,
  pinned,
  pinPending,
  togglePinned,
  shareCurrentPage,
  exportPage,
  viewFullWidth,
  setViewFullWidth,
  related,
  onOpenSummary,
  onOpenShareDialog,
  onOpenPublicShareDialog,
  onOpenMovePage,
  onOpenHistoryModal,
  onOpenPageAccess,
  onOpenLabelsDialog,
  onOpenRelated,
  onOpenAttachmentsDialog,
  onOpenSaveAsTemplate,
  onOpenDeletePage,
}: WorkspaceHeaderProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        isSticky
          ? "transition-all duration-300"
          : "transition-[transform,opacity,padding] duration-300",
        "-mx-6 px-6 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10",
        isSticky
          ? "bg-background border-border sticky top-topbar md:top-0 z-30 border-b py-3 shadow-sm"
          : "relative py-5",
        showHeader
          ? "translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-full opacity-0",
      )}
    >
      <nav
        aria-label={t("workspace.breadcrumbAria")}
        className="min-w-0 flex-1 overflow-hidden text-sm"
      >
        <ol className="flex min-w-0 items-center whitespace-nowrap">
          <li className="shrink-0">
            <Link
              href={homeHref}
              className="text-primary focus-visible:ring-ring rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              {t("nav.spaces")}
            </Link>
          </li>
          {compactBreadcrumbPages.map((page) => (
            <li
              key={page?.id ?? "collapsed-ancestors"}
              className="flex min-w-0 items-center"
            >
              <span className="text-muted-foreground mx-2 shrink-0">
                /
              </span>
              {page === null ? (
                <span
                  className="text-muted-foreground shrink-0"
                  aria-label={t("workspace.earlierPagesAria")}
                >
                  …
                </span>
              ) : page.id === currentPage?.id ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="text-muted-foreground max-w-56 truncate"
                    title={page.title}
                  >
                    {page.title}
                  </span>
                  <PageAccessIcon access={currentPageAccess} />
                </span>
              ) : (
                <Link
                  href={pageHref(space.key, page.slug)}
                  title={page.title}
                  className="text-primary focus-visible:ring-ring max-w-48 truncate rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
                >
                  {page.title}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-nowrap items-center gap-1 [&>button]:!text-sm [&>button]:!font-medium [&>div>button]:!text-sm [&>div>button]:!font-medium">
        {overviewEditing ? (
          <>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void saveOverview()}
              disabled={overviewSavePending}
            >
              <Check />
              {overviewSavePending
                ? t("workspace.saving")
                : t("common.save")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={cancelOverviewEditing}
              disabled={overviewSavePending}
            >
              <X />
              {t("common.cancel")}
            </Button>
          </>
        ) : editing ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPreviewing((current) => !current)}
              disabled={savePending}
              aria-pressed={previewing}
            >
              {previewing ? <EyeOff /> : <Eye />}
              {previewing
                ? t("workspace.hideLivePreview")
                : t("workspace.livePreview")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={autoSaveEnabled}
              title={
                autoSaveEnabled
                  ? t("workspace.autoSaveOnTitle")
                  : t("workspace.autoSaveOffTitle")
              }
              onClick={() => {
                setAutoSaveEnabled((current) => !current);
                markAutoSaveStatus("idle");
              }}
              disabled={savePending}
              className={cn(
                "bg-surface-hover text-muted-foreground hover:bg-surface-selected hover:text-foreground min-w-36",
                autoSaveEnabled &&
                  "border-primary/40 bg-surface-selected text-primary hover:bg-surface-hover hover:text-primary",
              )}
            >
              {autoSaveStatus === "saving" ? (
                <RefreshCw className="animate-spin [animation-duration:1s]" />
              ) : autoSaveStatus === "saved" ? (
                <Check />
              ) : (
                <RefreshCw />
              )}
              {autoSaveStatus === "saved"
                ? t("workspace.autoSaveSaved")
                : autoSaveEnabled
                  ? t("workspace.autoSaveOn")
                  : t("workspace.autoSave")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              title={t("workspace.saveDraftTitle")}
              onClick={() => void saveDraftNow()}
              disabled={savePending || draftNowPending || !draftDirty}
              className="border-warning/50 bg-warning-bg text-warning [&:not(:disabled)]:hover:border-warning/70 [&:not(:disabled)]:hover:bg-[color:color-mix(in_oklab,var(--wh-warning)_12%,var(--surface))] active:bg-[color:color-mix(in_oklab,var(--wh-warning)_20%,var(--surface))] disabled:border-border disabled:bg-surface-hover disabled:text-muted-foreground"
            >
              <Save />
              {draftNowPending
                ? t("workspace.savingDraft")
                : t("workspace.saveDraft")}
            </Button>
            <Button
              type="submit"
              form="page-editor-form"
              variant="primary"
              size="sm"
              disabled={savePending}
              aria-label={
                pageEditDirty
                  ? t("workspace.saveChanges")
                  : t("common.save")
              }
            >
              <Check />
              {savePending
                ? t("workspace.saving")
                : pageEditDirty
                  ? t("workspace.saveDirty")
                  : t("common.save")}
            </Button>
            <span aria-hidden className="bg-border mx-1 h-5 w-px" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={requestCancelEditing}
              disabled={savePending}
            >
              <X />
              {t("common.cancel")}
            </Button>
          </>
        ) : !currentPage && canEdit && space.status === "active" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={beginOverviewEditing}
            title={t("workspace.editOverviewTooltip")}
          >
            <Pencil />
            {t("workspace.editOverview")}
          </Button>
        ) : currentPage && canEdit && space.status === "active" ? (
          <>
            <CreatePageDialog
              spaceKey={space.key}
              parentPage={isHomePage ? null : currentPage}
              triggerLabel={
                isHomePage ? t("workspace.newButton") : t("workspace.createButton")
              }
              triggerTitle={
                isHomePage
                  ? t("workspace.newPageTooltip")
                  : t("workspace.createSubpageTooltip")
              }
              triggerVariant="ghost"
              triggerSize="sm"
            />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={editing}
                  title={t("workspace.editTooltip")}
                >
                  <Pencil />
                  {t("spaces.edit")}
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="text-muted-foreground min-w-48 text-sm font-medium"
              >
                <DropdownMenuItem onSelect={() => beginEditing("normal")}>
                  <Pencil />
                  {t("workspace.normalEditor")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => beginEditing("markdown")}
                >
                  <FileText />
                  {t("workspace.markdownSource")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => beginEditing("html")}>
                  <CodeXml />
                  {t("workspace.htmlSource")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
        {!editing && !overviewEditing ? (
          <>
            <div className="hidden items-center gap-1 lg:flex">
              {currentPage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onOpenSummary}
                  title={t("ai.summarize")}
                  aria-label={t("ai.button")}
                  className="hidden 2xl:inline-flex"
                >
                  <Sparkles />
                  <span className="hidden 2xl:inline">{t("ai.button")}</span>
                </Button>
              ) : null}
              {currentPage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={toggleSavedForLater}
                  aria-pressed={savedForLater}
                  title={savedForLater ? t("workspace.removeFromSavedTooltip") : t("workspace.saveForLaterTooltip")}
                  aria-label={savedForLater ? t("workspace.savedToggle") : t("workspace.saveForLater")}
                  className="hidden xl:inline-flex"
                >
                  <Bookmark
                    className={cn(
                      savedForLater && "text-primary fill-current",
                    )}
                  />
                  <span className="hidden 2xl:inline">
                    {savedForLater
                      ? t("workspace.savedToggle")
                      : t("workspace.saveForLater")}
                  </span>
                </Button>
              ) : null}
              {currentPage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void togglePinned()}
                  disabled={pinPending}
                  aria-pressed={pinned}
                  title={pinned ? t("workspace.unpinTooltip") : t("workspace.pinTooltip")}
                  aria-label={pinned ? t("workspace.pinnedToggle") : t("workspace.pinPage")}
                  className="hidden lg:inline-flex"
                >
                  <Pin className={cn(pinned && "text-primary fill-current")} />
                  <span className="hidden 2xl:inline">
                    {pinned
                      ? t("workspace.pinnedToggle")
                      : t("workspace.pinPage")}
                  </span>
                </Button>
              ) : null}
              <WatchButton space={space} page={currentPage} />
              {currentPage ? (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title={t("workspace.shareTooltip")}
                    >
                      <Share2 />
                      {t("workspace.share")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="text-muted-foreground min-w-52 text-sm font-medium"
                  >
                    <DropdownMenuItem
                      onSelect={() => void shareCurrentPage()}
                      title={t("share.copyPageLinkTooltip")}
                    >
                      <Link2 />
                      {t("share.copyPageLink")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={onOpenShareDialog}
                      title={t("share.shareInternallyTooltip")}
                    >
                      <Users />
                      {t("share.withPeople")}
                    </DropdownMenuItem>
                    {publicSharesEnabled ? (
                      <DropdownMenuItem
                        onSelect={onOpenPublicShareDialog}
                        title={t("share.sharePubliclyTooltip")}
                      >
                        <Globe />
                        {t("share.sharePublicly")}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                // A space overview has no page to send anyone; its
                // link is all there is to share.
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void shareCurrentPage()}
                  title={t("workspace.shareOverviewTooltip")}
                >
                  <Share2 />
                  {t("workspace.share")}
                </Button>
              )}
            </div>
            {currentPage ? (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("workspace.moreActionsAria")}
                    title={t("workspace.moreActionsTooltip")}
                    className="hidden lg:inline-flex"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="text-muted-foreground min-w-52 text-sm font-medium"
                >
                  {/* Secondary page actions collapsed into ... like a stack when the screen narrows */}
                  <DropdownMenuItem
                    onSelect={onOpenSummary}
                    className="2xl:hidden"
                  >
                    <Sparkles />
                    {t("ai.button")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={toggleSavedForLater}
                    className="xl:hidden"
                  >
                    <Bookmark
                      className={cn(
                        savedForLater && "text-primary fill-current",
                      )}
                    />
                    {savedForLater
                      ? t("workspace.removeFromSaved")
                      : t("workspace.saveForLater")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void togglePinned()}
                    disabled={pinPending}
                    className="lg:hidden"
                  >
                    <Pin
                      className={cn(pinned && "text-primary fill-current")}
                    />
                    {pinned
                      ? t("workspace.pinnedToggle")
                      : t("workspace.pinPage")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="2xl:hidden" />
                  {currentPage?.can_move && space.status === "active" ? (
                    <DropdownMenuItem
                      onSelect={onOpenMovePage}
                    >
                      <FolderInput />
                      {t("workspace.movePage")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    onSelect={onOpenHistoryModal}
                  >
                    <Clock3 />
                    {t("workspace.pageHistory")}
                  </DropdownMenuItem>
                  {canManageRestrictions ? (
                    <DropdownMenuItem onSelect={onOpenPageAccess}>
                      <Lock />
                      {t("workspace.pageAccess")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onSelect={onOpenLabelsDialog}>
                    <Tag />
                    {t("workspace.labels")}
                  </DropdownMenuItem>
                  {related?.pages.length ? (
                    <DropdownMenuItem onSelect={onOpenRelated}>
                      <Network />
                      {t("graph.relatedTitle")} ({related.pages.length})
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    onSelect={onOpenAttachmentsDialog}
                  >
                    <FileText />
                    {t("workspace.attachments")}
                  </DropdownMenuItem>
                  {canManageTemplates &&
                  onOpenSaveAsTemplate &&
                  space.status === "active" ? (
                    <DropdownMenuItem onSelect={onOpenSaveAsTemplate}>
                      <LayoutTemplate />
                      {t("workspace.saveAsTemplate")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Maximize2 />
                      {t("workspace.view")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48">
                      <DropdownMenuItem
                        onSelect={() => setViewFullWidth(true)}
                      >
                        <Maximize2 />
                        {t("workspace.fullWidth")}
                        {viewFullWidth ? (
                          <Check className="text-primary ml-auto size-4" />
                        ) : null}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => setViewFullWidth(false)}
                      >
                        <Minimize2 />
                        {t("workspace.normalWidth")}
                        {!viewFullWidth ? (
                          <Check className="text-primary ml-auto size-4" />
                        ) : null}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  {canExport ? (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Download />
                        {t("workspace.export")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="text-muted-foreground w-48 text-sm font-medium">
                        <DropdownMenuItem onSelect={() => exportPage("html")}>
                          <Download />
                          {t("workspace.exportHtml")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => exportPage("pdf")}>
                          <FileText />
                          {t("workspace.exportPdf")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => exportPage("docx")}>
                          <FileType />
                          {t("workspace.exportWord")}
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : null}
                  {currentPage?.can_delete && space.status === "active" ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-danger focus:text-danger [&_svg]:text-danger"
                        onSelect={onOpenDeletePage}
                      >
                        <Trash2 className="!text-danger" />
                        {t("workspace.deletePage")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("workspace.moreActionsAria")}
                  title={t("workspace.moreActionsTooltip")}
                  className="lg:hidden"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="text-muted-foreground min-w-48 text-sm font-medium lg:hidden"
              >
                {currentPage ? (
                  <DropdownMenuItem onSelect={onOpenSummary}>
                    <Sparkles />
                    {t("ai.button")}
                  </DropdownMenuItem>
                ) : null}
                {currentPage ? (
                  <DropdownMenuItem onSelect={toggleSavedForLater}>
                    <Bookmark
                      className={cn(
                        savedForLater && "text-primary fill-current",
                      )}
                    />
                    {savedForLater
                      ? t("workspace.removeFromSaved")
                      : t("workspace.saveForLater")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onSelect={() => void shareCurrentPage()}
                  title={t("share.copyPageLinkTooltip")}
                >
                  <Link2 />
                  {t("share.copyPageLink")}
                </DropdownMenuItem>
                {currentPage ? (
                  <DropdownMenuItem
                    onSelect={onOpenShareDialog}
                    title={t("share.shareInternallyTooltip")}
                  >
                    <Share2 />
                    {t("share.withPeople")}
                  </DropdownMenuItem>
                ) : null}
                {currentPage && publicSharesEnabled ? (
                  <DropdownMenuItem
                    onSelect={onOpenPublicShareDialog}
                    title={t("share.sharePubliclyTooltip")}
                  >
                    <Globe />
                    {t("share.sharePublicly")}
                  </DropdownMenuItem>
                ) : null}
                {currentPage && canManageRestrictions ? (
                  <DropdownMenuItem onSelect={onOpenPageAccess}>
                    <Lock />
                    {t("workspace.pageAccess")}
                  </DropdownMenuItem>
                ) : null}
                {currentPage ? (
                  <DropdownMenuItem onSelect={onOpenLabelsDialog}>
                    <Tag />
                    {t("workspace.labels")}
                  </DropdownMenuItem>
                ) : null}
                {currentPage ? (
                  <>
                    <DropdownMenuItem disabled={pinPending} onSelect={() => void togglePinned()}>
                      <Pin className={cn(pinned && "text-primary fill-current")} />
                      {pinned
                        ? t("workspace.removeFromPinned")
                        : t("workspace.pinPage")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {canExport ? (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Download />
                          {t("workspace.export")}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="text-muted-foreground w-48 text-sm font-medium">
                          <DropdownMenuItem onSelect={() => exportPage("html")}>
                            <Download />
                            {t("workspace.exportHtml")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => exportPage("pdf")}>
                            <FileText />
                            {t("workspace.exportPdf")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => exportPage("docx")}>
                            <FileType />
                            {t("workspace.exportWord")}
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ) : null}
                    {currentPage?.can_move && space.status === "active" ? (
                      <DropdownMenuItem
                        onSelect={onOpenMovePage}
                      >
                        <FolderInput />
                        {t("workspace.movePage")}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onSelect={onOpenHistoryModal}
                    >
                      <Clock3 />
                      {t("workspace.pageHistory")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={onOpenAttachmentsDialog}
                    >
                      <FileText />
                      {t("workspace.attachments")}
                    </DropdownMenuItem>
                    {canManageTemplates &&
                    onOpenSaveAsTemplate &&
                    space.status === "active" ? (
                      <DropdownMenuItem onSelect={onOpenSaveAsTemplate}>
                        <LayoutTemplate />
                        {t("workspace.saveAsTemplate")}
                      </DropdownMenuItem>
                    ) : null}
                    {currentPage?.can_delete && space.status === "active" ? (
                      <DropdownMenuItem
                        className="text-danger focus:text-danger [&_svg]:text-danger"
                        onSelect={onOpenDeletePage}
                      >
                        <Trash2 className="!text-danger" />
                        {t("workspace.deletePage")}
                      </DropdownMenuItem>
                    ) : null}
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Maximize2 />
                    {t("workspace.view")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48">
                    <DropdownMenuItem
                      onSelect={() => setViewFullWidth(true)}
                    >
                      <Maximize2 />
                      {t("workspace.fullWidth")}
                      {viewFullWidth ? (
                        <Check className="text-primary ml-auto size-4" />
                      ) : null}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setViewFullWidth(false)}
                    >
                      <Minimize2 />
                      {t("workspace.normalWidth")}
                      {!viewFullWidth ? (
                        <Check className="text-primary ml-auto size-4" />
                      ) : null}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>
    </div>
  );
}
