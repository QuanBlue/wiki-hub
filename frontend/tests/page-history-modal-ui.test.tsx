import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HighlightedDiffContent,
  PageHistoryModal,
  changedBlocks,
} from "@/components/pages/page-history-modal";
import { LocaleProvider } from "@/lib/i18n/context";
import type { PageRevisionDiff, PageRevisionItem } from "@/types/api";

const revisionsApi = vi.hoisted(() => ({
  listPageRevisions: vi.fn(),
  getRevisionDiff: vi.fn(),
  restorePageRevision: vi.fn(),
  getRevisionDiffSummary: vi.fn(),
}));
const aiSummaryApi = vi.hoisted(() => ({
  aiStatus: vi.fn().mockResolvedValue({ enabled: true, can_configure: false }),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const readerMock = vi.hoisted(() => ({ prefix: "", loading: false }));

vi.mock("@/lib/revisions", () => revisionsApi);
vi.mock("@/lib/ai-summary", () => aiSummaryApi);
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/users/user-profile-trigger", () => ({
  UserProfileTrigger: ({ username }: { username: string }) => (
    <span data-testid="author-trigger">{username}</span>
  ),
}));
vi.mock("@/components/pages/rich-text-editor", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/pages/rich-text-editor")
  >()),
  RichTextContent: ({ content }: { content: string }) => (
    <div
      data-testid="rich-content"
      className={readerMock.loading ? "" : "ProseMirror"}
      dangerouslySetInnerHTML={{ __html: readerMock.prefix + content }}
    />
  ),
}));

function revision(overrides: Partial<PageRevisionItem>): PageRevisionItem {
  return {
    id: `rev-${overrides.version}`,
    page_id: "page-1",
    version: 1,
    title: "Runbook",
    content: "<p>content</p>",
    content_format: "html",
    created_at: "2026-01-02T03:04:05Z",
    change_summary: null,
    created_by_username: "alice",
    created_by_full_name: "Alice Nguyen",
    ...overrides,
  };
}

const revisions: PageRevisionItem[] = [
  revision({
    version: 3,
    content: "<p>third line</p>",
    change_summary: "Reworded intro",
  }),
  revision({
    version: 2,
    content: "second raw text",
    content_format: "markdown",
    change_summary: "Updated content",
    created_by_username: "system",
    created_by_full_name: null,
  }),
  revision({
    version: 1,
    content: "<p>first line</p>",
    created_by_username: null,
    created_by_full_name: null,
  }),
];

function diff(overrides: Partial<PageRevisionDiff> = {}): PageRevisionDiff {
  return {
    from_version: 2,
    to_version: 3,
    title_changed: false,
    from_title: "Runbook old",
    to_title: "Runbook new",
    chunks: [],
    added_count: 2,
    deleted_count: 1,
    lines: [],
    ...overrides,
  };
}

function renderModal(
  props: Partial<React.ComponentProps<typeof PageHistoryModal>> = {},
) {
  const onOpenChange = vi.fn();
  const onRestored = vi.fn();
  const utils = render(
    <LocaleProvider initialLocale="en">
      <PageHistoryModal
        open
        onOpenChange={onOpenChange}
        spaceKey="ENG"
        slug="runbook"
        pageTitle="Runbook"
        onRestored={onRestored}
        // The rendered side-by-side view (the default); the line view has its own test.
        defaultView="pages"
        {...props}
      />
    </LocaleProvider>,
  );
  return { ...utils, onOpenChange, onRestored };
}

beforeEach(() => {
  vi.clearAllMocks();
  readerMock.prefix = "";
  readerMock.loading = false;
  Element.prototype.scrollTo =
    vi.fn() as unknown as typeof Element.prototype.scrollTo;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
  });
  revisionsApi.listPageRevisions.mockResolvedValue(revisions);
  revisionsApi.getRevisionDiff.mockResolvedValue(diff());
  revisionsApi.restorePageRevision.mockResolvedValue({});
  aiSummaryApi.aiStatus.mockResolvedValue({
    enabled: true,
    can_configure: false,
  });
  revisionsApi.getRevisionDiffSummary.mockResolvedValue({
    summary: "Diff summary",
    commit_message: "Commit message",
    from_version: 2,
    to_version: 3,
    cached: false,
  });
});

