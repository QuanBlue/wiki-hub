"use client";

import {
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CommentComposer } from "@/components/comments/comment-composer";
import { LikersPopover } from "@/components/comments/likers-popover";
import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type CommentNode, MAX_INDENT_DEPTH, countNodes } from "@/lib/comments";
import { useTranslation } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/i18n/format";
import { formatRelative } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import type { CommentAuthor, PageComment } from "@/types/api";

export interface CommentThreadContext {
  mentionsUrl: string;
  /** The page's comments endpoint; ``/{id}/likes`` lists who liked one. */
  commentsUrl: string;
  currentUser: CommentAuthor;
  expanded: ReadonlySet<string>;
  toggleExpanded: (id: string) => void;
  replyingTo: string | null;
  setReplyingTo: (id: string | null) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  likePending: ReadonlySet<string>;
  highlightId: string | null;
  onReply: (parent: PageComment, body: string) => Promise<boolean>;
  onEdit: (comment: PageComment, body: string) => Promise<boolean>;
  onDelete: (comment: PageComment) => void;
  onLike: (comment: PageComment) => void;
}

// Bold muted words (Like / Reply) with a soft tint and underline on hover.
// Tailwind v4 no longer gives buttons a pointer cursor, so it is set here.
const actionButton =
  "text-muted-foreground hover:bg-surface-hover hover:text-foreground cursor-pointer active:bg-surface-selected focus-visible:ring-ring min-h-6 rounded-md px-1.5 text-xs font-semibold underline-offset-2 transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60";

/**
 * One comment and, below it, its replies. The thread line works like on
 * Facebook: a rail drops from the author's avatar and curves into the
 * "View replies" row; open replies branch off it with a short tick.
 *
 * The geometry is tied to the avatar size (2rem for a top-level comment,
 * 1.5rem for replies): the rail sits under the avatar's centre, and a branch
 * spans from there to where the next avatar starts (half the avatar + the
 * 0.5rem gap).
 */
