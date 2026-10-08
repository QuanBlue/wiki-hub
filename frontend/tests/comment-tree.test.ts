import { describe, expect, it } from "vitest";

import {
  ancestorsOfMatches,
  arrangeThreads,
  buildCommentTree,
  countNodes,
  mentionQueryAt,
  NO_COMMENT_FILTER,
} from "@/lib/comments";
import type { PageComment } from "@/types/api";

function comment(id: string, parent: string | null = null): PageComment {
  return {
    id,
    parent_id: parent,
    body: id,
    author: null,
    created_at: "2026-10-07T08:00:00Z",
    edited_at: null,
    like_count: 0,
    liked_by_me: false,
    mentions: [],
    can_edit: false,
    can_delete: false,
  };
}

describe("buildCommentTree", () => {
  it("nests replies under their parent and keeps the given order", () => {
    const tree = buildCommentTree([
      comment("a"),
      comment("b", "a"),
      comment("c", "b"),
      comment("d"),
      comment("e", "a"),
    ]);

    expect(tree.map((node) => node.comment.id)).toEqual(["a", "d"]);
    expect(tree[0].replies.map((node) => node.comment.id)).toEqual(["b", "e"]);
    expect(tree[0].replies[0].replies.map((node) => node.comment.id)).toEqual(["c"]);
    expect(countNodes(tree)).toBe(5);
  });

  it("shows a reply whose parent is missing at the top instead of dropping it", () => {
    const tree = buildCommentTree([comment("orphan", "gone")]);

    expect(tree.map((node) => node.comment.id)).toEqual(["orphan"]);
  });

  it("is empty for no comments", () => {
    expect(buildCommentTree([])).toEqual([]);
  });
});

describe("mentionQueryAt", () => {
  it("finds the @name being typed at the caret", () => {
    expect(mentionQueryAt("hi @ali", 7)).toEqual({ query: "ali", start: 3 });
    expect(mentionQueryAt("@", 1)).toEqual({ query: "", start: 0 });
  });

  it("ignores an @ in the middle of a word or an e-mail address", () => {
    expect(mentionQueryAt("mail me@example", 15)).toBeNull();
  });

  it("stops once the name is finished", () => {
    expect(mentionQueryAt("@alice and", 10)).toBeNull();
  });
});

describe("arranging threads", () => {
  function by(
    id: string,
    parent: string | null,
    username: string,
    { at = "2026-10-07T08:00:00Z", likes = 0, mentions = [] as string[] } = {},
  ): PageComment {
    return {
      ...comment(id, parent),
      author: { id: username, username, full_name: username.toUpperCase(), avatar_url: null },
      created_at: at,
      like_count: likes,
      mentions,
    };
  }
  const list = [
    by("a", null, "ann", { at: "2026-10-07T08:00:00Z", likes: 1 }),
    by("a1", "a", "bob", { at: "2026-10-07T09:00:00Z", mentions: ["ann"] }),
    by("b", null, "bob", { at: "2026-10-07T10:00:00Z", likes: 3 }),
    by("c", null, "cat", { at: "2026-10-07T11:00:00Z" }),
  ];
  const roots = buildCommentTree(list);
  const ids = (nodes: { comment: PageComment }[]) => nodes.map((node) => node.comment.id);

  it("sorts threads oldest, newest, or by likes across the whole thread", () => {
    expect(ids(arrangeThreads(roots, "oldest", NO_COMMENT_FILTER))).toEqual(["a", "b", "c"]);
    expect(ids(arrangeThreads(roots, "newest", NO_COMMENT_FILTER))).toEqual(["c", "b", "a"]);
    expect(ids(arrangeThreads(roots, "liked", NO_COMMENT_FILTER))).toEqual(["b", "a", "c"]);
  });

  it("keeps a whole thread when any comment in it matches", () => {
    // bob replied in "a" and started "b": both threads stay, whole.
    const bob = arrangeThreads(roots, "oldest", { author: "bob", mentioning: null });
    expect(ids(bob)).toEqual(["a", "b"]);
    expect(bob[0].replies).toHaveLength(1);
    expect(ids(arrangeThreads(roots, "oldest", { author: null, mentioning: "ANN" }))).toEqual(["a"]);
    expect(arrangeThreads(roots, "oldest", { author: "cat", mentioning: "ann" })).toEqual([]);
  });

  it("opens the replies a filter matches", () => {
    expect(ancestorsOfMatches(list, { author: "bob", mentioning: null })).toEqual(["a"]);
    expect(ancestorsOfMatches(list, NO_COMMENT_FILTER)).toEqual([]);
  });
});