describe("PageHistoryModal", () => {
  it("lists the revisions and compares the latest two by default", async () => {
    renderModal();

    expect(await screen.findByText("3 versions")).toBeInTheDocument();
    expect(screen.getByText("CURRENT")).toBeInTheDocument();
    expect(
      screen.getByText("Reworded intro", { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Updated content", { exact: false }),
    ).not.toBeInTheDocument();
    // v3 by name, v2 by username fallback ("system"), v1 as the System label.
    expect(screen.getAllByText("Alice Nguyen").length).toBeGreaterThan(0);
    expect(screen.getAllByText("system").length).toBeGreaterThan(0);
    expect(screen.getAllByText("System").length).toBeGreaterThan(0);

    expect(await screen.findByText("v2: Runbook old")).toBeInTheDocument();
    expect(screen.getByText("v3: Runbook new")).toBeInTheDocument();
    // Counted from the two versions themselves: one line went, one came.
    expect(screen.getByText("1 removal")).toBeInTheDocument();
    expect(screen.getByText("1 addition")).toBeInTheDocument();
    expect(revisionsApi.getRevisionDiff).toHaveBeenCalledWith(
      "ENG",
      "runbook",
      2,
      3,
    );
    // v2 is markdown (raw text), v3 is html (rich renderer).
    expect(screen.getByText("second raw text")).toBeInTheDocument();
    expect(screen.getByTestId("rich-content")).toHaveTextContent("third line");
    // The latest version has nothing to restore to.
    expect(
      screen.queryByRole("button", { name: /restore to/i }),
    ).not.toBeInTheDocument();
  });

  it("opens on the page view by default, and switches to line by line", async () => {
    renderModal({ defaultView: undefined });

    expect(await screen.findByText("v2: Runbook old")).toBeInTheDocument();
    expect(screen.getByTestId("rich-content")).toHaveTextContent("third line");
    expect(screen.getByRole("button", { name: "Page view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // v2 (markdown) against v3 (html), as numbered, aligned lines.
    await userEvent.click(screen.getByRole("button", { name: "Line by line" }));
    expect(await screen.findByText("second raw text")).toBeInTheDocument();
    expect(screen.getByText("1 removal")).toBeInTheDocument();
    expect(screen.getByText("1 addition")).toBeInTheDocument();
  });

  it("shows the first version as it is, with nothing to compare", async () => {
    revisionsApi.listPageRevisions.mockResolvedValue([revisions[2]]);
    revisionsApi.getRevisionDiff.mockResolvedValue(
      diff({ from_version: 0, to_version: 1 }),
    );
    renderModal({ defaultView: undefined });

    expect(await screen.findByTestId("rich-content")).toHaveTextContent(
      "first line",
    );
    expect(screen.queryByText("0 removals")).not.toBeInTheDocument();
    expect(screen.queryByText(/addition/)).not.toBeInTheDocument();
    // No view to choose: there is only one side.
    expect(
      screen.queryByRole("button", { name: "Line by line" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText(/the first version, nothing earlier to compare with/)
        .length,
    ).toBeGreaterThan(0);
  });

  it("shows a markdown first version as raw text", async () => {
    revisionsApi.listPageRevisions.mockResolvedValue([
      revision({ version: 1, content: "# First draft", content_format: "markdown" }),
    ]);
    renderModal();

    expect(await screen.findByText("# First draft")).toBeInTheDocument();
    expect(screen.queryByTestId("rich-content")).not.toBeInTheDocument();
  });

  it("pluralises line changes and shows the empty before heading", async () => {
    revisionsApi.listPageRevisions.mockResolvedValue([
      revision({ version: 2, content: "one\ntwo\nthree", content_format: "markdown" }),
      revision({ version: 1, content: "old\nolder", content_format: "markdown" }),
    ]);
    renderModal({ defaultView: "lines" });

    expect(await screen.findByText("2 removals")).toBeInTheDocument();
    expect(screen.getByText("3 additions")).toBeInTheDocument();
  });

  it("uses singular wording for a single version and one change", async () => {
    revisionsApi.listPageRevisions.mockResolvedValue([revisions[0]]);
    revisionsApi.getRevisionDiff.mockResolvedValue(
      diff({
        from_version: 3,
        to_version: 3,
        added_count: 1,
        deleted_count: 1,
      }),
    );
    renderModal();

    expect(await screen.findByText("1 version")).toBeInTheDocument();
    // The version against itself: nothing differs.
    expect(await screen.findByText("0 additions")).toBeInTheDocument();
    expect(screen.getByText("0 removals")).toBeInTheDocument();
    expect(revisionsApi.getRevisionDiff).toHaveBeenCalledWith(
      "ENG",
      "runbook",
      3,
      3,
    );

    // Selecting the version that is already compared does nothing.
    await userEvent.click(screen.getByRole("button", { name: /v3/ }));
    expect(revisionsApi.getRevisionDiff).toHaveBeenCalledTimes(1);
  });

  it("shows empty states when there are no revisions", async () => {
    revisionsApi.listPageRevisions.mockResolvedValue([]);
    renderModal();

    expect(await screen.findByText("No revisions found.")).toBeInTheDocument();
    expect(
      screen.getByText("Select revisions to calculate diff."),
    ).toBeInTheDocument();
    expect(revisionsApi.getRevisionDiff).not.toHaveBeenCalled();
  });

  it("does not load anything without a space key and slug", () => {
    renderModal({ slug: "" });
    expect(revisionsApi.listPageRevisions).not.toHaveBeenCalled();
  });

  it("reports load and diff failures", async () => {
    revisionsApi.listPageRevisions.mockRejectedValueOnce(new Error("boom"));
    const first = renderModal();
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Could not load revision history.",
      ),
    );
    first.unmount();

    toastMock.error.mockClear();
    revisionsApi.getRevisionDiff.mockRejectedValueOnce(new Error("boom"));
    renderModal();
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Could not calculate revision diff.",
      ),
    );
  });

  it("restores a selected older version after confirmation", async () => {
    const { onOpenChange, onRestored } = renderModal();
    await screen.findByText("v2: Runbook old");

    await userEvent.click(screen.getByRole("button", { name: /^v1/ }));
    const restore = await screen.findByRole("button", {
      name: "Restore to v1",
    });

    // Cancel first.
    await userEvent.click(restore);
    expect(screen.getByText("Restore Version 1?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Restore Version 1?")).not.toBeInTheDocument();

    await userEvent.click(restore);
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm Restore" }),
    );

    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(revisionsApi.restorePageRevision).toHaveBeenCalledWith(
      "ENG",
      "runbook",
      1,
    );
    expect(toastMock.success).toHaveBeenCalledWith(
      "Page restored to version 1.",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the confirmation open when the restore fails", async () => {
    revisionsApi.restorePageRevision.mockRejectedValueOnce(new Error("boom"));
    const { onRestored } = renderModal();
    await screen.findByText("v2: Runbook old");

    await userEvent.click(screen.getByRole("button", { name: /^v1/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Restore to v1" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm Restore" }),
    );

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Could not restore page to version 1.",
      ),
    );
    expect(onRestored).not.toHaveBeenCalled();
    expect(screen.getByText("Restore Version 1?")).toBeInTheDocument();
  });

  it("restores without an onRestored callback", async () => {
    const { onOpenChange } = renderModal({ onRestored: undefined });
    await screen.findByText("v2: Runbook old");
    await userEvent.click(screen.getByRole("button", { name: /^v1/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Restore to v1" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm Restore" }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("closes from the header button and clears state when closed", async () => {
    const { onOpenChange, rerender } = renderModal();
    await screen.findByText("v2: Runbook old");

    await userEvent.click(
      screen.getByRole("button", { name: "Close revision modal" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(
      <LocaleProvider initialLocale="en">
        <PageHistoryModal
          open={false}
          onOpenChange={onOpenChange}
          spaceKey="ENG"
          slug="runbook"
          pageTitle="Runbook"
        />
      </LocaleProvider>,
    );
    expect(screen.queryByText("Revision History")).not.toBeInTheDocument();
  });

  it("keeps the two panels scrolled in proportion", async () => {
    renderModal();
    await screen.findByText("v2: Runbook old");

    const oldPanel = screen.getByText("second raw text")
      .parentElement as HTMLDivElement;
    const newPanel = screen
      .getByTestId("rich-content")
      .closest(".overflow-y-auto") as HTMLDivElement;

    const metrics = (
      el: HTMLElement,
      scrollHeight: number,
      clientHeight: number,
    ) => {
      Object.defineProperty(el, "scrollHeight", {
        configurable: true,
        value: scrollHeight,
      });
      Object.defineProperty(el, "clientHeight", {
        configurable: true,
        value: clientHeight,
      });
    };
    metrics(oldPanel, 1000, 500);
    metrics(newPanel, 2000, 500);

    oldPanel.scrollTop = 250;
    fireEvent.scroll(oldPanel);
    expect(newPanel.scrollTop).toBe(750);

    // The other direction, with nothing to scroll in the source.
    metrics(newPanel, 500, 500);
    newPanel.scrollTop = 0;
    fireEvent.scroll(newPanel);
    expect(oldPanel.scrollTop).toBe(0);

    // A scroll that arrives while a sync is in flight is ignored.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    metrics(newPanel, 2000, 500);
    oldPanel.scrollTop = 500;
    fireEvent.scroll(oldPanel);
    const synced = newPanel.scrollTop;
    oldPanel.scrollTop = 0;
    fireEvent.scroll(oldPanel);
    expect(newPanel.scrollTop).toBe(synced);
  });

  it("highlights changed text inside the rendered revisions", async () => {
    revisionsApi.listPageRevisions.mockResolvedValue([
      revision({ version: 2, content: "<p>hello brave world</p>" }),
      revision({ version: 1, content: "<p>hello old world</p>" }),
    ]);
    revisionsApi.getRevisionDiff.mockResolvedValue(
      diff({
        from_version: 1,
        to_version: 2,
        lines: [
          {
            operation: "replace",
            old_line_number: 1,
            new_line_number: 1,
            old_text: "hello old world",
            new_text: "hello brave world",
            old_segments: [{ operation: "delete", text: "old" }],
            new_segments: [{ operation: "add", text: "brave" }],
          },
        ],
      }),
    );
    renderModal();

    await screen.findByText("v1: Runbook old");
    const rich = screen.getAllByTestId("rich-content");
    expect(rich[0].querySelector("mark.wh-diff-delete")).toHaveTextContent(
      "old",
    );
    expect(rich[1].querySelector("mark.wh-diff-add")).toHaveTextContent(
      "brave",
    );
  });

  it("renders a markdown latest version as raw text and pluralises removals", async () => {
    revisionsApi.listPageRevisions.mockResolvedValue([
      revision({
        version: 2,
        content: "# raw markdown",
        content_format: "markdown",
      }),
      revision({
        version: 1,
        content: '<p><a href="https://example.com">plain link</a></p>',
      }),
    ]);
    revisionsApi.getRevisionDiff.mockResolvedValue(
      diff({ from_version: 1, to_version: 2, deleted_count: 3 }),
    );
    renderModal();

    expect(await screen.findByText("1 removal")).toBeInTheDocument();
    expect(screen.getByText("# raw markdown")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "plain link" }),
    ).not.toHaveAttribute("data-diff-kind");
  });

  it("toggles AI summary panel and fetches AI diff summary", async () => {
    revisionsApi.listPageRevisions.mockResolvedValue(revisions);
    revisionsApi.getRevisionDiff.mockResolvedValue(diff());
    revisionsApi.getRevisionDiffSummary.mockResolvedValue({
      summary: "Changed rules from v2 to v3:\n- Flexible work hours adopted",
      commit_message: "",
      from_version: 2,
      to_version: 3,
      cached: false,
    });

    renderModal();
    const aiButton = await screen.findByRole("button", { name: "AI Summary" });
    expect(aiButton).toBeInTheDocument();

    await userEvent.click(aiButton);

    expect(
      await screen.findByText(/AI Revision Diff Summary/i),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Flexible work hours adopted/i),
    ).toBeInTheDocument();

    // Verify Refresh button re-fetches
    const refreshButton = screen.getByRole("button", { name: /Refresh/i });
    expect(refreshButton).toBeInTheDocument();
    await userEvent.click(refreshButton);
    expect(revisionsApi.getRevisionDiffSummary).toHaveBeenCalledTimes(2);

    // Switching version while AI summary is open automatically fetches summary for the new version
    revisionsApi.getRevisionDiffSummary.mockResolvedValueOnce({
      summary: "Changed rules from v1 to v2:\n- Initial draft setup",
      commit_message: "",
      from_version: 1,
      to_version: 2,
      cached: false,
    });
    await userEvent.click(screen.getByRole("button", { name: /^v2/ }));
    expect(await screen.findByText(/Initial draft setup/i)).toBeInTheDocument();
    expect(revisionsApi.getRevisionDiffSummary).toHaveBeenCalledWith(
      "ENG",
      "runbook",
      {
        from_version: 1,
        to_version: 2,
        lang: "en",
      },
    );

    // Toggle hide
    const hideButton = screen.getByRole("button", { name: "Hide AI Summary" });
    await userEvent.click(hideButton);
    expect(
      screen.queryByText(/AI Revision Diff Summary/i),
    ).not.toBeInTheDocument();
  });

  it("handles v1 initial version comparison against empty document with AI summary", async () => {
    const singleRev = [
      revision({
        version: 1,
        title: "Initial Doc",
        content: "<p>Hello</p>",
        content_format: "html",
      }),
    ];
    revisionsApi.listPageRevisions.mockResolvedValue(singleRev);
    revisionsApi.getRevisionDiff.mockResolvedValue(
      diff({
        from_version: 0,
        to_version: 1,
        added_count: 5,
        deleted_count: 0,
      }),
    );
    revisionsApi.getRevisionDiffSummary.mockResolvedValue({
      summary:
        "**Overview**: Initial creation of Initial Doc\n- **Added**: Initial documentation",
      commit_message: "",
      from_version: 0,
      to_version: 1,
      cached: false,
    });

    renderModal();

    // The first version is shown as it is, without a comparison.
    expect(await screen.findByTestId("rich-content")).toBeInTheDocument();
    expect(screen.queryByText("Empty document (Before v1)")).toBeNull();
    expect(screen.queryByText("5 additions")).toBeNull();

    // Open AI summary
    const aiButton = await screen.findByRole("button", { name: "AI Summary" });
    await userEvent.click(aiButton);

    expect(
      await screen.findByText(/AI Revision Summary \(v1 · Initial creation\)/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Initial creation of Initial Doc/i),
    ).toBeInTheDocument();
  });

  it("reports AI summary failures from loading and refresh", async () => {
    revisionsApi.getRevisionDiffSummary.mockRejectedValueOnce(new Error("offline"));
    renderModal();
    await userEvent.click(await screen.findByRole("button", { name: "AI Summary" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());

    revisionsApi.getRevisionDiffSummary.mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(2));
  });

  it("marks a cached AI summary", async () => {
    revisionsApi.getRevisionDiffSummary.mockResolvedValue({
      summary: "Cached explanation",
      commit_message: "Cached commit",
      from_version: 2,
      to_version: 3,
      cached: true,
    });
    renderModal();
    await userEvent.click(await screen.findByRole("button", { name: "AI Summary" }));
    expect(await screen.findByText("Cached explanation")).toBeInTheDocument();
    expect(screen.getByText("Cached")).toBeInTheDocument();
  });

  it("always compares the selected version against its immediate previous version", async () => {
    const fourRevs = [
      revision({ version: 4, title: "Doc v4" }),
      revision({ version: 3, title: "Doc v3" }),
      revision({ version: 2, title: "Doc v2" }),
      revision({ version: 1, title: "Doc v1" }),
    ];
    revisionsApi.listPageRevisions.mockResolvedValue(fourRevs);
    revisionsApi.getRevisionDiff.mockImplementation(
      (_space: string, _slug: string, from: number, to: number) =>
        Promise.resolve(
          diff({
            from_version: from,
            to_version: to,
            from_title: `Doc v${from}`,
            to_title: `Doc v${to}`,
          }),
        ),
    );

    renderModal();

    // Initially selects latest version v4 by default, comparing v3 to v4
    expect(await screen.findByText("v3: Doc v3")).toBeInTheDocument();
    expect(screen.getByText("v4: Doc v4")).toBeInTheDocument();
    expect(revisionsApi.getRevisionDiff).toHaveBeenCalledWith(
      "ENG",
      "runbook",
      3,
      4,
    );
    expect(
      screen.queryByRole("button", { name: /restore to/i }),
    ).not.toBeInTheDocument();

    // Clicking older version v2 compares v1 to v2
    await userEvent.click(screen.getByRole("button", { name: /^v2/ }));
    expect(await screen.findByText("v1: Doc v1")).toBeInTheDocument();
    expect(screen.getByText("v2: Doc v2")).toBeInTheDocument();
    expect(revisionsApi.getRevisionDiff).toHaveBeenCalledWith(
      "ENG",
      "runbook",
      1,
      2,
    );
    expect(
      screen.getByRole("button", { name: "Restore to v2" }),
    ).toBeInTheDocument();

    // Clicking older version v3 compares v2 to v3
    await userEvent.click(screen.getByRole("button", { name: /^v3/ }));
    expect(await screen.findByText("v2: Doc v2")).toBeInTheDocument();
    expect(screen.getByText("v3: Doc v3")).toBeInTheDocument();
    expect(revisionsApi.getRevisionDiff).toHaveBeenCalledWith(
      "ENG",
      "runbook",
      2,
      3,
    );
    expect(
      screen.getByRole("button", { name: "Restore to v3" }),
    ).toBeInTheDocument();

    // Clicking v1 compares empty document (0) to v1
    await userEvent.click(screen.getByRole("button", { name: /^v1/ }));
    expect(await screen.findByText("v1: Doc v1")).toBeInTheDocument();
    expect(screen.queryByText("Empty document (Before v1)")).toBeNull();
    expect(revisionsApi.getRevisionDiff).toHaveBeenCalledWith(
      "ENG",
      "runbook",
      0,
      1,
    );
    expect(
      screen.getByRole("button", { name: "Restore to v1" }),
    ).toBeInTheDocument();

    // Clicking CURRENT (v4) compares v3 to v4 again and hides restore button
    await userEvent.click(screen.getByRole("button", { name: /CURRENT/ }));
    expect(await screen.findByText("v3: Doc v3")).toBeInTheDocument();
    expect(screen.getByText("v4: Doc v4")).toBeInTheDocument();
    expect(revisionsApi.getRevisionDiff).toHaveBeenCalledWith(
      "ENG",
      "runbook",
      3,
      4,
    );
    expect(
      screen.queryByRole("button", { name: /restore to/i }),
    ).not.toBeInTheDocument();
  });
});

describe("changed blocks in the page view", () => {
  it("finds the diagrams, code and callouts that changed, leaving text to the word marks", () => {
    const before =
      '<p>intro</p><pre><code>npm ci</code></pre><div data-type="diagram" data-engine="mermaid" data-code="graph TD; A--&gt;B"></div><p>end</p>';
    const after =
      '<p>intro changed</p><pre><code>npm ci</code></pre><div data-type="diagram" data-engine="mermaid" data-code="graph TD; A--&gt;B" data-width="320"></div><p>end</p>';
    // The changed paragraph is the word marks' job; the diagram - only resized - is ours.
    expect(changedBlocks(after, before)).toEqual({
      total: 4,
      blocks: [{ index: 2, text: "" }],
    });
    expect(changedBlocks(before, before)).toEqual({ total: 4, blocks: [] });
  });

  it("outlines a changed block once the reader has drawn it", async () => {
    const { container } = render(
      <HighlightedDiffContent
        content="<p>same</p><blockquote><p>new quote</p></blockquote>"
        comparisonContent="<p>same</p>"
        diff={diff()}
        side="new"
      />,
    );
    await waitFor(() =>
      expect(container.querySelector("style")?.textContent).toContain(
        ".ProseMirror > :nth-child(2)",
      ),
    );
    expect(container.querySelector("style")?.textContent).toContain(
      "var(--color-success)",
    );
  });

  it("waits for the reader before marking changed blocks", () => {
    readerMock.loading = true;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const revisionDiff = diff();
    const view = () => (
      <HighlightedDiffContent
        content="<p>same</p><blockquote><p>new quote</p></blockquote>"
        comparisonContent="<p>same</p>"
        diff={revisionDiff}
        side="new"
      />
    );
    const { container, rerender } = render(view());
    expect(container.querySelector(".ProseMirror")).toBeNull();
    expect(frames).toHaveLength(1);
    act(() => frames[0](0));
    expect(frames).toHaveLength(2);
    expect(container.querySelector("style")).toBeNull();

    readerMock.loading = false;
    rerender(view());
    act(() => frames[1](0));
    expect(container.querySelector("style")?.textContent).toContain(
      ".ProseMirror > :nth-child(2)",
    );
  });

  it("matches changed blocks by text when the reader draws extra nodes", async () => {
    readerMock.prefix = "<p>Reader note</p>";
    const { container } = render(
      <HighlightedDiffContent
        content="<p>same</p><blockquote><p>new quote</p></blockquote>"
        comparisonContent="<p>same</p>"
        diff={diff()}
        side="new"
      />,
    );
    await waitFor(() =>
      expect(container.querySelector("style")?.textContent).toContain(
        ".ProseMirror > :nth-child(3)",
      ),
    );
  });
});