export function CommentItem({
  node,
  depth,
  ctx,
}: {
  node: CommentNode;
  depth: number;
  ctx: CommentThreadContext;
}) {
  const { t, locale } = useTranslation();
  const { comment } = node;
  const author = comment.author;
  const name = author ? author.full_name || author.username : t("comments.deletedAuthor");
  const replyCount = countNodes(node.replies);
  const isOpen = ctx.expanded.has(comment.id);
  const editing = ctx.editingId === comment.id;
  const replying = ctx.replyingTo === comment.id;
  const liking = ctx.likePending.has(comment.id);
  // A long comment (a pasted log, say) shows its first lines and "See
  // more"; whether it overflows is measured, not guessed from its length.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [showFull, setShowFull] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || showFull) return;
    const measure = () => setOverflows(body.scrollHeight > body.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [comment.body, showFull]);
  const hasMenu = comment.can_edit || comment.can_delete;
  const top = depth === 0;
  // Replies stop stepping right (and stop drawing the rail) past this depth.
  const railed = depth < MAX_INDENT_DEPTH;

  return (
    <li id={`comment-${comment.id}`} className="group/comment relative scroll-mt-20">
      {replyCount > 0 && railed && (
        <span
          aria-hidden
          className={cn(
            "border-border absolute bottom-7 border-l-2",
            top ? "top-9 left-4" : "top-7 left-3",
          )}
        />
      )}
      <div className="flex gap-2">
        {author ? (
          <UserProfileTrigger
            username={author.username}
            fullName={author.full_name}
            variant="avatar"
            className={cn(
              "shrink-0 self-start",
              "ring-border ring-1",
              top ? "size-8 text-xs" : "size-6 text-[10px]",
            )}
          />
        ) : (
          <Avatar username="?" name="?" className={cn("ring-border ring-1", !top && "size-6 text-[10px]")} />
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <CommentComposer
              mentionsUrl={ctx.mentionsUrl}
              initialValue={comment.body}
              placeholder={t("comments.placeholder")}
              submitLabel={t("comments.save")}
              autoFocus
              compact
              onSubmit={(body) => ctx.onEdit(comment, body)}
              onCancel={() => ctx.setEditingId(null)}
            />
          ) : (
            <div className="flex max-w-full items-start gap-1">
              <div className="min-w-44 max-w-[90%]">
                <div
                  className={cn(
                    // One step darker than the sunken surface: that sat so close to
                    // the white page that the bubble's edge all but vanished.
                    "bg-surface-hover rounded-lg px-3 py-2 break-words",
                    ctx.highlightId === comment.id && "ring-primary ring-2",
                  )}
                >
                  <div className="text-[13px] leading-5 font-semibold">
                    {author ? (
                      <UserProfileTrigger
                        username={author.username}
                        fullName={author.full_name}
                        className="text-foreground hover:text-foreground"
                      />
                    ) : (
                      <span className="text-muted-foreground">{name}</span>
                    )}
                  </div>
                  <div
                    ref={bodyRef}
                    className={cn(!showFull && "max-h-36 overflow-hidden")}
                  >
                    <IssueMarkdown
                      source={comment.body}
                      mentions={comment.mentions}
                      className="text-foreground text-[15px] leading-snug [&_p]:my-0.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
                    />
                  </div>
                  {!showFull && overflows && (
                    <button
                      type="button"
                      onClick={() => setShowFull(true)}
                      className="text-primary hover:text-primary-hover focus-visible:ring-ring mt-0.5 cursor-pointer rounded text-sm font-semibold underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {t("comments.seeMore")}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-x-1 pl-1.5 pt-0.5">
                  <time
                    dateTime={comment.created_at}
                    title={formatDateTime(comment.created_at, locale)}
                    className="text-muted-foreground pr-1 text-xs"
                  >
                    {formatRelative(comment.created_at, locale)}
                  </time>
                  <button
                    type="button"
                    className={cn(actionButton, comment.liked_by_me && "text-primary hover:text-primary")}
                    aria-pressed={comment.liked_by_me}
                    aria-label={
                      comment.liked_by_me ? t("comments.unlike") : t("comments.like")
                    }
                    title={comment.liked_by_me ? t("comments.unlike") : t("comments.like")}
                    disabled={liking}
                    onClick={() => ctx.onLike(comment)}
                  >
                    {t("comments.like")}
                  </button>
                  <button
                    type="button"
                    className={actionButton}
                    onClick={() => ctx.setReplyingTo(replying ? null : comment.id)}
                  >
                    {t("comments.reply")}
                  </button>
                  {comment.edited_at && (
                    <span
                      className="text-muted-foreground px-1 text-xs"
                      title={formatDateTime(comment.edited_at, locale)}
                    >
                      {t("comments.edited")}
                    </span>
                  )}
                  {comment.like_count > 0 && (
                    <LikersPopover
                      badge
                      url={`${ctx.commentsUrl}/${comment.id}/likes`}
                      count={comment.like_count}
                      className="text-muted-foreground hover:text-foreground ml-auto pl-2 text-xs"
                    />
                  )}
                </div>
              </div>

              {hasMenu && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("comments.more")}
                      title={t("comments.more")}
                      className={cn(
                        "text-muted-foreground hover:bg-primary-subtle hover:text-primary active:bg-surface-selected focus-visible:ring-ring mt-2 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                        // Out of sight until the comment is hovered, but always
                        // there on touch screens, which cannot hover.
                        "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/comment:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 data-[state=open]:opacity-100",
                      )}
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-36 p-1">
                    {comment.can_edit && (
                      <DropdownMenuItem onSelect={() => ctx.setEditingId(comment.id)}>
                        <Pencil />
                        {t("comments.edit")}
                      </DropdownMenuItem>
                    )}
                    {comment.can_delete && (
                      <DropdownMenuItem destructive onSelect={() => ctx.onDelete(comment)}>
                        <Trash2 />
                        {t("comments.delete")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}

          {replying && (
            <div className="mt-1.5 flex gap-2">
              <Avatar
                name={ctx.currentUser.full_name}
                username={ctx.currentUser.username}
                src={ctx.currentUser.avatar_url}
                className="ring-border size-6 text-[10px] ring-1"
              />
              <CommentComposer
                mentionsUrl={ctx.mentionsUrl}
                initialValue={author ? `@${author.username} ` : ""}
                placeholder={t("comments.replyPlaceholder")}
                submitLabel={t("comments.sendReply")}
                autoFocus
                compact
                onSubmit={(body) => ctx.onReply(comment, body)}
                onCancel={() => ctx.setReplyingTo(null)}
              />
            </div>
          )}

          {replyCount > 0 && isOpen && (
            <ul className={cn("mt-1.5 space-y-1.5", !railed && "-ml-8")}>
              {node.replies.map((reply) => (
                <CommentItem
                  key={reply.comment.id}
                  node={reply}
                  depth={depth + 1}
                  ctx={ctx}
                />
              ))}
            </ul>
          )}

          {replyCount > 0 && (
            <div className="relative mt-0.5">
              {railed && (
                <span
                  aria-hidden
                  className={cn(
                    "border-border absolute top-0 h-3.5 rounded-bl-xl border-b-2 border-l-2",
                    top ? "-left-6 w-6" : "-left-5 w-5",
                  )}
                />
              )}
              <button
                type="button"
                className={cn(actionButton, "flex h-7 items-center gap-1")}
                aria-expanded={isOpen}
                onClick={() => ctx.toggleExpanded(comment.id)}
              >
                {isOpen ? (
                  <>
                    <ChevronUp className="size-3.5" aria-hidden />
                    {t("comments.hideReplies")}
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3.5" aria-hidden />
                    {t(
                      replyCount === 1 ? "comments.viewReplyOne" : "comments.viewReplies",
                      { count: replyCount },
                    )}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
      {depth > 0 && depth - 1 < MAX_INDENT_DEPTH && (
        <Branch parentIsTop={depth === 1} />
      )}
    </li>
  );
}

/** The short tick joining a reply's avatar to its parent's rail. */
function Branch({ parentIsTop }: { parentIsTop: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "border-border absolute top-2.75 border-t-2",
        parentIsTop ? "-left-6 w-6" : "-left-5 w-5",
      )}
    />
  );
}
