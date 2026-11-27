"use client";

import { Plus, Share2, Tag, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { LikersPopover } from "@/components/comments/likers-popover";
import { PageComments, type CommentsUser } from "@/components/comments/page-comments";
import { PagePresence } from "@/components/pages/page-presence";
import { PagePropertiesInfoButton } from "@/components/pages/page-properties-bar";
import { RichTextContent } from "@/components/pages/rich-text-editor";
import { SelectionAssistant } from "@/components/pages/selection-assistant";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  PageLabel,
  PresenceUser,
  Space,
  SpaceMember,
  WikiPage,
} from "@/types/api";
import { formatDateAndTime } from "./content-transforms";
import type { PageLikeStatus } from "./types";
import { MarkdownContent } from "./workspace-primitives";

export type PageReaderPaneProps = {
  space: Space;
  members: SpaceMember[];
  currentPage?: WikiPage | null;
  currentUser?: CommentsUser;
  title: string;
  body: string;
  author: string | null | undefined;
  updatedBy: string | null | undefined;
  updatedAt: string | null | undefined;
  canEdit: boolean;
  activeUsers: PresenceUser[];
  pageLabels: PageLabel[];
  likeStatus: PageLikeStatus;
  likePending: boolean;
  shareCount: number;
  composerSlot: HTMLDivElement | null;
  setComposerSlot: (slot: HTMLDivElement | null) => void;
  onToggleLiked: () => Promise<void>;
  onOpenLabelsDialog: () => void;
  onOpenShareDialog: () => void;
  onPagePropertiesUpdated?: (updated: WikiPage) => void;
};

export function PageReaderPane({
  space,
  members,
  currentPage,
  currentUser,
  title,
  body,
  author,
  updatedBy,
  updatedAt,
  canEdit,
  activeUsers,
  pageLabels,
  likeStatus,
  likePending,
  shareCount,
  composerSlot,
  setComposerSlot,
  onToggleLiked,
  onOpenLabelsDialog,
  onOpenShareDialog,
  onPagePropertiesUpdated,
}: PageReaderPaneProps) {
  const { t, locale } = useTranslation();
  const liked = likeStatus.liked_by_me;
  const [propertiesOpen, setPropertiesOpen] = useState(false);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h1 className="text-foreground text-3xl font-semibold tracking-normal wikihub-page-header">
            {title}
          </h1>
          {currentPage ? (
            <PagePropertiesInfoButton
              spaceKey={space.key}
              page={currentPage}
              members={members}
              canEdit={canEdit && space.status === "active"}
              onUpdated={onPagePropertiesUpdated}
              open={propertiesOpen}
              onOpenChange={setPropertiesOpen}
              align="start"
            />
          ) : null}
        </div>
        {currentPage ? (
          <PagePresence users={activeUsers} className="shrink-0 pt-1" />
        ) : null}
      </div>
      {/* Metadata on the left, labels on the right of the same line
          (wrapping below it on narrow screens). The page's Like
          lives with the discussion, beside the comment count - see
          `PageComments`' header. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <p className="flex flex-wrap items-center gap-1">
          {t("workspace.createdByPrefix")}{" "}
          {author ? (
            <UserProfileTrigger username={author} />
          ) : (
            t("workspace.unknownAuthor")
          )}
          {updatedAt ? (
            <>
              {t("workspace.lastModifiedPrefix")}{" "}
              {updatedBy ? (
                <>
                  {t("workspace.byLabel")}{" "}
                  <UserProfileTrigger username={updatedBy} />{" "}
                </>
              ) : null}
              {t("workspace.onDate", {
                date: formatDateAndTime(updatedAt, t, locale),
              })}
            </>
          ) : null}
        </p>

        <span className="text-muted-foreground/40 select-none" aria-hidden>•</span>

        <span className="inline-flex items-center gap-1.5">
          <Tag className="size-3.5 text-muted-foreground/70 shrink-0" aria-hidden />
          <span>
            {pageLabels.length ? pageLabels.map((label) => label.name).join(", ") : t("workspace.noLabels")}
          </span>
          <button
            type="button"
            onClick={onOpenLabelsDialog}
            className="hover:bg-surface-hover hover:text-foreground active:bg-surface-selected focus-visible:ring-ring flex size-5 cursor-pointer items-center justify-center rounded-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            aria-label={t("workspace.manageLabelsAria")}
            title={t("workspace.manageLabelsAria")}
          >
            <Plus className="size-3" />
          </button>
        </span>
      </div>

      <div className="mt-8 min-h-64">
        <SelectionAssistant
          spaceKey={space.key}
          pageSlug={currentPage?.slug ?? ""}
        >
          {body ? (
            currentPage?.content_format === "markdown" ? (
              <MarkdownContent
                content={body}
                canEditAttachments={canEdit && space.status === "active"}
              />
            ) : (
              <RichTextContent
                content={body}
                canEditAttachments={canEdit && space.status === "active"}
              />
            )
          ) : (
            <div className="border-border bg-surface-sunken rounded-lg border border-dashed p-6">
              <p className="font-medium">{t("workspace.noContent")}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t("workspace.noContentHint")}
              </p>
            </div>
          )}
        </SelectionAssistant>
      </div>

      {currentUser && currentPage ? (
        <PageComments
          spaceKey={space.key}
          pageSlug={currentPage.slug}
          currentUser={currentUser}
          composerContainer={composerSlot}
          headerStart={
            <span className="flex items-center">
              <button
                type="button"
                onClick={onToggleLiked}
                disabled={likePending}
                aria-pressed={liked}
                aria-label={t(liked ? "workspace.unlikePageAria" : "workspace.likePageAria", {
                  count: likeStatus.like_count,
                })}
                title={liked ? t("workspace.liked") : t("workspace.like")}
                className={cn(
                  "focus-visible:ring-ring flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
                  liked
                    ? "text-primary hover:bg-primary-subtle active:bg-surface-selected"
                    : "text-muted-foreground hover:bg-primary-subtle hover:text-primary active:bg-surface-selected",
                )}
              >
                <ThumbsUp className={cn("size-4.5", liked && "fill-current")} aria-hidden />
              </button>
              {/* The count opens who liked the page; the thumb toggles your own like. */}
              <LikersPopover
                url={`/api/v1/spaces/${encodeURIComponent(space.key)}/pages/${encodeURIComponent(currentPage.slug)}/likes`}
                count={likeStatus.like_count}
                className={cn("px-0.5 text-sm", liked ? "text-primary" : "text-muted-foreground hover:text-foreground")}
              />
            </span>
          }
          headerEnd={
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={onOpenShareDialog}
                aria-label={t("share.countAria", { count: shareCount })}
                title={t("share.title")}
                className="text-muted-foreground hover:bg-primary-subtle hover:text-primary active:bg-surface-selected focus-visible:ring-ring flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm tabular-nums transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                <Share2 className="size-4.5" aria-hidden />
                {shareCount}
              </button>
            </span>
          }
        />
      ) : null}
      {/* The comment box is portalled in here: a direct child of
          the article, so `sticky bottom-0` keeps it on screen for
          the whole page, not just while the comments are in view
          (sticky is confined to its parent's box). */}
      {currentUser && currentPage ? (
        <div
          ref={setComposerSlot}
          className="bg-background border-border sticky bottom-0 z-20 mt-3 border-t pt-3 pb-3"
        />
      ) : null}
    </>
  );
}
