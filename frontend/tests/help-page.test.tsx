import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const ai = vi.hoisted(() => ({
  status: vi.fn(),
  post: vi.fn(),
  openChat: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));
vi.mock("@/lib/ai-summary", () => ({ aiStatus: ai.status }));
vi.mock("@/lib/api-client", () => ({ api: { post: ai.post } }));
vi.mock("@/lib/ai-chat", () => ({ openChat: ai.openChat }));

import { searchGuides, fold, nodeText } from "@/components/help/help-data";
import { sectionsEn } from "@/components/help/help-content.en";
import { sectionsVi } from "@/components/help/help-content.vi";
import { HelpDetailPage, HelpPage } from "@/components/help/help-page";

beforeEach(() => {
  nav.push.mockReset();
  ai.post.mockReset();
  ai.openChat.mockReset();
  ai.status.mockResolvedValue({ enabled: true, can_configure: false });
  window.history.replaceState(null, "", "/help");
});

async function settle() {
  await act(async () => {});
}

function searchbox() {
  return screen.getAllByRole("searchbox", { name: "Search Help" })[0]!;
}

describe("The Help home", () => {
  it("offers a search, the guides to start with, and every topic with its guides", async () => {
    render(<HelpPage />);
    await settle();

    expect(screen.getByRole("heading", { name: "How can we help?" })).toBeInTheDocument();
    expect(searchbox()).toBeInTheDocument();
    const start = screen.getByRole("heading", { name: "Start here" }).parentElement!;
    expect(within(start).getByRole("link", { name: /Getting started/ })).toHaveAttribute(
      "href",
      "/help/workspace#getting-started",
    );
    const topics = screen.getByRole("navigation", { name: "Help topics" });
    expect(within(topics).getByRole("link", { name: /^Workspace/ })).toHaveAttribute(
      "href",
      "/help/workspace",
    );
    // A topic lists its first guides, and links to all of them when there are more.
    expect(within(topics).getByRole("link", { name: /Keyboard Shortcuts Reference/ })).toHaveAttribute(
      "href",
      "/help/workspace#keyboard-shortcuts",
    );
    expect(within(topics).getAllByRole("link", { name: /All \d+ guides/ }).length).toBeGreaterThan(0);
  });

  it("lists the matching guides as you type, ignoring accents, and opens one", async () => {
    const user = userEvent.setup();
    render(<HelpPage />);
    await settle();

    await user.type(searchbox(), "backup");

    const results = screen.getByRole("region", { name: "Search results" });
    const guide = within(results).getByRole("button", { name: /Backup, Confluence Import/ });
    await user.click(guide);
    expect(nav.push).toHaveBeenCalledWith("/help/administration#backup-and-restore");
  });

  it("moves through the results with the arrow keys and opens the one chosen", async () => {
    const user = userEvent.setup();
    render(<HelpPage />);
    await settle();

    await user.type(searchbox(), "shortcuts");
    // The first row is "ask the assistant"; the guides come after it.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push.mock.calls[0]![0]).toMatch(/^\/help\/(workspace|account)#.*shortcut/);
  });

  it("asks the AI assistant on Enter and shows its answer with the guides to read", async () => {
    ai.post.mockResolvedValue({
      found: true,
      answer: "Open **Backup** and choose a schedule.",
      guides: [{ id: "backup-and-restore", title: "Backups", category: "Administration" }],
      actions: [
        { id: "admin-backup", href: "/admin/backup", label_en: "Backup & import", label_vi: "Sao lưu & nhập" },
      ],
    });
    const user = userEvent.setup();
    render(<HelpPage />);
    await settle();
    await waitFor(() => expect(ai.status).toHaveBeenCalled());

    await user.type(searchbox(), "how do backups run on a schedule{Enter}");

    expect(ai.post).toHaveBeenCalledWith("/api/v1/ai/help", {
      question: "how do backups run on a schedule",
      locale: "en",
    });
    expect(await screen.findByText("Answer from the guides")).toBeInTheDocument();
    expect(screen.getByText("Backup")).toBeInTheDocument();
    // A button straight to the page of the application the answer is about.
    expect(screen.getByRole("link", { name: /Backup & import/ })).toHaveAttribute(
      "href",
      "/admin/backup",
    );
    await user.click(screen.getByRole("button", { name: /Backups/ }));
    expect(nav.push).toHaveBeenCalledWith("/help/administration#backup-and-restore");
  });

  it("puts Ask the AI assistant first, wraps the arrow keys round, and asks on Enter", async () => {
    ai.post.mockResolvedValue({ found: true, answer: "Use **Ctrl+K**.", guides: [] });
    const user = userEvent.setup();
    render(<HelpPage />);
    await settle();

    await user.type(searchbox(), "shortcuts");
    const results = screen.getByRole("region", { name: "Search results" });
    expect(within(results).getAllByRole("button")[0]).toHaveTextContent("Ask the AI assistant");
    // Up from nothing chosen lands on the last guide; down again wraps round to the top row.
    await user.keyboard("{ArrowUp}{ArrowDown}{Enter}");

    expect(ai.post).toHaveBeenCalledWith("/api/v1/ai/help", { question: "shortcuts", locale: "en" });
    expect(nav.push).not.toHaveBeenCalled();
    expect(await screen.findByText("Ctrl+K")).toBeInTheDocument();
  });

  it("says when the guides do not cover a question, and carries it on in the chat", async () => {
    ai.post.mockResolvedValue({ found: false, answer: "", guides: [] });
    const user = userEvent.setup();
    render(<HelpPage />);
    await settle();
    await waitFor(() => expect(ai.status).toHaveBeenCalled());

    await user.type(searchbox(), "zxqv plorb");
    expect(screen.getByRole("status")).toHaveTextContent('No guide matches "zxqv plorb".');
    await user.click(screen.getByRole("button", { name: /Ask the AI assistant/ }));

    expect(await screen.findByText(/do not cover this/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue in the chat" }));
    expect(ai.openChat).toHaveBeenCalledWith({ question: "zxqv plorb" });
  });

  it("asks one of the suggested questions in a click, and says when the assistant fails", async () => {
    ai.post.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    render(<HelpPage />);
    await settle();
    await waitFor(() => expect(ai.status).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    expect(ai.post).toHaveBeenCalledWith("/api/v1/ai/help", {
      question: "Keyboard shortcuts",
      locale: "en",
    });
    expect(await screen.findByText(/could not answer right now/)).toBeInTheDocument();
  });

  it("without the AI assistant, Enter opens the best guide and the Ask button is off", async () => {
    ai.status.mockResolvedValue({ enabled: false, can_configure: false });
    const user = userEvent.setup();
    render(<HelpPage />);
    await settle();
    await waitFor(() => expect(ai.status).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: /Ask AI/ })).toBeDisabled();
    await user.type(searchbox(), "backup{Enter}");

    expect(ai.post).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Ask the AI assistant/ })).not.toBeInTheDocument();
    // A suggestion then only fills the box.
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(searchbox()).toHaveValue("Keyboard shortcuts");
  });

  it("clears the search, closes on Escape and when clicking away", async () => {
    const user = userEvent.setup();
    render(<HelpPage />);
    await settle();

    await user.type(searchbox(), "theme");
    expect(screen.getByRole("region", { name: "Search results" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Search results" })).not.toBeInTheDocument();

    await user.click(searchbox());
    expect(screen.getByRole("region", { name: "Search results" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("region", { name: "Search results" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(searchbox()).toHaveValue("");
  });

  it("opens the chat from Still stuck", async () => {
    const user = userEvent.setup();
    render(<HelpPage />);
    await settle();

    await user.click(screen.getByRole("button", { name: "Open the chat" }));

    expect(ai.openChat).toHaveBeenCalledWith();
  });
});

describe("A Help topic", () => {
  it("shows its first guide, with the way back and every topic in the navigation", async () => {
    render(<HelpDetailPage topic="Account" />);
    await settle();

    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Help" })).toHaveAttribute("href", "/help");
    expect(
      screen.getByRole("heading", { level: 1, name: "Profile, Password Security & Active Sessions" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/sign out all other sessions/i)).toBeInTheDocument();
    // Only one guide at a time.
    expect(screen.queryByText(/Confluence Data Center XML export/i)).not.toBeInTheDocument();
    const guides = screen.getByRole("navigation", { name: "Guide navigation" });
    expect(within(guides).getByRole("link", { name: "All topics" })).toHaveAttribute("href", "/help");
    expect(within(guides).getByRole("link", { current: "page" })).toHaveTextContent(
      "Profile, Password Security",
    );
  });

  it("opens the guide the address names, and follows it when it changes", async () => {
    window.history.replaceState(null, "", "/help/account#notifications");
    render(<HelpDetailPage topic="Account" />);
    await settle();

    expect(
      screen.getByRole("heading", { level: 1, name: "Notifications: the Bell and Pop-ups" }),
    ).toBeInTheDocument();

    act(() => {
      window.history.replaceState(null, "", "/help/account#language-switching");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(
      screen.getByRole("heading", { level: 1, name: "Switching the Interface Language" }),
    ).toBeInTheDocument();

    act(() => {
      window.history.replaceState(null, "", "/help/account#not-a-guide");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(
      screen.getByRole("heading", { level: 1, name: "Profile, Password Security & Active Sessions" }),
    ).toBeInTheDocument();
  });

  it("goes to the previous and next guide, across topics at the ends", async () => {
    render(<HelpDetailPage topic="Account" />);
    await settle();

    const pager = screen.getByRole("navigation", { name: "Previous and next guide" });
    // The first Account guide comes after the last Attachments one.
    expect(within(pager).getByRole("link", { name: /Previous/ })).toHaveAttribute(
      "href",
      "/help/attachments#importing-documents",
    );
    expect(within(pager).getByRole("link", { name: /Next/ })).toHaveAttribute("href", "#notifications");
  });

  it("has no previous guide at the very first, and no next at the very last", async () => {
    const { unmount } = render(<HelpDetailPage topic="Workspace" />);
    await settle();
    let pager = screen.getByRole("navigation", { name: "Previous and next guide" });
    expect(within(pager).queryByRole("link", { name: /Previous/ })).not.toBeInTheDocument();
    unmount();

    window.history.replaceState(null, "", "/help/administration#safe-operation");
    render(<HelpDetailPage topic="Administration" />);
    await settle();
    pager = screen.getByRole("navigation", { name: "Previous and next guide" });
    expect(within(pager).queryByRole("link", { name: /Next/ })).not.toBeInTheDocument();
  });

  it("opens and closes topics in the navigation, and the list on narrow screens", async () => {
    const user = userEvent.setup();
    render(<HelpDetailPage topic="Account" />);
    await settle();
    const guides = screen.getByRole("navigation", { name: "Guide navigation" });

    const writing = within(guides).getByRole("button", { name: "Writing" });
    expect(writing).toHaveAttribute("aria-expanded", "false");
    await user.click(writing);
    expect(within(guides).getByRole("link", { name: /Slash Commands/ })).toHaveAttribute(
      "href",
      "/help/writing#slash-commands",
    );
    await user.click(within(guides).getByRole("button", { name: "Writing" }));
    expect(within(guides).queryByRole("link", { name: /Slash Commands/ })).not.toBeInTheDocument();

    const browse = screen.getByRole("button", { name: "Browse the guides" });
    await user.click(browse);
    expect(browse).toHaveAttribute("aria-expanded", "true");
  });

  it("opens a guide of the same topic from the search by changing the address only", async () => {
    window.history.replaceState(null, "", "/help/account");
    const user = userEvent.setup();
    render(<HelpDetailPage topic="Account" />);
    await settle();

    await user.type(searchbox(), "notifications bell");
    await user.click(
      within(screen.getByRole("region", { name: "Search results" })).getByRole("button", {
        name: /Notifications: the Bell/,
      }),
    );

    expect(window.location.hash).toBe("#notifications");
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("Searching the guides", () => {
  it("folds accents and đ, keeping the length", async () => {
    expect(fold("Cài đặt Đăng nhập")).toBe("cai dat dang nhap");
    expect(fold("Cài đặt").length).toBe("Cài đặt".length);
  });

  it("reads the words of a guide, captions included", async () => {
    expect(
      nodeText(
        <>
          <p>
            one <strong>two</strong> {3}
          </p>
          {null}
          {false}
          <img alt="" />
          {{} as unknown as string}
        </>,
      ).replace(/\s+/g, " "),
    ).toContain("one two 3");
  });

  it("needs every word, ranks titles first and shows a passage around a word in the text", async () => {
    expect(searchGuides(sectionsEn, "x")).toEqual([]);
    expect(searchGuides(sectionsEn, "backup zzzz")).toEqual([]);
    const [best] = searchGuides(sectionsEn, "slash commands");
    expect(best!.section.id).toBe("slash-commands");
    const deep = searchGuides(sectionsEn, "picture-in-picture subtitles")[0]!;
    expect(deep.snippet.length).toBeGreaterThan(0);
    const inText = searchGuides(sectionsEn, "giam sat")[0]!;
    expect(inText.snippet).toMatch(/…|Giám sát/);
  });

  it("ignores filler words, needs most of the rest, and finds a guide in either language", async () => {
    // "lam sao", "cua" are filler; the English guides alone know nothing of these words.
    const question = "làm sao khôi phục phiên bản cũ của trang";
    expect(searchGuides(sectionsEn, question)).toEqual([]);
    const both = searchGuides(sectionsEn, question, 6, sectionsVi);
    expect(both[0]!.section.id).toBe("history-and-export");
    // Still the English guide, with its own words to show.
    expect(both[0]!.section.title).toBe("Revision History, Visual Diff & Export");
    expect(searchGuides(sectionsEn, "how do the of")).toEqual([]);
  });
});
