import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LogoMark, Wordmark } from "@/components/brand/logo";
import {
  CommentItem,
  type CommentThreadContext,
} from "@/components/comments/comment-item";
import { viewToQuery } from "@/components/comments/comment-filters";
import { Quote } from "@/components/help/help-ui";
import {
  MailSummaryProvider,
  useMailSummary,
} from "@/components/layout/mail-summary-provider";
import { PasswordInput } from "@/components/ui/password-input";
import { TimezoneCombobox } from "@/components/ui/timezone-combobox";
import type { PageComment } from "@/types/api";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: {
    get: vi.fn().mockResolvedValue({ has_inbox: false, unread_count: 0 }),
  },
}));
vi.mock("@/components/users/user-profile-trigger", () => ({
  UserProfileTrigger: ({ username }: { username: string }) => (
    <span>{username}</span>
  ),
}));

describe("viewToQuery", () => {
  it("narrows by mention or by author, or just sorts", () => {
    expect(viewToQuery("mentions", "ann")).toEqual({
      sort: "newest",
      filter: { author: null, mentioning: "ann" },
    });
    expect(viewToQuery("mine", "ann")).toEqual({
      sort: "newest",
      filter: { author: "ann", mentioning: null },
    });
    expect(viewToQuery("liked", "ann")).toEqual({
      sort: "liked",
      filter: { author: null, mentioning: null },
    });
  });
});

describe("Quote", () => {
  it("renders a block quote", () => {
    render(<Quote>wise words</Quote>);
    expect(screen.getByText("wise words").tagName).toBe("BLOCKQUOTE");
  });
});

describe("PasswordInput", () => {
  it("reveals and hides the password", async () => {
    render(<PasswordInput aria-label="pw" defaultValue="secret" />);
    const input = screen.getByLabelText("pw");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.click(
      screen.getByRole("button", { name: /show password/i }),
    );
    expect(input).toHaveAttribute("type", "text");
    await userEvent.click(
      screen.getByRole("button", { name: /hide password/i }),
    );
    expect(input).toHaveAttribute("type", "password");
  });
});

describe("TimezoneCombobox", () => {
  it("says so when nothing matches the search", async () => {
    render(<TimezoneCombobox value="UTC" onValueChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.type(await screen.findByRole("searchbox"), "zzzzzz");
    expect(screen.getByText("No matching time zone.")).toBeInTheDocument();
  });
});

describe("LogoMark", () => {
  it("uses the given icon without the theme's custom logo", () => {
    const { container } = render(<LogoMark icon="book" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("shows a custom logo when provided", () => {
    const { container } = render(<LogoMark customLogoUrl="/logo.png" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/logo.png");
  });
});

describe("MailSummaryProvider", () => {
  it("lets consumers ask for a fresh summary", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMailSummary(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <MailSummaryProvider
            initial={{ has_inbox: true, unread_count: 2 } as never}
            poll={false}
          >
            {children}
          </MailSummaryProvider>
        </QueryClientProvider>
      ),
    });
    expect(result.current.summary).toMatchObject({ unread_count: 2 });
    act(() => result.current.refresh());
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["admin-mail", "summary"],
    });
  });
});

describe("CommentItem", () => {
  const ctx = {
    mentionsUrl: "/m",
    commentsUrl: "/c",
    currentUser: { id: "u", username: "me", full_name: "Me", avatar_url: null },
    expanded: new Set<string>(),
    toggleExpanded: vi.fn(),
    replyingTo: null,
    setReplyingTo: vi.fn(),
    editingId: null,
    setEditingId: vi.fn(),
    likePending: new Set<string>(),
    highlightId: null,
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onLike: vi.fn(),
  } as unknown as CommentThreadContext;

  const comment = (overrides: Partial<PageComment> = {}) =>
    ({
      id: "c1",
      parent_id: null,
      body: "hello",
      author: { id: "a", username: "ann", full_name: "Ann", avatar_url: null },
      created_at: "2026-03-05T12:00:00Z",
      edited_at: null,
      like_count: 0,
      liked_by_me: false,
      mentions: [],
      can_edit: false,
      can_delete: false,
      ...overrides,
    }) as PageComment;

  afterEach(() => {
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
  });

  it("shows a placeholder for a deleted author", () => {
    render(
      <ul>
        <CommentItem
          node={{ comment: comment({ author: null }), replies: [] }}
          depth={1}
          ctx={ctx}
        />
      </ul>,
    );
    expect(screen.getByText(/deleted/i)).toBeInTheDocument();
  });

  it("collapses a long comment and expands it on See more", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      value: 500,
    });
    render(
      <ul>
        <CommentItem
          node={{ comment: comment({ body: "x\n".repeat(50) }), replies: [] }}
          depth={0}
          ctx={ctx}
        />
      </ul>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /see more/i }),
    );
    expect(
      screen.queryByRole("button", { name: /see more/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Wordmark", () => {
  it("keeps the name in a span of its own when asked to style it", () => {
    render(<Wordmark siteName="Acme Wiki" nameClassName="hidden sm:inline" />);
    // The site name comes from the theme settings when there are any.
    expect(screen.getByText(/WikiHub|Acme Wiki/)).toHaveClass(
      "hidden",
      "sm:inline",
    );
  });
});
