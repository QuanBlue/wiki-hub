import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PageHistoryModal } from "@/components/pages/page-history-modal";
import { LocaleProvider } from "@/lib/i18n/context";
import type { PageRevisionDiff, PageRevisionItem } from "@/types/api";

const revisionsApi = vi.hoisted(() => ({
  listPageRevisions: vi.fn(),
  getRevisionDiff: vi.fn(),
  restorePageRevision: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/revisions", () => revisionsApi);
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/users/user-profile-trigger", () => ({
  UserProfileTrigger: ({ username }: { username: string }) => (
    <span data-testid="author-trigger">{username}</span>
  ),
}));
vi.mock("@/components/pages/rich-text-editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/pages/rich-text-editor")>()),
  RichTextContent: ({ content }: { content: string }) => (
    <div data-testid="rich-content" dangerouslySetInnerHTML={{ __html: content }} />
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
        {...props}
      />
    </LocaleProvider>,
  );
  return { ...utils, onOpenChange, onRestored };
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
  });
  revisionsApi.listPageRevisions.mockResolvedValue(revisions);
  revisionsApi.getRevisionDiff.mockResolvedValue(diff());
  revisionsApi.restorePageRevision.mockResolvedValue({});
});

describe("PageHistoryModal", () => {
  it("lists the revisions and compares the latest two by default", async () => {
    renderModal();

    expect(await screen.findByText("3 versions")).toBeInTheDocument();
    expect(screen.getByText("CURRENT")).toBeInTheDocument();
    expect(screen.getByText("Reworded intro", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("Updated content", { exact: false })).not.toBeInTheDocument();
    // v3 by name, v2 by username fallback ("system"), v1 as the System label.
    expect(screen.getAllByText("Alice Nguyen").length).toBeGreaterThan(0);
    expect(screen.getAllByText("system").length).toBeGreaterThan(0);
    expect(screen.getAllByText("System").length).toBeGreaterThan(0);

    expect(await screen.findByText("v2: Runbook old")).toBeInTheDocument();
    expect(screen.getByText("v3: Runbook new")).toBeInTheDocument();
    expect(screen.getByText("1 removal")).toBeInTheDocument();
    expect(screen.getByText("2 additions")).toBeInTheDocument();
    expect(revisionsApi.getRevisionDiff).toHaveBeenCalledWith("ENG", "runbook", 2, 3);
    // v2 is markdown (raw text), v3 is html (rich renderer).
    expect(screen.getByText("second raw text")).toBeInTheDocument();
    expect(screen.getByTestId("rich-content")).toHaveTextContent("third line");
    // The latest version has nothing to restore to.
    expect(screen.queryByRole("button", { name: /restore to/i })).not.toBeInTheDocument();
  });

  it("uses singular wording for a single version and one change", async () => {
    revisionsApi.listPageRevisions.mockResolvedValue([revisions[0]]);
    revisionsApi.getRevisionDiff.mockResolvedValue(
      diff({ from_version: 3, to_version: 3, added_count: 1, deleted_count: 1 }),
    );
    renderModal();

    expect(await screen.findByText("1 version")).toBeInTheDocument();
    expect(await screen.findByText("1 addition")).toBeInTheDocument();
    expect(screen.getByText("1 removal")).toBeInTheDocument();
    expect(revisionsApi.getRevisionDiff).toHaveBeenCalledWith("ENG", "runbook", 3, 3);

    // Selecting the version that is already compared does nothing.
    await userEvent.click(screen.getByRole("button", { name: /v3/ }));
    expect(revisionsApi.getRevisionDiff).toHaveBeenCalledTimes(1);
  });

  it("shows empty states when there are no revisions", async () => {
    revisionsApi.listPageRevisions.mockResolvedValue([]);
    renderModal();

    expect(await screen.findByText("No revisions found.")).toBeInTheDocument();
    expect(screen.getByText("Select revisions to calculate diff.")).toBeInTheDocument();
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
      expect(toastMock.error).toHaveBeenCalledWith("Could not load revision history."),
    );
    first.unmount();

    toastMock.error.mockClear();
    revisionsApi.getRevisionDiff.mockRejectedValueOnce(new Error("boom"));
    renderModal();
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Could not calculate revision diff."),
    );
  });

  it("restores a selected older version after confirmation", async () => {
    const { onOpenChange, onRestored } = renderModal();
    await screen.findByText("v2: Runbook old");

    await userEvent.click(screen.getByRole("button", { name: /^v1/ }));
    const restore = await screen.findByRole("button", { name: "Restore to v1" });

    // Cancel first.
    await userEvent.click(restore);
    expect(screen.getByText("Restore Version 1?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Restore Version 1?")).not.toBeInTheDocument();

    await userEvent.click(restore);
    await userEvent.click(screen.getByRole("button", { name: "Confirm Restore" }));

    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(revisionsApi.restorePageRevision).toHaveBeenCalledWith("ENG", "runbook", 1);
    expect(toastMock.success).toHaveBeenCalledWith("Page restored to version 1.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the confirmation open when the restore fails", async () => {
    revisionsApi.restorePageRevision.mockRejectedValueOnce(new Error("boom"));
    const { onRestored } = renderModal();
    await screen.findByText("v2: Runbook old");

    await userEvent.click(screen.getByRole("button", { name: /^v1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Restore to v1" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm Restore" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Could not restore page to version 1."),
    );
    expect(onRestored).not.toHaveBeenCalled();
    expect(screen.getByText("Restore Version 1?")).toBeInTheDocument();
  });

  it("restores without an onRestored callback", async () => {
    const { onOpenChange } = renderModal({ onRestored: undefined });
    await screen.findByText("v2: Runbook old");
    await userEvent.click(screen.getByRole("button", { name: /^v1/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Restore to v1" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm Restore" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("closes from the header button and clears state when closed", async () => {
    const { onOpenChange, rerender } = renderModal();
    await screen.findByText("v2: Runbook old");

    await userEvent.click(screen.getByRole("button", { name: "Close revision modal" }));
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

    const oldPanel = screen.getByText("second raw text").parentElement as HTMLDivElement;
    const newPanel = screen.getByTestId("rich-content").closest(
      ".overflow-y-auto",
    ) as HTMLDivElement;

    const metrics = (el: HTMLElement, scrollHeight: number, clientHeight: number) => {
      Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
      Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
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
    expect(rich[0].querySelector("mark.wh-diff-delete")).toHaveTextContent("old");
    expect(rich[1].querySelector("mark.wh-diff-add")).toHaveTextContent("brave");
  });

  it("renders a markdown latest version as raw text and pluralises removals", async () => {
    revisionsApi.listPageRevisions.mockResolvedValue([
      revision({ version: 2, content: "# raw markdown", content_format: "markdown" }),
      revision({
        version: 1,
        content: '<p><a href="https://example.com">plain link</a></p>',
      }),
    ]);
    revisionsApi.getRevisionDiff.mockResolvedValue(
      diff({ from_version: 1, to_version: 2, deleted_count: 3 }),
    );
    renderModal();

    expect(await screen.findByText("3 removals")).toBeInTheDocument();
    expect(screen.getByText("# raw markdown")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "plain link" })).not.toHaveAttribute(
      "data-diff-kind",
    );
  });
});
