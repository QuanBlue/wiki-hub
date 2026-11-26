"use client";

import { Pencil, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { toast } from "sonner";

import { MailboxPasswordBanner } from "@/components/layout/mailbox-password-banner";
import { useSidebar } from "@/components/layout/sidebar-context";
import { SystemAnnouncementBanner } from "@/components/layout/system-announcement-banner";
import { PageContentLoading } from "@/components/pages/page-content-loading";
import { usePageRelated } from "@/components/pages/related-pages";
import { RichTextEditor } from "@/components/pages/rich-text-editor";
import { Button } from "@/components/ui/button";
import { api, describeApiError } from "@/lib/api-client";
import { downloadFile } from "@/lib/download";
import { apiBaseUrl } from "@/lib/env";
import { getFontFamilyCss } from "@/lib/font-presets";
import { findHomePage } from "@/lib/home-page";
import { useTranslation } from "@/lib/i18n/context";
import { formatDate } from "@/lib/i18n/format";
import { matchesShortcut } from "@/lib/keyboard-shortcuts";
import { PRESENT_OPEN_EVENT } from "@/lib/page-presentation";
import { TRASH_OPEN_EVENT } from "@/lib/space-trash";
import { usePagePresence } from "@/lib/use-page-presence";
import { cn } from "@/lib/utils";
import type {
  InstanceInfo,
  PageLabel,
  PageRestoreResult,
  PageTrashResult,
  ShareSummary,
  WikiPage,
} from "@/types/api";
import {
  navigationTargetOf,
  pageAccessOf,
  pageHref,
} from "./workspace/content-transforms";
import { PageEditorPane } from "./workspace/page-editor-pane";
import { PageReaderPane } from "./workspace/page-reader-pane";
import {
  EMPTY_SAVED_PAGE_KEYS,
  getSavedPageKeys,
  savePageKeys,
  spaceSidebarWidthStore,
  subscribeToSavedPages,
} from "./workspace/stores";
import {
  DEFAULT_SIDEBAR_WIDTH,
  SPACE_SIDEBAR_SCROLL_PREFIX,
  type AudienceSummary,
  type PageLikeStatus,
  type SpaceWorkspaceProps,
} from "./workspace/types";
import { usePageEditor } from "./workspace/use-page-editor";
import { WorkspaceDialogs } from "./workspace/workspace-dialogs";
import { WorkspaceHeader } from "./workspace/workspace-header";
import { WorkspaceSidebar } from "./workspace/workspace-sidebar";

export { navigationTargetOf };

export function SpaceWorkspace({
  space,
  pages,
  members,
  groups,
  currentPage,
  initialSidebarWidth = DEFAULT_SIDEBAR_WIDTH,
  canEdit,
  canExport,
  canManageRestrictions,
  isSystemAdmin = false,
  currentUser,
}: SpaceWorkspaceProps) {
  const router = useRouter();
  const spaceSidebarScrollRef = useRef<HTMLDivElement>(null);
  const { t, locale } = useTranslation();
  const { collapsed, setCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const sidebarWidth = useSyncExternalStore(
    spaceSidebarWidthStore.subscribe,
    spaceSidebarWidthStore.getSnapshot,
    () => initialSidebarWidth,
  );
  const [dragging, setDragging] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [attachmentsDialogOpen, setAttachmentsDialogOpen] = useState(false);
  const [labelsDialogOpen, setLabelsDialogOpen] = useState(false);
  const [pageLabels, setPageLabels] = useState<PageLabel[]>([]);
  const [favorite, setFavorite] = useState(space.is_favorite);
  const [favoritePending, setFavoritePending] = useState(false);

  const currentPageAccess = useMemo(
    () => pageAccessOf(currentPage, space.visibility),
    [currentPage, space.visibility],
  );
  const [viewFullWidth, setViewFullWidth] = useState(true);

  // Who can actually read what is on screen - the page after its own and
  // inherited restrictions, or the space - rather than the old explicit
  // member list, which an Open space (everyone has access) left at 1.
  const [audience, setAudience] = useState<AudienceSummary | null>(null);
  const audienceUrl = currentPage
    ? `/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(currentPage.slug)}/audience`
    : `/api/v1/spaces/${encodeURIComponent(space.key)}/audience`;
  const audienceKey = `${audienceUrl}|${currentPage?.is_restricted ?? ""}|${currentPage?.own_restricted ?? ""}|${currentPage?.inherit_restrictions ?? ""}`;
  useEffect(() => {
    let active = true;
    api
      .get<AudienceSummary>(audienceUrl)
      .then((next) => {
        if (active) setAudience(next);
      })
      .catch(() => {
        if (active) setAudience(null);
      });
    return () => {
      active = false;
    };
    // Re-count when the page or its access settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey]);

  // Where `PageComments` portals its composer - see the sticky slot at the
  // end of the article.
  const [composerSlot, setComposerSlot] = useState<HTMLDivElement | null>(null);
  // Publish the pinned comment box's height so fixed controls (the
  // scroll-to-top button) can sit above it instead of on top of it.
  useEffect(() => {
    if (!composerSlot) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty("--wh-bottom-dock", `${composerSlot.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(composerSlot);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--wh-bottom-dock");
    };
  }, [composerSlot]);

  const [likeStatus, setLikeStatus] = useState<PageLikeStatus>({
    liked_by_me: false,
    like_count: 0,
  });
  const [likePending, setLikePending] = useState(false);
  const [shareCount, setShareCount] = useState(0);
  const [presentOpen, setPresentOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [publicShareDialogOpen, setPublicShareDialogOpen] = useState(false);
  const [publicSharesEnabled, setPublicSharesEnabled] = useState(true);
  const [trashDays, setTrashDays] = useState(30);

  useEffect(() => {
    let active = true;
    void api
      .get<InstanceInfo>("/api/v1/meta")
      .then((meta) => {
        if (active) {
          if (typeof meta.public_shares_enabled === "boolean") {
            setPublicSharesEnabled(meta.public_shares_enabled);
          }
          if (meta.trash_retention_days) {
            setTrashDays(meta.trash_retention_days);
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const [pinned, setPinned] = useState(false);
  const [pinPending, setPinPending] = useState(false);
  const savedPageKeys = useSyncExternalStore(
    subscribeToSavedPages,
    getSavedPageKeys,
    () => EMPTY_SAVED_PAGE_KEYS,
  );
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [deletePageOpen, setDeletePageOpen] = useState(false);
  const [deletePagePending, setDeletePagePending] = useState(false);
  const [movePageOpen, setMovePageOpen] = useState(false);
  const [pageAccessOpen, setPageAccessOpen] = useState(false);
  const [editSpaceModalOpen, setEditSpaceModalOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);

  async function shareCurrentPage() {
    const url = window.location.href;
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          copied = true;
        } catch {
          // Fall back for browsers that expose Clipboard but deny permission.
        }
      }
      if (!copied) {
        const field = document.createElement("textarea");
        field.value = url;
        field.setAttribute("readonly", "");
        field.className = "sr-only";
        document.body.appendChild(field);
        field.select();
        copied = document.execCommand("copy");
        document.body.removeChild(field);
        if (!copied) throw new Error(t("workspace.clipboardUnavailable"));
      }
      toast.success(t("workspace.linkCopied"));
    } catch {
      toast.error(t("workspace.linkCopyError"));
    }
  }

  const editor = usePageEditor({
    space,
    currentPage,
    canEdit,
    onShareCurrentPage: shareCurrentPage,
    onOpenLabelsDialog: () => setLabelsDialogOpen(true),
  });

  const { activeUsers } = usePagePresence({
    spaceKey: space.key,
    pageSlug: currentPage?.slug,
    editing: editor.editing,
    currentUserId: currentUser?.id,
    onPageSaved: (savedEvent) => {
      if (editor.editing) {
        editor.setConflictNotice(savedEvent);
      }
    },
  });

  const otherEditors = useMemo(
    () => activeUsers.filter((u) => u.state === "editing"),
    [activeUsers],
  );

  // ":trash" in the search box opens this space's Trash from wherever the person is.
  useEffect(() => {
    const open = (event: Event) => {
      const key = (event as CustomEvent<{ spaceKey?: string }>).detail?.spaceKey;
      if (key && key.toLowerCase() === space.key.toLowerCase()) setTrashOpen(true);
    };
    window.addEventListener(TRASH_OPEN_EVENT, open);
    return () => window.removeEventListener(TRASH_OPEN_EVENT, open);
  }, [space.key]);

  // ":present" in the search box or the rebindable "page.present" shortcut starts presentation mode.
  useEffect(() => {
    const openPresent = () => {
      if (!editor.editing && !editor.overviewEditing) {
        setPresentOpen(true);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || editor.editing || editor.overviewEditing) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (matchesShortcut("page.present", event)) {
        event.preventDefault();
        setPresentOpen(true);
      }
    };
    window.addEventListener(PRESENT_OPEN_EVENT, openPresent);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(PRESENT_OPEN_EVENT, openPresent);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editor.editing, editor.overviewEditing]);

  // "Edit space" (this button, and the modal it opens) is full space
  // administration - visibility, member permissions, archiving, deletion -
  // not to be confused with `canManageRestrictions`, which only covers
  // per-page view/edit restrictions and is gated on the narrower
  // "restrictions" permission alone. The backend's own effective-permission
  // computation already gives a superuser "admin" here directly (see
  // `PermissionService.effective_permissions`), so this needs no separate
  // superuser bypass of its own.
  const canAdmin =
    space.my_role === "admin" || space.my_permissions?.includes("admin") === true;
  const canManageTemplates = Boolean(isSystemAdmin || space.is_owner || canAdmin);
  // Whoever may delete pages here (all of them, or only their own) has a Trash to look in.
  const canUseTrash =
    canAdmin ||
    space.my_permissions?.some((p) => p === "delete" || p === "delete_own") === true;

  const [showHeader, setShowHeader] = useState(true);
  const [isSticky, setIsSticky] = useState(false);
  const lastScrollY = useRef(0);
  const mainContainerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const container = mainContainerRef.current;

    const handleScroll = (e: Event) => {
      // Listened to on the window and on the main column (which scrolls on
      // desktop) - read whichever one this event came from.
      const target = e.currentTarget;
      const currentScrollY =
        target instanceof HTMLElement ? target.scrollTop : window.scrollY;

      // Hysteresis logic: sticky when scrolled down past 200px, relative when near top (<= 5px)
      if (currentScrollY > 200) {
        setIsSticky(true);
      } else if (currentScrollY <= 5) {
        setIsSticky(false);
      }

      if (currentScrollY <= 5) {
        setShowHeader(true);
      } else {
        const diff = currentScrollY - lastScrollY.current;
        // Only trigger show/hide on significant scroll movement (> 10px) to prevent sub-pixel trackpad/mouse jitter
        if (Math.abs(diff) > 10) {
          const isScrollingUp = diff < 0;
          setShowHeader(isScrollingUp);
        }
      }

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true });
    }

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (container) {
        container.removeEventListener("scroll", handleScroll);
      }
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset sticky reader chrome when the active page changes
    setShowHeader(true);
    setIsSticky(false);
    lastScrollY.current = 0;
  }, [currentPage?.slug]);

  // Page routes remount this workspace as the selected slug changes. Keep the
  // reader's place in a long page tree rather than resetting it to the top on
  // every page navigation. sessionStorage keeps this scoped to the current tab
  // and does not retain a stale position across unrelated browsing sessions.
  useLayoutEffect(() => {
    const sidebar = spaceSidebarScrollRef.current;
    if (!sidebar) return;
    const storageKey = `${SPACE_SIDEBAR_SCROLL_PREFIX}${space.key}`;
    const savedOffset = Number.parseFloat(
      window.sessionStorage.getItem(storageKey) ?? "0",
    );
    if (Number.isFinite(savedOffset) && savedOffset > 0) {
      sidebar.scrollTop = savedOffset;
    }

    const saveOffset = () => {
      window.sessionStorage.setItem(storageKey, String(sidebar.scrollTop));
    };
    sidebar.addEventListener("scroll", saveOffset, { passive: true });
    return () => {
      saveOffset();
      sidebar.removeEventListener("scroll", saveOffset);
    };
  }, [space.key]);

  const title = currentPage?.title ?? space.name;
  const homePage = findHomePage(pages, space.key, space.name);
  const isHomePage = currentPage?.id === homePage?.id;
  const homeHref = homePage
    ? pageHref(space.key, homePage.slug)
    : `/spaces/${encodeURIComponent(space.key)}`;
  const body = currentPage?.content || space.description;
  // Pages tied to this one, for the Related pages list under it. The page itself
  // is shown exactly as written: words that merely name another page are not
  // turned into links (they appeared as links the editor could not show or remove).
  const related = usePageRelated(space.key, currentPage?.slug);
  const activeSlug = currentPage?.slug ?? null;
  const savedPageKey = currentPage ? `${space.key}/${currentPage.slug}` : null;
  const savedForLater = savedPageKey
    ? savedPageKeys.includes(savedPageKey)
    : false;
  const liked = likeStatus.liked_by_me;

  // A page without archived author metadata must remain unknown. Falling back
  // to the space creator made restored legacy pages appear to have been
  // created and updated by the administrator who owns that space.
  const author = currentPage ? currentPage.created_by_username : space.created_by_username;
  const updatedBy = currentPage ? currentPage.updated_by_username : space.created_by_username;
  const updatedAt = currentPage?.updated_at ?? space.updated_at;

  const breadcrumbPages = useMemo(() => {
    if (!currentPage) return [];

    const pagesById = new Map(pages.map((page) => [page.id, page]));
    const ancestors: WikiPage[] = [];
    const visited = new Set<string>([currentPage.id]);
    let parentId = currentPage.parent_id;

    while (parentId && !visited.has(parentId)) {
      const parent = pagesById.get(parentId);
      if (!parent) break;
      ancestors.unshift(parent);
      visited.add(parent.id);
      parentId = parent.parent_id;
    }

    return [...ancestors, currentPage];
  }, [currentPage, pages]);

  const compactBreadcrumbPages = useMemo<(WikiPage | null)[]>(() => {
    // Keep the immediate context around the current page while avoiding an
    // ever-growing path in deeply nested imported documentation.
    if (breadcrumbPages.length <= 3) return breadcrumbPages;
    return [null, ...breadcrumbPages.slice(-2)];
  }, [breadcrumbPages]);

  async function toggleFavorite() {
    const next = !favorite;
    setFavorite(next);
    setFavoritePending(true);
    try {
      const path = `/api/v1/spaces/${encodeURIComponent(space.key)}/favorite`;
      if (next) {
        await api.put<void>(path);
      } else {
        await api.delete<void>(path);
      }
      router.refresh();
    } catch {
      setFavorite(!next);
      toast.error(t("spaces.favouriteError"));
    } finally {
      setFavoritePending(false);
    }
  }

  function toggleSavedForLater() {
    if (!savedPageKey) return;

    const nextKeys = savedForLater
      ? savedPageKeys.filter((key) => key !== savedPageKey)
      : [...savedPageKeys, savedPageKey];
    savePageKeys(nextKeys);
    toast.success(
      savedForLater
        ? t("workspace.removedFromSaved")
        : t("workspace.savedForLaterToast"),
    );
  }

  async function toggleLiked() {
    if (!currentPage) return;
    setLikePending(true);
    try {
      const action = liked
        ? api.delete<PageLikeStatus>
        : api.put<PageLikeStatus>;
      const next = await action(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(currentPage.slug)}/like`,
      );
      setLikeStatus(next);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspace.likeError"),
      );
    } finally {
      setLikePending(false);
    }
  }

  async function togglePinned() {
    if (!currentPage) return;
    setPinPending(true);
    try {
      if (pinned) {
        await api.delete(`/api/v1/users/me/pins/${encodeURIComponent(currentPage.id)}`);
      } else {
        await api.post(`/api/v1/users/me/pins/${encodeURIComponent(currentPage.id)}`);
      }
      setPinned((value) => !value);
      toast.success(
        pinned ? t("workspace.unpinnedToast") : t("workspace.pinnedToast"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspace.pinError"),
      );
    } finally {
      setPinPending(false);
    }
  }

  useEffect(() => {
    if (!currentPage) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while the next page's count loads
    setShareCount(0);
    void api
      .get<ShareSummary>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(currentPage.slug)}/shares`,
      )
      .then((summary) => {
        if (active) setShareCount(summary.share_count);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [currentPage, space.key]);

  useEffect(() => {
    if (!currentPage) return;
    let active = true;
    void api
      .get<PageLikeStatus>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(currentPage.slug)}/like`,
      )
      .then((next) => {
        if (active) setLikeStatus(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [currentPage, space.key]);

  useEffect(() => {
    if (!currentPage) return;
    let active = true;
    void api
      .get<Array<{ id: string }>>("/api/v1/users/me/pins")
      .then((pins) => {
        if (active) setPinned(pins.some((pin) => pin.id === currentPage.id));
      })
      .catch(() => {
        if (active) setPinned(false);
      });
    return () => {
      active = false;
    };
  }, [currentPage]);

  // The backend renders the real page in a headless browser, which takes a
  // few seconds. Fetch it behind a loading toast so the user sees it is
  // working, and gets the server's reason if it fails, instead of a silent
  // wait followed by the browser's own "Site wasn't available".
  async function exportPage(format: "pdf" | "html" | "docx") {
    if (!currentPage) return;
    const label = format.toUpperCase();
    const toastId = toast.loading(t("workspace.exportPreparing", { format: label }));
    try {
      await downloadFile(
        `${apiBaseUrl()}/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(currentPage.slug)}/export/${format}`,
        `${currentPage.slug || "page"}.${format}`,
      );
      toast.success(t("workspace.exportReady", { format: label }), { id: toastId });
    } catch (err) {
      toast.error(
        describeApiError(err, t("workspace.exportError", { format: label })),
        { id: toastId },
      );
    }
  }

  useEffect(() => {
    if (!deletePageOpen) return;
    let active = true;
    void api
      .get<InstanceInfo>("/api/v1/meta")
      .then((meta) => {
        if (active && meta.trash_retention_days) setTrashDays(meta.trash_retention_days);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [deletePageOpen]);

  async function deletePage() {
    if (!currentPage) return;

    setDeletePagePending(true);
    try {
      const spacePath = `/api/v1/spaces/${encodeURIComponent(space.key)}`;
      const trashed = await api.delete<PageTrashResult>(
        `${spacePath}/pages/${encodeURIComponent(currentPage.slug)}`,
      );
      toast.success(t("workspace.pageDeleted", { title: currentPage.title }), {
        action: {
          label: t("workspace.undoDelete"),
          onClick: () => {
            void api
              .post<PageRestoreResult>(`${spacePath}/trash/${encodeURIComponent(trashed.id)}/restore`)
              .then((restored) => {
                toast.success(t("trash.restored", { title: restored.title }));
                router.push(
                  `/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(restored.slug)}`,
                );
                router.refresh();
              })
              .catch(() => toast.error(t("trash.restoreError")));
          },
        },
      });
      setDeletePageOpen(false);
      router.push(`/spaces/${encodeURIComponent(space.key)}`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspace.pageDeleteError"),
      );
    } finally {
      setDeletePagePending(false);
    }
  }

  useEffect(() => {
    if (!dragging) return;

    const onPointerMove = (event: PointerEvent) => {
      spaceSidebarWidthStore.set(event.clientX);
      setCollapsed(false);
    };
    const onPointerUp = () => {
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dragging, setCollapsed]);

  // On a phone the page tree is a drawer over the page, closed until the top bar's toggle
  // opens it; it closes again on choosing a page, on Escape, or on a tap outside. From
  // `md` up it is the rail beside the page, collapsed or not as saved.
  const showPanel = !collapsed || mobileOpen;
  const desktopSidebarWidth = collapsed ? 0 : sidebarWidth;
  const currentSlug = currentPage?.slug;
  useEffect(() => {
    setMobileOpen(false);
  }, [currentSlug, setMobileOpen]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, setMobileOpen]);

  return (
    <div className="bg-background min-h-[calc(100vh-var(--wh-topbar-height)-var(--wh-banner-height,0px))] max-w-full min-w-0 overflow-x-hidden md:flex md:h-[calc(100vh-var(--wh-topbar-height)-var(--wh-banner-height,0px))] md:overflow-hidden">
      <WorkspaceSidebar
        space={space}
        pages={pages}
        homeHref={homeHref}
        activeSlug={activeSlug}
        canEdit={canEdit}
        canAdmin={canAdmin}
        canUseTrash={canUseTrash}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        dragging={dragging}
        setDragging={setDragging}
        sidebarWidth={sidebarWidth}
        desktopSidebarWidth={desktopSidebarWidth}
        showPanel={showPanel}
        favorite={favorite}
        favoritePending={favoritePending}
        toggleFavorite={toggleFavorite}
        spaceSidebarScrollRef={spaceSidebarScrollRef}
        onOpenImportDialog={() => setImportDialogOpen(true)}
        onOpenMap={() => setMapOpen(true)}
        onOpenHealth={() => setHealthOpen(true)}
        onOpenTemplates={canManageTemplates ? () => setTemplatesOpen(true) : undefined}
        onOpenEditSpace={() => setEditSpaceModalOpen(true)}
        onOpenTrash={() => setTrashOpen(true)}
      />

      <main
        ref={mainContainerRef}
        className="max-w-full min-w-0 flex-1 overflow-x-hidden md:h-full md:overflow-y-auto md:overscroll-contain"
        style={
          space.font_family &&
          space.font_family !== "inherit" &&
          space.font_family !== "default"
            ? ({
                "--wh-space-page-font": getFontFamilyCss(space.font_family),
              } as CSSProperties)
            : undefined
        }
      >
        <PageContentLoading />
        <SystemAnnouncementBanner />
        <MailboxPasswordBanner />
        <div
          className={cn(
            "mx-auto max-w-full min-w-0 px-6 pb-5 sm:px-8 lg:px-10",
            editor.editing || viewFullWidth ? "max-w-none" : "max-w-6xl",
          )}
        >
          <WorkspaceHeader
            space={space}
            currentPage={currentPage}
            homeHref={homeHref}
            isHomePage={isHomePage}
            compactBreadcrumbPages={compactBreadcrumbPages}
            currentPageAccess={currentPageAccess}
            isSticky={isSticky}
            showHeader={showHeader}
            canEdit={canEdit}
            canExport={canExport}
            canManageRestrictions={canManageRestrictions}
            canManageTemplates={canManageTemplates}
            publicSharesEnabled={publicSharesEnabled}
            overviewEditing={editor.overviewEditing}
            overviewSavePending={editor.overviewSavePending}
            saveOverview={editor.saveOverview}
            cancelOverviewEditing={editor.cancelOverviewEditing}
            beginOverviewEditing={editor.beginOverviewEditing}
            editing={editor.editing}
            previewing={editor.previewing}
            setPreviewing={editor.setPreviewing}
            autoSaveEnabled={editor.autoSaveEnabled}
            setAutoSaveEnabled={editor.setAutoSaveEnabled}
            autoSaveStatus={editor.autoSaveStatus}
            markAutoSaveStatus={editor.markAutoSaveStatus}
            savePending={editor.savePending}
            draftNowPending={editor.draftNowPending}
            draftDirty={editor.draftDirty}
            pageEditDirty={editor.pageEditDirty}
            saveDraftNow={editor.saveDraftNow}
            requestCancelEditing={editor.requestCancelEditing}
            beginEditing={editor.beginEditing}
            savedForLater={savedForLater}
            toggleSavedForLater={toggleSavedForLater}
            pinned={pinned}
            pinPending={pinPending}
            togglePinned={togglePinned}
            shareCurrentPage={shareCurrentPage}
            exportPage={exportPage}
            viewFullWidth={viewFullWidth}
            setViewFullWidth={setViewFullWidth}
            related={related}
            onOpenPresent={() => setPresentOpen(true)}
            onOpenSummary={() => setSummaryOpen(true)}
            onOpenShareDialog={() => setShareDialogOpen(true)}
            onOpenPublicShareDialog={() => setPublicShareDialogOpen(true)}
            onOpenMovePage={() => setMovePageOpen(true)}
            onOpenHistoryModal={() => setHistoryModalOpen(true)}
            onOpenPageAccess={() => setPageAccessOpen(true)}
            onOpenLabelsDialog={() => setLabelsDialogOpen(true)}
            onOpenRelated={() => setRelatedOpen(true)}
            onOpenAttachmentsDialog={() => setAttachmentsDialogOpen(true)}
            onOpenSaveAsTemplate={() => setSaveAsTemplateOpen(true)}
            onOpenDeletePage={() => setDeletePageOpen(true)}
          />

          {editor.recoveryDraft && !editor.editing && !editor.overviewEditing ? (
            <div className="border-warning/30 bg-warning-bg text-warning mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t("workspace.draftNotReleased")}</p>
                <p className="mt-0.5 text-xs">
                  {t("workspace.draftNotReleasedHint", {
                    date: formatDate(editor.recoveryDraft.updated_at, locale),
                  })}
                  {editor.recoveryDraft.is_conflict
                    ? t("workspace.draftConflictSuffix")
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={editor.openRecoveryDraft}
                >
                  <Pencil />
                  {t("workspace.openEditor")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => editor.setDiscardDraftOpen(true)}
                  disabled={editor.discardDraftPending}
                >
                  {t("workspace.discardDraft")}
                </Button>
              </div>
            </div>
          ) : null}

          <article
            className={cn(
              "mt-4 wikihub-page-content",
              !editor.editing &&
                !editor.overviewEditing &&
                !viewFullWidth &&
                "max-w-[var(--wh-content-max)]",
            )}
          >
            {editor.overviewEditing ? (
              <>
                <h1 className="text-foreground text-3xl font-semibold tracking-normal wikihub-page-header">
                  {space.name}
                </h1>
                <div className="mt-6 min-w-0">
                  <RichTextEditor
                    content={editor.overviewDraft}
                    onChange={editor.setOverviewDraft}
                  />
                  <p className="text-muted-foreground mt-2 text-xs">
                    {t("workspace.charactersCount", {
                      count: editor.overviewDraft.length.toLocaleString(),
                    })}
                  </p>
                </div>
              </>
            ) : editor.editing && currentPage ? (
              <PageEditorPane
                space={space}
                currentPage={currentPage}
                editMode={editor.editMode}
                titleDraft={editor.titleDraft}
                draftContent={editor.draftContent}
                markdownDraft={editor.markdownDraft}
                previewing={editor.previewing}
                previewSplit={editor.previewSplit}
                setPreviewSplit={editor.setPreviewSplit}
                previewLayout={editor.previewLayout}
                setPreviewLayout={editor.setPreviewLayout}
                conflictNotice={editor.conflictNotice}
                activeUsers={activeUsers}
                otherEditors={otherEditors}
                onSubmit={editor.savePage}
                onUpdateTitleDraft={editor.updateTitleDraft}
                onUpdateDraftContent={editor.updateDraftContent}
                onUpdateMarkdownDraft={editor.updateMarkdownDraft}
                onUploadFile={editor.uploadPageAttachment}
                onSubpageCreated={(page) =>
                  // Same "save what's here, then go" sequence this
                  // file already uses for every other in-app
                  // navigation away from an editing page (see
                  // navigateTo's other callers) - the link just
                  // inserted above needs to be part of what's saved.
                  void editor.persistDraft().finally(() =>
                    editor.navigateTo(
                      new URL(
                        pageHref(space.key, page.slug),
                        window.location.href,
                      ),
                    ),
                  )
                }
                onOpenHistoryModal={() => setHistoryModalOpen(true)}
                onOpenOverwriteConfirm={() => editor.setOverwriteConfirmOpen(true)}
              />
            ) : (
              <PageReaderPane
                space={space}
                currentPage={currentPage}
                currentUser={currentUser}
                title={title}
                body={body}
                author={author}
                updatedBy={updatedBy}
                updatedAt={updatedAt}
                canEdit={canEdit}
                activeUsers={activeUsers}
                pageLabels={pageLabels}
                likeStatus={likeStatus}
                likePending={likePending}
                shareCount={shareCount}
                composerSlot={composerSlot}
                setComposerSlot={setComposerSlot}
                onToggleLiked={toggleLiked}
                onOpenLabelsDialog={() => setLabelsDialogOpen(true)}
                onOpenShareDialog={() => setShareDialogOpen(true)}
              />
            )}
          </article>

          <WorkspaceDialogs
            space={space}
            pages={pages}
            members={members}
            groups={groups}
            currentPage={currentPage}
            canAdmin={canAdmin}
            canManageRestrictions={canManageRestrictions}
            canManageTemplates={canManageTemplates}
            isSystemAdmin={isSystemAdmin}
            related={related}
            leaveHref={editor.leaveHref}
            reloadPending={editor.reloadPending}
            cancelEditPending={editor.cancelEditPending}
            pageEditDirty={editor.pageEditDirty}
            savePending={editor.savePending}
            draftNowPending={editor.draftNowPending}
            onDismissLeaveDialog={editor.dismissLeaveDialog}
            onLeaveWithoutSaving={editor.leaveWithoutSaving}
            onSaveDraftAndCancel={editor.saveDraftAndCancel}
            onSaveBeforeLeave={editor.saveBeforeLeave}
            conversionMode={editor.conversionMode}
            onDismissConversion={() => editor.setConversionMode(null)}
            onConfirmConversion={(mode) => {
              editor.setConversionMode(null);
              editor.openEditor(mode);
            }}
            discardDraftOpen={editor.discardDraftOpen}
            setDiscardDraftOpen={editor.setDiscardDraftOpen}
            discardDraftPending={editor.discardDraftPending}
            onDiscardRecoveryDraft={editor.discardRecoveryDraft}
            overwriteConfirmOpen={editor.overwriteConfirmOpen}
            setOverwriteConfirmOpen={editor.setOverwriteConfirmOpen}
            onConfirmOverwrite={() => {
              editor.setOverwriteConfirmOpen(false);
              void editor.persistPage({ closeEditor: true, force: true });
            }}
            movePageOpen={movePageOpen}
            setMovePageOpen={setMovePageOpen}
            pageAccessOpen={pageAccessOpen}
            setPageAccessOpen={setPageAccessOpen}
            presentOpen={presentOpen}
            setPresentOpen={setPresentOpen}
            pageLabels={pageLabels}
            summaryOpen={summaryOpen}
            setSummaryOpen={setSummaryOpen}
            shareDialogOpen={shareDialogOpen}
            setShareDialogOpen={setShareDialogOpen}
            onCopyLink={shareCurrentPage}
            onShared={setShareCount}
            publicShareDialogOpen={publicShareDialogOpen}
            setPublicShareDialogOpen={setPublicShareDialogOpen}
            historyModalOpen={historyModalOpen}
            setHistoryModalOpen={setHistoryModalOpen}
            onRefresh={() => router.refresh()}
            editSpaceModalOpen={editSpaceModalOpen}
            setEditSpaceModalOpen={setEditSpaceModalOpen}
            trashOpen={trashOpen}
            setTrashOpen={setTrashOpen}
            mapOpen={mapOpen}
            setMapOpen={setMapOpen}
            healthOpen={healthOpen}
            setHealthOpen={setHealthOpen}
            templatesOpen={templatesOpen}
            setTemplatesOpen={setTemplatesOpen}
            saveAsTemplateOpen={saveAsTemplateOpen}
            setSaveAsTemplateOpen={setSaveAsTemplateOpen}
            relatedOpen={relatedOpen}
            setRelatedOpen={setRelatedOpen}
            importDialogOpen={importDialogOpen}
            setImportDialogOpen={setImportDialogOpen}
            attachmentsDialogOpen={attachmentsDialogOpen}
            setAttachmentsDialogOpen={setAttachmentsDialogOpen}
            labelsDialogOpen={labelsDialogOpen}
            setLabelsDialogOpen={setLabelsDialogOpen}
            onPageLabelsChange={setPageLabels}
            deletePageOpen={deletePageOpen}
            setDeletePageOpen={setDeletePageOpen}
            trashDays={trashDays}
            deletePagePending={deletePagePending}
            onDeletePage={deletePage}
          />

          {audience ? (
            // Right under the pinned comment box when there is one (which
            // already draws the rule above it), spaced off the content otherwise.
            <div className={cn(composerSlot ? "pt-1" : "border-border mt-12 border-t pt-4")}>
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Users className="size-3.5" aria-hidden />
                {audience.everyone
                  ? t(currentPage ? "workspace.audiencePageEveryone" : "workspace.audienceSpaceEveryone")
                  : t(currentPage ? "workspace.audiencePage" : "workspace.audienceSpace", {
                      users: t(audience.users === 1 ? "workspace.audienceUsersOne" : "workspace.audienceUsersMany", {
                        count: audience.users,
                      }),
                      groups: t(audience.groups === 1 ? "workspace.audienceGroupsOne" : "workspace.audienceGroupsMany", {
                        count: audience.groups,
                      }),
                    })}
              </p>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
