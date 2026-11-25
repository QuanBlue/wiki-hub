"use client";

import { EditSpaceModal } from "@/components/admin/edit-space-modal";
import { ImportPagesDialog } from "@/components/pages/import-pages-dialog";
import { MovePageDialog } from "@/components/pages/move-page-dialog";
import { PageAttachmentsDialog } from "@/components/pages/page-attachments-dialog";
import { PageHistoryModal } from "@/components/pages/page-history-modal";
import { PageLabelsDialog } from "@/components/pages/page-labels-dialog";
import { PageRestrictionsDialog } from "@/components/pages/page-restrictions-dialog";
import { PageSummaryDialog } from "@/components/pages/page-summary-dialog";
import { PublicShareDialog } from "@/components/pages/public-share-dialog";
import { RelatedPagesDialog } from "@/components/pages/related-pages";
import { SaveAsTemplateDialog } from "@/components/pages/save-as-template-dialog";
import { SharePageDialog } from "@/components/pages/share-page-dialog";
import { SpaceGraphDialog } from "@/components/pages/space-graph";
import { SpaceHealthDialog } from "@/components/pages/space-health";
import { SpaceTemplatesDialog } from "@/components/pages/space-templates-dialog";
import { SpaceTrashDialog } from "@/components/pages/space-trash";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useTranslation } from "@/lib/i18n/context";
import type {
  Group,
  PageLabel,
  PageRelated,
  Space,
  SpaceMember,
  WikiPage,
} from "@/types/api";
import type { EditMode } from "./types";

export type WorkspaceDialogsProps = {
  space: Space;
  pages: WikiPage[];
  members: SpaceMember[];
  groups: Group[];
  currentPage?: WikiPage | null;
  canAdmin: boolean;
  canManageRestrictions: boolean;
  canManageTemplates?: boolean;
  isSystemAdmin?: boolean;
  related: PageRelated | null;
  leaveHref: string | null;
  reloadPending: boolean;
  cancelEditPending: boolean;
  pageEditDirty: boolean;
  savePending: boolean;
  draftNowPending: boolean;
  onDismissLeaveDialog: () => void;
  onLeaveWithoutSaving: () => void;
  onSaveDraftAndCancel: () => Promise<void>;
  onSaveBeforeLeave: () => Promise<void>;
  conversionMode: EditMode | null;
  onDismissConversion: () => void;
  onConfirmConversion: (mode: EditMode) => void;
  discardDraftOpen: boolean;
  setDiscardDraftOpen: (open: boolean) => void;
  discardDraftPending: boolean;
  onDiscardRecoveryDraft: () => Promise<void>;
  overwriteConfirmOpen: boolean;
  setOverwriteConfirmOpen: (open: boolean) => void;
  onConfirmOverwrite: () => void;
  movePageOpen: boolean;
  setMovePageOpen: (open: boolean) => void;
  pageAccessOpen: boolean;
  setPageAccessOpen: (open: boolean) => void;
  summaryOpen: boolean;
  setSummaryOpen: (open: boolean) => void;
  shareDialogOpen: boolean;
  setShareDialogOpen: (open: boolean) => void;
  onCopyLink: () => Promise<void>;
  onShared: (count: number) => void;
  publicShareDialogOpen: boolean;
  setPublicShareDialogOpen: (open: boolean) => void;
  historyModalOpen: boolean;
  setHistoryModalOpen: (open: boolean) => void;
  onRefresh: () => void;
  editSpaceModalOpen: boolean;
  setEditSpaceModalOpen: (open: boolean) => void;
  trashOpen: boolean;
  setTrashOpen: (open: boolean) => void;
  mapOpen: boolean;
  setMapOpen: (open: boolean) => void;
  healthOpen: boolean;
  setHealthOpen: (open: boolean) => void;
  templatesOpen?: boolean;
  setTemplatesOpen?: (open: boolean) => void;
  saveAsTemplateOpen?: boolean;
  setSaveAsTemplateOpen?: (open: boolean) => void;
  relatedOpen: boolean;
  setRelatedOpen: (open: boolean) => void;
  importDialogOpen: boolean;
  setImportDialogOpen: (open: boolean) => void;
  attachmentsDialogOpen: boolean;
  setAttachmentsDialogOpen: (open: boolean) => void;
  labelsDialogOpen: boolean;
  setLabelsDialogOpen: (open: boolean) => void;
  onPageLabelsChange: (labels: PageLabel[]) => void;
  deletePageOpen: boolean;
  setDeletePageOpen: (open: boolean) => void;
  trashDays: number;
  deletePagePending: boolean;
  onDeletePage: () => Promise<void>;
};

