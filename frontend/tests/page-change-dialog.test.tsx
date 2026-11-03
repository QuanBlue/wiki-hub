import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { markupChanges } from "@/components/pages/line-diff";
import {
  PageChangeDialog,
  changeVersions,
} from "@/components/pages/page-change-dialog";
import { LocaleProvider } from "@/lib/i18n/context";
import { listPageRevisions } from "@/lib/revisions";
import type { PageRevisionItem } from "@/types/api";

vi.mock("@/lib/revisions", () => ({ listPageRevisions: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

function revision(
  version: number,
  content: string,
  at: string,
): PageRevisionItem {
  return {
    id: `r${version}`,
    page_id: "p",
    version,
    title: "Runbook",
    content,
    content_format: "html",
    created_at: at,
    change_summary: null,
    created_by_username: "ann",
    created_by_full_name: "Ann Lee",
  };
}

const revisions = [
  revision(3, "<p>Port 443</p><p>Ask HR</p>", "2026-10-03T10:00:00Z"),
  revision(2, "<p>Port 80</p><p>Ask HR</p>", "2026-10-02T10:00:00Z"),
  revision(1, "<p>Port 80</p>", "2026-10-01T10:00:00Z"),
];

function renderDialog(at: string, onOpenHistory = vi.fn()) {
  render(
    <LocaleProvider initialLocale="en">
      <PageChangeDialog
        open
        onOpenChange={() => {}}
        spaceKey="ENG"
        slug="runbook"
        pageTitle="Runbook"
        at={at}
        onOpenHistory={onOpenHistory}
      />
    </LocaleProvider>,
  );
  return { onOpenHistory };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listPageRevisions).mockResolvedValue(revisions);
});

describe("PageChangeDialog", () => {
  it("picks the version a change saved and the one before it", () => {
    expect(
      changeVersions(revisions, "2026-10-02T10:00:20Z")?.after.version,
    ).toBe(2);
    expect(
      changeVersions(revisions, "2026-10-02T10:00:20Z")?.before?.version,
    ).toBe(1);
    expect(
      changeVersions(revisions, "2026-10-01T10:00:00Z")?.before,
    ).toBeNull();
    expect(changeVersions([], "2026-10-01T10:00:00Z")).toBeNull();
  });

  it("shows only that change, line by line, with the full history a click away", async () => {
    const { onOpenHistory } = renderDialog("2026-10-03T10:00:05Z");

    expect(
      await screen.findByText(
        "What this change did: version 2 against version 3, line by line.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("1 removal")).toBeInTheDocument();
    expect(screen.getByText("1 addition")).toBeInTheDocument();
    expect(screen.getByText("80")).toHaveClass("bg-danger/25");
    expect(screen.getByText("443")).toHaveClass("bg-success/25");
    expect(screen.getAllByText("Ask HR")).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Full history" }));
    expect(onOpenHistory).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open page" })).toHaveAttribute(
      "href",
      "/spaces/ENG/pages/runbook",
    );
  });

  it("says when the change created the page", async () => {
    renderDialog("2026-10-01T10:00:00Z");
    expect(
      await screen.findByText(
        "This change created the page: everything in it is new.",
      ),
    ).toBeInTheDocument();
    // Nothing to compare: the page as it is, not a diff against nothing.
    expect(screen.queryByText("0 removals")).not.toBeInTheDocument();
    expect(await screen.findByText("Port 80", {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it("shows a plain-text first revision with a fallback author and no history action", async () => {
    vi.mocked(listPageRevisions).mockResolvedValue([
      { ...revision(1, "# First draft", "2026-10-01T10:00:00Z"), content_format: "markdown", created_by_full_name: null, created_by_username: "author" },
    ]);
    render(
      <LocaleProvider initialLocale="en">
        <PageChangeDialog open onOpenChange={() => {}} spaceKey="ENG" slug="runbook" pageTitle="Runbook" at="2026-10-01T10:00:00Z" />
      </LocaleProvider>,
    );
    expect(await screen.findByText("# First draft")).toBeInTheDocument();
    expect(screen.getByText(/author/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Full history" })).not.toBeInTheDocument();
  });

  it("uses the system label when revision author details are absent", async () => {
    vi.mocked(listPageRevisions).mockResolvedValue([
      { ...revision(1, "<p>Start</p>", "2026-10-01T10:00:00Z"), created_by_full_name: null, created_by_username: null },
    ]);
    renderDialog("2026-10-01T10:00:00Z");
    expect(await screen.findByText("System", { exact: false })).toBeInTheDocument();
  });

  it("says why a version with the same words was saved", async () => {
    vi.mocked(listPageRevisions).mockResolvedValue([
      revision(
        2,
        '<table><tr><td colwidth="129">Port</td></tr></table>',
        "2026-10-02T10:00:00Z",
      ),
      revision(
        1,
        '<table><tr><td colwidth="166">Port</td></tr></table>',
        "2026-10-01T10:00:00Z",
      ),
    ]);
    renderDialog("2026-10-02T10:00:00Z");

    expect(
      await screen.findByText("The words are the same."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "table column widths or cell spans",
    );
  });

  it("tells formatting, links and other attributes apart", () => {
    expect(markupChanges("<p>a</p>", "<p>a</p>")).toEqual([]);
    expect(markupChanges("<p>a</p>", "<p><b>a</b></p>")).toEqual([
      "formatting",
    ]);
    expect(
      markupChanges('<a href="x">a</a>', '<a href="y" data-k="1">a</a>'),
    ).toEqual(["links", "attributes"]);
    expect(markupChanges("<p>a</p>", "<p>a</p> ")).toEqual(["formatting"]);
  });

  it("says when the change could not be loaded", async () => {
    vi.mocked(listPageRevisions).mockRejectedValue(new Error("down"));
    renderDialog("2026-10-01T10:00:00Z");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be loaded",
    );
  });
});
