import type { PageComment } from "@/types/api";

export interface CommentNode {
  comment: PageComment;
  replies: CommentNode[];
}

/**
 * Turns the flat, oldest-first list the API returns into a reply tree. A reply
 * whose parent is missing (it cannot be, but a stale list could say so) is
 * shown at the top level rather than lost.
 */
export function buildCommentTree(comments: readonly PageComment[]): CommentNode[] {
  const nodes = new Map<string, CommentNode>(
    comments.map((comment) => [comment.id, { comment, replies: [] }]),
  );
  const roots: CommentNode[] = [];
  for (const comment of comments) {
    const node = nodes.get(comment.id)!;
    const parent = comment.parent_id ? nodes.get(comment.parent_id) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

export type CommentSort = "oldest" | "newest" | "liked";

export interface CommentFilter {
  /** Only threads with a comment by this username. */
  author: string | null;
  /** Only threads with a comment that @mentions this username. */
  mentioning: string | null;
}

export const NO_COMMENT_FILTER: CommentFilter = { author: null, mentioning: null };

function walk(node: CommentNode): PageComment[] {
  return [node.comment, ...node.replies.flatMap(walk)];
}

/** Whether one comment passes every active part of ``filter``. */
export function commentMatches(comment: PageComment, filter: CommentFilter): boolean {
  if (filter.author && comment.author?.username !== filter.author) return false;
  if (
    filter.mentioning &&
    !comment.mentions.some((name) => name.toLowerCase() === filter.mentioning!.toLowerCase())
  ) {
    return false;
  }
  return true;
}

export function isFiltering(filter: CommentFilter): boolean {
  return filter.author !== null || filter.mentioning !== null;
}

/**
 * Top-level threads to show, in ``sort`` order. A thread is kept whole when
 * any comment in it matches ``filter`` - a matching reply means nothing
 * without the comment it answers. Replies inside a thread keep their
 * conversational (oldest-first) order whatever the sort.
 */
export function arrangeThreads(
  roots: readonly CommentNode[],
  sort: CommentSort,
  filter: CommentFilter,
): CommentNode[] {
  const kept = isFiltering(filter)
    ? roots.filter((root) => walk(root).some((comment) => commentMatches(comment, filter)))
    : [...roots];
  const likes = (node: CommentNode) =>
    walk(node).reduce((total, comment) => total + comment.like_count, 0);
  const time = (node: CommentNode) => Date.parse(node.comment.created_at);
  if (sort === "newest") kept.sort((a, b) => time(b) - time(a));
  else if (sort === "liked") kept.sort((a, b) => likes(b) - likes(a) || time(a) - time(b));
  else kept.sort((a, b) => time(a) - time(b));
  return kept;
}

/** Ids of every comment that has a reply matching ``filter`` beneath it -
 * expanding these reveals each match inside a collapsed thread. */
export function ancestorsOfMatches(
  comments: readonly PageComment[],
  filter: CommentFilter,
): string[] {
  if (!isFiltering(filter)) return [];
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const found = new Set<string>();
  for (const comment of comments) {
    if (!commentMatches(comment, filter)) continue;
    let parent = comment.parent_id;
    while (parent && !found.has(parent)) {
      found.add(parent);
      parent = byId.get(parent)?.parent_id ?? null;
    }
  }
  return [...found];
}

/** How many comments live under (and including) every node. */
export function countNodes(nodes: readonly CommentNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.replies), 0);
}

/** Replies below this depth stop indenting further, as on Facebook. */
export const MAX_INDENT_DEPTH = 3;

/** The ``@name`` being typed right before ``caret``, if any. */
export function mentionQueryAt(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|[\s(])@([A-Za-z0-9_.-]{0,40})$/.exec(before);
  if (!match) return null;
  return { query: match[1], start: caret - match[1].length - 1 };
}