export function WorkspaceDialogs({
  space,
  pages,
  members,
  groups,
  currentPage,
  canAdmin,
  canManageRestrictions,
  canManageTemplates = false,
  isSystemAdmin = false,
  related,
  leaveHref,
  reloadPending,
  cancelEditPending,
  pageEditDirty,
  savePending,
  draftNowPending,
  onDismissLeaveDialog,
  onLeaveWithoutSaving,
  onSaveDraftAndCancel,
  onSaveBeforeLeave,
  conversionMode,
  onDismissConversion,
  onConfirmConversion,
  discardDraftOpen,
  setDiscardDraftOpen,
  discardDraftPending,
  onDiscardRecoveryDraft,
  overwriteConfirmOpen,
  setOverwriteConfirmOpen,
  onConfirmOverwrite,
  movePageOpen,
  setMovePageOpen,
  pageAccessOpen,
  setPageAccessOpen,
  summaryOpen,
  setSummaryOpen,
  shareDialogOpen,
  setShareDialogOpen,
  onCopyLink,
  onShared,
  publicShareDialogOpen,
  setPublicShareDialogOpen,
  historyModalOpen,
  setHistoryModalOpen,
  onRefresh,
  editSpaceModalOpen,
  setEditSpaceModalOpen,
  trashOpen,
  setTrashOpen,
  mapOpen,
  setMapOpen,
  healthOpen,
  setHealthOpen,
  templatesOpen = false,
  setTemplatesOpen,
  saveAsTemplateOpen = false,
  setSaveAsTemplateOpen,
  relatedOpen,
  setRelatedOpen,
  importDialogOpen,
  setImportDialogOpen,
  attachmentsDialogOpen,
  setAttachmentsDialogOpen,
  labelsDialogOpen,
  setLabelsDialogOpen,
  onPageLabelsChange,
  deletePageOpen,
  setDeletePageOpen,
  trashDays,
  deletePagePending,
  onDeletePage,
}: WorkspaceDialogsProps) {
  const { t } = useTranslation();

  return (
    <>
      <ConfirmDialog
        open={leaveHref !== null || reloadPending || cancelEditPending}
        onOpenChange={(open) => {
          if (!open) onDismissLeaveDialog();
        }}
        title={
          reloadPending
            ? t("workspace.reloadTitle")
            : cancelEditPending
              ? t("workspace.cancelEditTitle")
              : t("workspace.leaveTitle")
        }
        description={
          reloadPending
            ? t("workspace.reloadDescription")
            : t("workspace.leaveDescription")
        }
        confirmLabel={reloadPending ? t("workspace.reload") : t("workspace.saveAndLeave")}
        cancelLabel={t("workspace.stay")}
        secondaryLabel={
          reloadPending
            ? t("workspace.reloadWithoutSaving")
            : t("workspace.leaveWithoutSaving")
        }
        onSecondary={onLeaveWithoutSaving}
        tertiaryLabel={
          cancelEditPending && pageEditDirty
            ? t("workspace.saveDraftAndLeave")
            : undefined
        }
        onTertiary={() => void onSaveDraftAndCancel()}
        dismissOnOutsideClick={!(savePending || draftNowPending)}
        pending={savePending || draftNowPending}
        onConfirm={() => void onSaveBeforeLeave()}
      />

      <ConfirmDialog
        open={conversionMode !== null}
        onOpenChange={(open) => {
          if (!open) onDismissConversion();
        }}
        title={
          conversionMode === "markdown"
            ? t("workspace.convertMarkdownTitle")
            : t("workspace.convertHtmlTitle")
        }
        description={
          conversionMode === "markdown"
            ? t("workspace.convertMarkdownDescription")
            : t("workspace.convertHtmlDescription")
        }
        confirmLabel={t("workspace.continue")}
        onConfirm={() => {
          if (!conversionMode) return;
          onConfirmConversion(conversionMode);
        }}
      />

      <ConfirmDialog
        open={discardDraftOpen}
        onOpenChange={(open) => {
          if (!open) setDiscardDraftOpen(false);
        }}
        title={t("workspace.discardDraftTitle")}
        description={t("workspace.discardDraftDescription")}
        confirmLabel={t("workspace.discardDraft")}
        destructive
        pending={discardDraftPending}
        onConfirm={() => void onDiscardRecoveryDraft()}
      />

      <ConfirmDialog
        open={overwriteConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setOverwriteConfirmOpen(false);
        }}
        title={t("workspace.overwriteConfirmTitle")}
        description={t("workspace.overwriteConfirmDescription")}
        confirmLabel={t("workspace.overwriteAndSave")}
        cancelLabel={t("workspace.stay")}
        destructive
        onConfirm={onConfirmOverwrite}
      />

      {currentPage ? (
        <MovePageDialog
          space={space}
          page={currentPage}
          pages={pages}
          open={movePageOpen}
          onOpenChange={setMovePageOpen}
        />
      ) : null}

      {currentPage && canManageRestrictions ? (
        <PageRestrictionsDialog
          spaceKey={space.key}
          page={currentPage}
          members={members}
          open={pageAccessOpen}
          onOpenChange={setPageAccessOpen}
        />
      ) : null}

      {currentPage ? (
        <PageSummaryDialog
          // A different page starts from a clean slate.
          key={`${space.key}/${currentPage.slug}`}
          open={summaryOpen}
          onOpenChange={setSummaryOpen}
          spaceKey={space.key}
          pageSlug={currentPage.slug}
          pageTitle={currentPage.title}
        />
      ) : null}

      {currentPage ? (
        <SharePageDialog
          spaceKey={space.key}
          pageSlug={currentPage.slug}
          pageTitle={currentPage.title}
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          onCopyLink={() => void onCopyLink()}
          onShared={onShared}
        />
      ) : null}

      {currentPage ? (
        <PublicShareDialog
          spaceKey={space.key}
          pageSlug={currentPage.slug}
          pageTitle={currentPage.title}
          open={publicShareDialogOpen}
          onOpenChange={setPublicShareDialogOpen}
        />
      ) : null}

      {currentPage ? (
        <PageHistoryModal
          open={historyModalOpen}
          onOpenChange={setHistoryModalOpen}
          spaceKey={space.key}
          slug={currentPage.slug}
          pageTitle={currentPage.title}
          onRestored={onRefresh}
        />
      ) : null}

      <EditSpaceModal
        space={space}
        groups={groups}
        open={editSpaceModalOpen}
        onOpenChange={setEditSpaceModalOpen}
      />

      <SpaceTrashDialog space={space} open={trashOpen} onOpenChange={setTrashOpen} />
      <SpaceGraphDialog space={space} open={mapOpen} onOpenChange={setMapOpen} />
      {canAdmin ? (
        <SpaceHealthDialog space={space} open={healthOpen} onOpenChange={setHealthOpen} />
      ) : null}
      {canManageTemplates && setTemplatesOpen ? (
        <SpaceTemplatesDialog
          space={space}
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
        />
      ) : null}
      {currentPage && canManageTemplates && setSaveAsTemplateOpen ? (
        <SaveAsTemplateDialog
          spaceKey={space.key}
          page={currentPage}
          open={saveAsTemplateOpen}
          onOpenChange={setSaveAsTemplateOpen}
          canCreateGlobal={isSystemAdmin}
        />
      ) : null}
      <RelatedPagesDialog
        related={related}
        spaceKey={space.key}
        open={relatedOpen}
        onOpenChange={setRelatedOpen}
      />

      {/* One controlled instance shared by both entry points: the sidebar
          button and the More-actions item. Nesting a second Radix trigger
          inside the dropdown would fight the menu for focus. */}
      <ImportPagesDialog
        spaceKey={space.key}
        parentPage={null}
        existingPages={pages}
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        trigger={null}
        onStarted={() => undefined}
        onFinished={onRefresh}
      />

      {currentPage ? (
        <PageAttachmentsDialog
          pageTitle={currentPage.title}
          content={currentPage.content}
          open={attachmentsDialogOpen}
          onOpenChange={setAttachmentsDialogOpen}
        />
      ) : null}
      {currentPage ? (
        <PageLabelsDialog
          spaceKey={space.key}
          slug={currentPage.slug}
          open={labelsDialogOpen}
          onOpenChange={setLabelsDialogOpen}
          onChange={onPageLabelsChange}
        />
      ) : null}

      <ConfirmDialog
        open={deletePageOpen}
        onOpenChange={setDeletePageOpen}
        title={t("workspace.deletePageTitle")}
        description={t("workspace.deletePageDescription", {
          title:
            currentPage?.title ?? t("workspace.deletePageFallback"),
          days: trashDays,
        })}
        confirmLabel={t("workspace.deletePageConfirm")}
        destructive
        pending={deletePagePending}
        onConfirm={() => void onDeletePage()}
      />
    </>
  );
}
