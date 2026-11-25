"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { aiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";
import {
  clearLocalPageDraft,
  discardPageDraft,
  getLocalPageDraft,
  getPageDraft,
  saveLocalPageDraft,
  savePageDraft,
} from "@/lib/drafts";
import { useTranslation } from "@/lib/i18n/context";
import { matchesShortcut } from "@/lib/keyboard-shortcuts";
import { markdownToHtml } from "@/lib/markdown-html";
import type {
  PageAttachmentUpload,
  PageDraft,
  PageSavedEvent,
  Space,
  WikiPage,
} from "@/types/api";
import {
  formatForMode,
  htmlToMarkdown,
  navigationTargetOf,
  prettyHtml,
  prettyMarkdownEmbeddedHtml,
} from "./content-transforms";
import type { EditMode } from "./types";

export function usePageEditor({
  space,
  currentPage,
  canEdit,
  onShareCurrentPage,
  onOpenLabelsDialog,
}: {
  space: Space;
  currentPage?: WikiPage | null;
  canEdit: boolean;
  onShareCurrentPage: () => Promise<void>;
  onOpenLabelsDialog: () => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();

  const [editing, setEditing] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>("normal");
  const [conversionMode, setConversionMode] = useState<EditMode | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewSplit, setPreviewSplit] = useState(50);
  // "split" keeps the editor beside the preview; "full" hands the whole width
  // to the preview so a page can be read the way it will actually look. The
  // editor stays mounted either way - unmounting it would throw away the
  // caret and the undo history every time the layout changed.
  const [previewLayout, setPreviewLayout] = useState<"split" | "full">("split");

  const [draftContent, setDraftContent] = useState("");
  const [markdownDraft, setMarkdownDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [savePending, setSavePending] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [draftNowPending, setDraftNowPending] = useState(false);
  // Content (HTML or Markdown, whichever mode is active) last stored as a
  // draft this session. Drafts hold no title, so only content is compared.
  const [draftSavedContent, setDraftSavedContent] = useState<string | null>(
    null,
  );
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const autoSaveInFlight = useRef(false);
  const autoSaveResetTimer = useRef<number | null>(null);
  const draftSaveTimer = useRef<number | null>(null);
  const draftSaveInFlight = useRef<Promise<boolean> | null>(null);
  const allowUnload = useRef(false);

  const [recoveryDraft, setRecoveryDraft] = useState<PageDraft | null>(null);
  const [discardDraftOpen, setDiscardDraftOpen] = useState(false);
  const [discardDraftPending, setDiscardDraftPending] = useState(false);
  const [conflictNotice, setConflictNotice] = useState<PageSavedEvent | null>(null);
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);

  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const [reloadPending, setReloadPending] = useState(false);
  const [cancelEditPending, setCancelEditPending] = useState(false);
  const [overviewEditing, setOverviewEditing] = useState(false);
  const [overviewDraft, setOverviewDraft] = useState(space.description);
  const [overviewSavePending, setOverviewSavePending] = useState(false);

  const pageEditBaseline = useRef({ html: "", markdown: "", title: "" });
  const pageEditDirtyRef = useRef(false);
  const overviewEditBaseline = useRef(space.description);
  const latestPageDraft = useRef({
    currentPage,
    draftContent,
    markdownDraft,
    titleDraft,
    editMode,
  });
  latestPageDraft.current = {
    currentPage,
    draftContent,
    markdownDraft,
    titleDraft,
    editMode,
  };

  useEffect(() => {
    if (!currentPage || !currentPage.can_edit) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear page-scoped recovery state when navigation changes page
      setRecoveryDraft(null);
      return;
    }

    let active = true;
    void getPageDraft(space.key, currentPage.slug)
      .then((draft) => {
        if (!active) return;
        const localDraft = getLocalPageDraft(space.key, currentPage.slug);
        if (localDraft && (!draft || localDraft.saved_at > draft.updated_at)) {
          setRecoveryDraft({
            ...localDraft,
            id: `local-${currentPage.id}`,
            page_id: currentPage.id,
            updated_at: localDraft.saved_at,
            is_conflict: localDraft.base_updated_at !== currentPage.updated_at,
          });
          return;
        }
        setRecoveryDraft(draft);
      })
      .catch(() => {
        if (active) setRecoveryDraft(null);
      });

    return () => {
      active = false;
    };
  }, [currentPage?.can_edit, currentPage?.slug, space.key]);

  const pageEditDirty =
    editing &&
    Boolean(currentPage) &&
    (titleDraft !== pageEditBaseline.current.title ||
      (editMode === "markdown"
        ? markdownDraft !== pageEditBaseline.current.markdown
        : draftContent !== pageEditBaseline.current.html));
  pageEditDirtyRef.current = pageEditDirty;

  const currentEditContent = editMode === "markdown" ? markdownDraft : draftContent;
  // Enabled only while there is content the stored draft does not already have.
  const draftDirty =
    pageEditDirty &&
    (editMode === "markdown"
      ? markdownDraft !== pageEditBaseline.current.markdown
      : draftContent !== pageEditBaseline.current.html) &&
    currentEditContent !== draftSavedContent;

  const overviewEditDirty =
    overviewEditing && overviewDraft !== overviewEditBaseline.current;
  const hasUnsavedChanges = pageEditDirty || overviewEditDirty;
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  hasUnsavedChangesRef.current = hasUnsavedChanges;

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const message = t("workspace.leaveWithoutSavingMessage");
    const confirmUnload = (event: BeforeUnloadEvent) => {
      if (allowUnload.current) return;
      // The debounce timer may not have fired before a refresh or tab close.
      // Keep the newest editor state in flight while the document unloads.
      void persistDraft({ keepalive: true });
      event.preventDefault();
      event.returnValue = message;
    };
    const confirmInternalNavigation = (event: MouseEvent) => {
      const destination = navigationTargetOf(event);
      if (!destination) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveHref(destination.href);
    };

    window.addEventListener("beforeunload", confirmUnload);
    document.addEventListener("click", confirmInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", confirmUnload);
      document.removeEventListener("click", confirmInternalNavigation, true);
    };
  }, [hasUnsavedChanges, t]);

  function navigateTo(destination: URL) {
    if (destination.origin === window.location.origin) {
      router.push(
        `${destination.pathname}${destination.search}${destination.hash}`,
      );
    } else {
      window.location.assign(destination.href);
    }
  }

  function leaveWithoutSaving() {
    if (cancelEditPending) {
      setCancelEditPending(false);
      if (draftSaveTimer.current !== null) {
        window.clearTimeout(draftSaveTimer.current);
        draftSaveTimer.current = null;
      }
      void discardCurrentDraft().finally(() => cancelEditing());
      return;
    }
    if (reloadPending) {
      setReloadPending(false);
      void persistDraft().finally(() => {
        allowUnload.current = true;
        window.location.reload();
      });
      return;
    }
    if (!leaveHref) return;
    const destination = new URL(leaveHref, window.location.href);
    setLeaveHref(null);
    void persistDraft().finally(() => navigateTo(destination));
  }

  async function saveBeforeLeave() {
    const saved = await persistPage();
    if (!saved) return;

    const destinationHref = leaveHref;
    const shouldReload = reloadPending;
    const shouldCancel = cancelEditPending;
    setLeaveHref(null);
    setReloadPending(false);
    setCancelEditPending(false);

    if (shouldCancel) {
      cancelEditing();
      router.refresh();
      return;
    }
    if (shouldReload) {
      allowUnload.current = true;
      window.location.reload();
      return;
    }
    if (!destinationHref) return;
    const destination = new URL(destinationHref, window.location.href);
    if (destination.origin === window.location.origin) {
      router.push(
        `${destination.pathname}${destination.search}${destination.hash}`,
      );
    } else {
      window.location.assign(destination.href);
    }
  }

  function requestCancelEditing() {
    if (!hasUnsavedChanges) {
      cancelEditing();
      return;
    }
    setCancelEditPending(true);
  }

  async function persistDraft({
    keepalive = false,
  }: { keepalive?: boolean } = {}): Promise<boolean> {
    // A loop, not a single await: two callers waiting on the same request
    // would otherwise both wake and send in parallel (the debounce timer and
    // the Save draft button, say).
    while (draftSaveInFlight.current) {
      await draftSaveInFlight.current;
    }

    const {
      currentPage: page,
      draftContent: htmlDraft,
      markdownDraft: markdownSource,
      editMode: mode,
    } = latestPageDraft.current;
    if (!page || !pageEditDirtyRef.current) return true;

    const savedContent = mode === "markdown" ? markdownSource : htmlDraft;
    const contentFormat = formatForMode(mode);
    const request = savePageDraft(
      space.key,
      page.slug,
      {
        content: savedContent,
        content_format: contentFormat,
        edit_mode: mode,
        base_updated_at: page.updated_at,
      },
      { keepalive },
    )
      .then((savedDraft) => {
        setDraftSavedContent(savedContent);
        setRecoveryDraft(
          savedDraft ?? {
            id: `local-${page.id}`,
            page_id: page.id,
            content: savedContent,
            content_format: contentFormat,
            edit_mode: mode,
            base_updated_at: page.updated_at,
            updated_at: new Date().toISOString(),
            is_conflict: false,
          },
        );
        return true;
      })
      .catch(() => false);
    draftSaveInFlight.current = request;
    try {
      return await request;
    } finally {
      if (draftSaveInFlight.current === request) {
        draftSaveInFlight.current = null;
      }
    }
  }

  async function discardCurrentDraft(): Promise<void> {
    const page = latestPageDraft.current.currentPage;
    if (!page) return;
    if (draftSaveInFlight.current) {
      await draftSaveInFlight.current;
    }
    try {
      await discardPageDraft(space.key, page.slug);
      clearLocalPageDraft(space.key, page.slug);
      setRecoveryDraft(null);
    } catch {
      toast.error(t("workspace.discardDraftError"));
    }
  }

  function openRecoveryDraft() {
    if (!currentPage || !recoveryDraft) return;
    // Recovered drafts always reopen in the rich-text editor. The source
    // editor remains an explicit user choice for a fresh edit session.
    const mode = "normal" as const;
    const markdown =
      recoveryDraft.content_format === "markdown"
        ? recoveryDraft.content
        : htmlToMarkdown(recoveryDraft.content);
    const html =
      recoveryDraft.content_format === "markdown"
        ? markdownToHtml(recoveryDraft.content)
        : recoveryDraft.content;
    const serverMarkdown =
      currentPage.content_format === "markdown"
        ? prettyMarkdownEmbeddedHtml(currentPage.content)
        : htmlToMarkdown(currentPage.content);
    const serverHtml =
      currentPage.content_format === "markdown"
        ? markdownToHtml(currentPage.content)
        : currentPage.content;

    setDraftContent(html);
    setMarkdownDraft(markdown);
    setTitleDraft(currentPage.title);
    latestPageDraft.current.draftContent = html;
    latestPageDraft.current.markdownDraft = markdown;
    latestPageDraft.current.titleDraft = currentPage.title;
    latestPageDraft.current.editMode = mode;
    pageEditBaseline.current = {
      html: serverHtml,
      markdown: serverMarkdown,
      title: currentPage.title,
    };
    pageEditDirtyRef.current =
      html !== serverHtml || markdown !== serverMarkdown;
    setEditMode(mode);
    setPreviewing(false);
    setEditing(true);
  }

  function updateTitleDraft(nextTitle: string) {
    latestPageDraft.current.titleDraft = nextTitle;
    pageEditDirtyRef.current = nextTitle !== pageEditBaseline.current.title;
    setTitleDraft(nextTitle);
  }

  function updateDraftContent(nextContent: string) {
    latestPageDraft.current.draftContent = nextContent;
    pageEditDirtyRef.current = nextContent !== pageEditBaseline.current.html;
    if (currentPage) {
      saveLocalPageDraft(space.key, currentPage.slug, {
        content: nextContent,
        content_format: formatForMode(editMode),
        edit_mode: editMode,
        base_updated_at: currentPage.updated_at,
      });
    }
    setDraftContent(nextContent);
  }

  async function uploadPageAttachment(
    file: File,
  ): Promise<PageAttachmentUpload> {
    if (!currentPage)
      throw new Error(t("workspace.uploadNeedsPage"));
    const form = new FormData();
    form.append("file", file);
    return api.post<PageAttachmentUpload>(
      `/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(currentPage.slug)}/attachments`,
      undefined,
      { rawBody: form },
    );
  }

  function updateMarkdownDraft(nextContent: string) {
    latestPageDraft.current.markdownDraft = nextContent;
    pageEditDirtyRef.current =
      nextContent !== pageEditBaseline.current.markdown;
    if (currentPage) {
      saveLocalPageDraft(space.key, currentPage.slug, {
        content: nextContent,
        content_format: formatForMode(editMode),
        edit_mode: editMode,
        base_updated_at: currentPage.updated_at,
      });
    }
    setMarkdownDraft(nextContent);
  }

  async function discardRecoveryDraft() {
    if (!currentPage) return;
    setDiscardDraftPending(true);
    try {
      await discardPageDraft(space.key, currentPage.slug);
      clearLocalPageDraft(space.key, currentPage.slug);
      setRecoveryDraft(null);
      setDiscardDraftOpen(false);
      toast.success(t("workspace.draftDiscarded"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("workspace.discardDraftError"),
      );
    } finally {
      setDiscardDraftPending(false);
    }
  }

  async function saveDraftNow(): Promise<boolean> {
    if (draftNowPending) return false;
    setDraftNowPending(true);
    try {
      const saved = await persistDraft();
      if (saved) toast.success(t("workspace.draftSaved"));
      else toast.error(t("workspace.draftSaveError"));
      return saved;
    } finally {
      setDraftNowPending(false);
    }
  }

  // Cancel dialog: keep the edits as a draft, then close the editor. A failed
  // save keeps the dialog open so nothing is lost.
  async function saveDraftAndCancel() {
    if (draftSaveTimer.current !== null) {
      window.clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = null;
    }
    if (draftDirty && !(await saveDraftNow())) return;
    setCancelEditPending(false);
    cancelEditing();
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset stored-draft tracking when editor mode or page changes
    setDraftSavedContent(null);
  }, [editing, currentPage?.slug]);

  function markAutoSaveStatus(status: "idle" | "saving" | "saved") {
    if (autoSaveResetTimer.current !== null) {
      window.clearTimeout(autoSaveResetTimer.current);
      autoSaveResetTimer.current = null;
    }
    setAutoSaveStatus(status);
    if (status === "saved") {
      autoSaveResetTimer.current = window.setTimeout(() => {
        setAutoSaveStatus("idle");
        autoSaveResetTimer.current = null;
      }, 1000);
    }
  }

  useEffect(() => {
    if (!editing || !autoSaveEnabled) return;

    const interval = window.setInterval(() => {
      if (!hasUnsavedChangesRef.current || autoSaveInFlight.current) return;
      markAutoSaveStatus("saving");
      void persistDraft().then((saved) => {
        markAutoSaveStatus(saved ? "saved" : "idle");
      });
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [autoSaveEnabled, editing]);

  useEffect(() => {
    if (!editing) return;

    const saveWithShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (matchesShortcut("page.reload", event)) {
        event.preventDefault();
        setReloadPending(true);
        return;
      }
      if (!matchesShortcut("page.save", event)) return;
      event.preventDefault();
      if (!hasUnsavedChanges || savePending || autoSaveInFlight.current) return;

      void persistPage();
    };

    window.addEventListener("keydown", saveWithShortcut);
    return () => window.removeEventListener("keydown", saveWithShortcut);
  }, [
    currentPage,
    draftContent,
    editMode,
    editing,
    hasUnsavedChanges,
    markdownDraft,
    savePending,
  ]);

  useEffect(() => {
    const handleWorkspaceShortcuts = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (!inInput && matchesShortcut("page.copyLink", event)) {
        if (currentPage) {
          event.preventDefault();
          void onShareCurrentPage();
        }
        return;
      }

      if (!inInput && !editing && matchesShortcut("page.edit", event)) {
        if (currentPage && canEdit && space.status === "active") {
          event.preventDefault();
          beginEditing(
            currentPage.content_format === "markdown"
              ? "markdown"
              : currentPage.content_format === "html"
                ? "html"
                : "normal",
          );
        }
        return;
      }
    };

    window.addEventListener("keydown", handleWorkspaceShortcuts);
    return () => window.removeEventListener("keydown", handleWorkspaceShortcuts);
  }, [canEdit, currentPage, editing, space.status]);

  useEffect(
    () => () => {
      if (autoSaveResetTimer.current !== null) {
        window.clearTimeout(autoSaveResetTimer.current);
      }
      if (draftSaveTimer.current !== null) {
        window.clearTimeout(draftSaveTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!editing || !pageEditDirty || !currentPage) return;
    // Any earlier timer was already cleared by this effect's cleanup below.
    draftSaveTimer.current = window.setTimeout(() => {
      void persistDraft();
      draftSaveTimer.current = null;
    }, 700);
    return () => {
      if (draftSaveTimer.current !== null) {
        window.clearTimeout(draftSaveTimer.current);
        draftSaveTimer.current = null;
      }
    };
  }, [
    currentPage,
    draftContent,
    editMode,
    editing,
    markdownDraft,
    pageEditDirty,
  ]);

  function openEditor(mode: EditMode) {
    if (!currentPage) return;
    const sourceFormat = currentPage.content_format;
    const markdown =
      sourceFormat === "markdown"
        ? prettyMarkdownEmbeddedHtml(currentPage.content)
        : htmlToMarkdown(currentPage.content);
    const html =
      sourceFormat === "markdown"
        ? markdownToHtml(currentPage.content)
        : currentPage.content;
    const nextHtml = mode === "html" ? prettyHtml(html) : html;
    setDraftContent(nextHtml);
    setMarkdownDraft(markdown);
    setTitleDraft(currentPage.title);
    latestPageDraft.current.draftContent = nextHtml;
    latestPageDraft.current.markdownDraft = markdown;
    latestPageDraft.current.titleDraft = currentPage.title;
    latestPageDraft.current.editMode = mode;
    pageEditDirtyRef.current = false;
    pageEditBaseline.current = {
      html: mode === "html" ? prettyHtml(html) : html,
      markdown,
      title: currentPage.title,
    };
    setAutoSaveEnabled(true);
    markAutoSaveStatus("idle");
    setEditMode(mode);
    setPreviewing(false);
    setEditing(true);
  }

  function beginEditing(mode: EditMode) {
    if (!currentPage) return;
    if (recoveryDraft) {
      openRecoveryDraft();
      return;
    }
    if (currentPage.content_format !== formatForMode(mode)) {
      setConversionMode(mode);
      return;
    }
    openEditor(mode);
  }

  function cancelEditing() {
    setEditing(false);
    setConversionMode(null);
    setDraftContent("");
    setMarkdownDraft("");
    setTitleDraft("");
    latestPageDraft.current.draftContent = "";
    latestPageDraft.current.markdownDraft = "";
    latestPageDraft.current.titleDraft = "";
    pageEditDirtyRef.current = false;
    setPreviewing(false);
  }

  function beginOverviewEditing() {
    setOverviewDraft(space.description);
    overviewEditBaseline.current = space.description;
    setOverviewEditing(true);
  }

  function cancelOverviewEditing() {
    setOverviewEditing(false);
    setOverviewDraft(space.description);
  }

  async function saveOverview() {
    setOverviewSavePending(true);
    try {
      await api.patch<Space>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}`,
        {
          description: overviewDraft,
        },
      );
      toast.success(t("workspace.overviewUpdated"));
      setOverviewEditing(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("workspace.overviewError"),
      );
    } finally {
      setOverviewSavePending(false);
    }
  }

  async function persistPage({
    closeEditor = false,
    announce = true,
    force = false,
  }: {
    closeEditor?: boolean;
    announce?: boolean;
    force?: boolean;
  } = {}) {
    const {
      currentPage: page,
      draftContent: htmlDraft,
      markdownDraft: markdownSource,
      titleDraft: nextTitle,
      editMode: mode,
    } = latestPageDraft.current;
    if (!page || autoSaveInFlight.current) return false;
    // An emptied-out title falls back to the page's current one rather than
    // failing the save outright - the title field enforces this visually
    // (see the `required` input below), but autosave can still fire mid-edit
    // with a title the user has not finished retyping.
    const title = nextTitle.trim() || page.title;

    autoSaveInFlight.current = true;
    setSavePending(true);
    try {
      const updated = await api.patch<WikiPage>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(page.slug)}`,
        {
          title,
          content: mode === "markdown" ? markdownSource : htmlDraft,
          content_format: formatForMode(mode),
          base_updated_at: page.updated_at,
          force,
        },
      );
      setConflictNotice(null);
      pageEditBaseline.current = {
        html: htmlDraft,
        markdown: markdownSource,
        title,
      };
      pageEditDirtyRef.current = false;
      clearLocalPageDraft(space.key, page.slug);
      setRecoveryDraft(null);
      if (announce) {
        toast.success(t("workspace.pageSaved", { title: updated.title }));
        // When the assistant is on, offer labels and related pages for what was
        // just saved - offered, not run: it costs a model call.
        void aiStatus().then((status) => {
          if (!status?.enabled) return;
          toast(t("ai.suggest.toast"), {
            action: {
              label: t("ai.suggest.toastAction"),
              onClick: onOpenLabelsDialog,
            },
          });
        });
      }
      if (closeEditor) {
        setEditing(false);
        setPreviewing(false);
        router.refresh();
      }
      return true;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code: string }).code === "page_conflict"
      ) {
        setOverwriteConfirmOpen(true);
        return false;
      }
      if (announce) {
        toast.error(
          error instanceof Error ? error.message : t("workspace.pageSaveError"),
        );
      }
      return false;
    } finally {
      setSavePending(false);
      autoSaveInFlight.current = false;
    }
  }

  async function savePage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persistPage({ closeEditor: true });
  }

  function dismissLeaveDialog() {
    setLeaveHref(null);
    setReloadPending(false);
    setCancelEditPending(false);
  }

  return {
    editing,
    editMode,
    conversionMode,
    setConversionMode,
    previewing,
    setPreviewing,
    previewSplit,
    setPreviewSplit,
    previewLayout,
    setPreviewLayout,
    draftContent,
    markdownDraft,
    titleDraft,
    savePending,
    autoSaveEnabled,
    setAutoSaveEnabled,
    draftNowPending,
    autoSaveStatus,
    markAutoSaveStatus,
    recoveryDraft,
    discardDraftOpen,
    setDiscardDraftOpen,
    discardDraftPending,
    conflictNotice,
    setConflictNotice,
    overwriteConfirmOpen,
    setOverwriteConfirmOpen,
    leaveHref,
    reloadPending,
    cancelEditPending,
    dismissLeaveDialog,
    overviewEditing,
    overviewDraft,
    setOverviewDraft,
    overviewSavePending,
    pageEditDirty,
    draftDirty,
    navigateTo,
    leaveWithoutSaving,
    saveBeforeLeave,
    requestCancelEditing,
    persistDraft,
    openRecoveryDraft,
    updateTitleDraft,
    updateDraftContent,
    uploadPageAttachment,
    updateMarkdownDraft,
    discardRecoveryDraft,
    saveDraftNow,
    saveDraftAndCancel,
    openEditor,
    beginEditing,
    beginOverviewEditing,
    cancelOverviewEditing,
    saveOverview,
    persistPage,
    savePage,
  };
}
