"use client";

import { Loader2, MessageCircle } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { CommentComposer } from "@/components/comments/comment-composer";
import {
  type CommentView,
  CommentViewMenu,
  viewToQuery,
} from "@/components/comments/comment-filters";
import {
  CommentItem,
  type CommentThreadContext,
} from "@/components/comments/comment-item";
import { Avatar } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api-client";
import {
  ancestorsOfMatches,
  arrangeThreads,
  buildCommentTree,
  commentMatches,
} from "@/lib/comments";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { CommentLikeStatus, Page, PageComment } from "@/types/api";

export interface CommentsUser {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
}

/** Ids of every ancestor of ``id`` (so a linked reply can be revealed). */
function ancestorsOf(comments: readonly PageComment[], id: string): string[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const found: string[] = [];
  let parent = byId.get(id)?.parent_id ?? null;
  while (parent) {
    found.push(parent);
    parent = byId.get(parent)?.parent_id ?? null;
  }
  return found;
}

/**
 * The discussion under a page: a Facebook-style reply tree with likes,
 * ``@mentions``, inline editing and delete-with-replies. Replies start
 * collapsed; a ``#comment-<id>`` link (from a notification) opens the path to
 * that comment and scrolls to it.
 */
export function PageComments({
  spaceKey,
  pageSlug,
  currentUser,
  headerStart,
  composerContainer,
}: {
  spaceKey: string;
  pageSlug: string;
  currentUser: CommentsUser;
  /** Shown first in the header row, before the comment count - the page's
   * own Like button. */
  headerStart?: ReactNode;
  /** Where to render the new-comment box instead of under the thread - a
   * sticky slot that keeps it in view while reading the page. */
  composerContainer?: HTMLElement | null;
}) {
  const { t, apiErrorText } = useTranslation();
  const base = `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(pageSlug)}/comments`;

  const [comments, setComments] = useState<PageComment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [likePending, setLikePending] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<PageComment | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [view, setView] = useState<CommentView>("oldest");

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while the next page's comments load
    setComments(null);
    setFailed(false);
    setReplyingTo(null);
    setEditingId(null);
    setView("oldest");
    api
      .get<Page<PageComment>>(base)
      .then((page) => {
        if (active) setComments(page.items);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [base]);

  // Open and scroll to a comment named in the URL hash, once they are loaded.
  useEffect(() => {
    if (!comments) return;
    const match = /^#comment-([0-9a-f-]{36})$/i.exec(window.location.hash);
    if (!match || !comments.some((comment) => comment.id === match[1])) return;
    const target = match[1];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reveal the linked comment
    setExpanded((current) => new Set([...current, ...ancestorsOf(comments, target)]));
    setHighlightId(target);
    const timer = setTimeout(() => {
      document
        .getElementById(`comment-${target}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
    const fade = setTimeout(() => setHighlightId(null), 4000);
    return () => {
      clearTimeout(timer);
      clearTimeout(fade);
    };
    // Only on first load of a page's comments, not after every like.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments === null]);

  const tree = useMemo(() => buildCommentTree(comments ?? []), [comments]);
  const total = comments?.length ?? 0;

  const { sort, filter } = viewToQuery(view, currentUser.username);
  const threads = useMemo(() => arrangeThreads(tree, sort, filter), [tree, sort, filter]);
  const countMatching = (part: Parameters<typeof commentMatches>[1]) =>
    (comments ?? []).filter((comment) => commentMatches(comment, part)).length;
  const viewCounts = {
    mentions: countMatching({ author: null, mentioning: currentUser.username }),
    mine: countMatching({ author: currentUser.username, mentioning: null }),
  };
  // Nothing to order or narrow in a one-comment discussion.
  const showViewMenu = comments !== null && !failed && total > 1;

  /** Switches the view and opens the replies a narrowing view matches, so
   * a match inside a collapsed thread is on screen rather than hidden behind
   * "View replies". */
  function changeView(next: CommentView) {
    setView(next);
    const reveal = ancestorsOfMatches(comments ?? [], viewToQuery(next, currentUser.username).filter);
    if (reveal.length > 0) setExpanded((current) => new Set([...current, ...reveal]));
  }

  function focusComposer() {
    const box = document.querySelector<HTMLTextAreaElement>("#page-comment-composer textarea");
    box?.scrollIntoView({ block: "center", behavior: "smooth" });
    box?.focus({ preventScroll: true });
  }

  const replace = useCallback((updated: PageComment) => {
    setComments((current) =>
      current ? current.map((item) => (item.id === updated.id ? updated : item)) : current,
    );
  }, []);

  const post = useCallback(
    async (body: string, parent: PageComment | null): Promise<boolean> => {
      try {
        const created = await api.post<PageComment>(base, {
          body,
          parent_id: parent?.id ?? null,
        });
        setComments((current) => [...(current ?? []), created]);
        if (parent) {
          setExpanded((current) => new Set([...current, parent.id]));
          setReplyingTo(null);
        }
        return true;
      } catch (error) {
        toast.error(apiErrorText(error, "comments.postError"));
        return false;
      }
    },
    [apiErrorText, base],
  );

  const edit = useCallback(
    async (comment: PageComment, body: string): Promise<boolean> => {
      try {
        replace(
          await api.patch<PageComment>(`${base}/${comment.id}`, { body }),
        );
        setEditingId(null);
        return true;
      } catch (error) {
        toast.error(apiErrorText(error, "comments.saveError"));
        return false;
      }
    },
    [apiErrorText, base, replace],
  );

  const toggleLike = useCallback(
    async (comment: PageComment) => {
      setLikePending((current) => new Set(current).add(comment.id));
      try {
        const status = comment.liked_by_me
          ? await api.delete<CommentLikeStatus>(`${base}/${comment.id}/like`)
          : await api.put<CommentLikeStatus>(`${base}/${comment.id}/like`);
        setComments((current) =>
          current
            ? current.map((item) =>
                item.id === comment.id
                  ? { ...item, liked_by_me: status.liked_by_me, like_count: status.like_count }
                  : item,
              )
            : current,
        );
      } catch (error) {
        toast.error(apiErrorText(error, "comments.likeError"));
      } finally {
        setLikePending((current) => {
          const next = new Set(current);
          next.delete(comment.id);
          return next;
        });
      }
    },
    [apiErrorText, base],
  );

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    try {
      await api.delete(`${base}/${deleting.id}`);
      // The branch goes with it: drop the comment and everything beneath it.
      const gone = new Set([deleting.id]);
      setComments((current) => {
        if (!current) return current;
        let grew = true;
        while (grew) {
          grew = false;
          for (const item of current) {
            if (item.parent_id && gone.has(item.parent_id) && !gone.has(item.id)) {
              gone.add(item.id);
              grew = true;
            }
          }
        }
        return current.filter((item) => !gone.has(item.id));
      });
      setDeleting(null);
    } catch (error) {
      toast.error(apiErrorText(error, "comments.deleteError"));
    } finally {
      setDeletePending(false);
    }
  }

  const ctx: CommentThreadContext = {
    mentionsUrl: `${base}/mentionable`,
    commentsUrl: base,
    currentUser,
    expanded,
    toggleExpanded: (id) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    replyingTo,
    setReplyingTo: (id) => {
      setReplyingTo(id);
      if (id) setEditingId(null);
    },
    editingId,
    setEditingId: (id) => {
      setEditingId(id);
      if (id) setReplyingTo(null);
    },
    likePending,
    highlightId,
    onReply: (parent, body) => post(body, parent),
    onEdit: edit,
    onDelete: setDeleting,
    onLike: (comment) => void toggleLike(comment),
  };

  // Whether the comment being deleted has replies that go with it.
  const deletingHasReplies =
    deleting !== null &&
    (comments ?? []).some((comment) => comment.parent_id === deleting.id);

  const composer = (
    <div id="page-comment-composer" className={cn("flex gap-2", !composerContainer && "mt-3")}>
      <Avatar
        name={currentUser.full_name}
        username={currentUser.username}
        src={currentUser.avatar_url}
        className="ring-border ring-1"
      />
      <CommentComposer
        mentionsUrl={ctx.mentionsUrl}
        placeholder={t("comments.placeholder")}
        submitLabel={t("comments.send")}
        suggestionsAbove={Boolean(composerContainer)}
        onSubmit={(body) => post(body, null)}
      />
    </div>
  );

  return (
    <section aria-labelledby="page-comments-heading" className="mt-12">
      {/* A labelled rule marks where the page body ends and the discussion
          begins - clear without boxing the thread in a second surface. */}
      <div className="mb-2 flex items-center gap-3">
        <h2
          id="page-comments-heading"
          className="text-muted-foreground shrink-0 text-xs font-semibold tracking-wider uppercase"
        >
          {t("comments.title")}
        </h2>
        <span className="bg-border h-px flex-1" aria-hidden />
      </div>
      {/* Like and comment count in one row, as on a social post. */}
      <div className="flex items-center justify-between gap-2">
      <div className="-ml-2 flex items-center gap-1">
        {headerStart}
        <button
          type="button"
          onClick={focusComposer}
          aria-label={t("comments.countAria", { count: total })}
          title={t("comments.writeTitle")}
          className="text-muted-foreground hover:bg-primary-subtle hover:text-primary active:bg-surface-selected focus-visible:ring-ring flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm tabular-nums transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          <MessageCircle className="size-4.5" aria-hidden />
          {total}
        </button>
      </div>
        {showViewMenu ? (
          <CommentViewMenu view={view} onViewChange={changeView} counts={viewCounts} />
        ) : null}
      </div>

      <div className="mt-2">

        {failed ? (
          <p role="alert" className="text-danger text-sm">
            {t("comments.loadError")}
          </p>
        ) : comments === null ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
          </div>
        ) : tree.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("comments.empty")}</p>
        ) : threads.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
            {t("comments.noMatches")}{" "}
            <button
              type="button"
              onClick={() => setView("oldest")}
              className="text-primary hover:text-primary-hover focus-visible:ring-ring cursor-pointer rounded font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              {t("comments.showAll")}
            </button>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {threads.map((node) => (
              <CommentItem key={node.comment.id} node={node} depth={0} ctx={ctx} />
            ))}
          </ul>
        )}

        {composerContainer ? null : composer}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deletePending) setDeleting(null);
        }}
        title={t("comments.deleteTitle")}
        description={
          deletingHasReplies
            ? t("comments.deleteDescription")
            : t("comments.deleteDescriptionOne")
        }
        confirmLabel={t("comments.deleteConfirm")}
        cancelLabel={t("comments.cancel")}
        destructive
        pending={deletePending}
        onConfirm={() => void confirmDelete()}
      />
      {composerContainer ? createPortal(composer, composerContainer) : null}
    </section>
  );
}
