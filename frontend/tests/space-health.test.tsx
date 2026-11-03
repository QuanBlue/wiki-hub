import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";

import { SpaceHealthDialog } from "@/components/pages/space-health";
import { aiStatus } from "@/lib/ai-summary";
import { api, ApiError } from "@/lib/api-client";
import {
  checkStalePage,
  daysSince,
  firstBusyTab,
  diffBlocks,
  rowsToRevisionDiff,
  wordSegments,
  healthCounts,
  issueTotal,
  pageBlocks,
  pageTextLines,
  parseConflictTable,
  healthPageHref,
} from "@/lib/space-health";
import type { HealthPage, Space, SpaceHealth } from "@/types/api";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("@/lib/ai-summary", () => ({ aiStatus: vi.fn() }));
vi.mock("@/components/pages/rich-text-editor", () => ({
  RichTextContent: ({ content }: { content: string }) => (
    <div dangerouslySetInnerHTML={{ __html: content }} />
  ),
  // What the page history's highlighter uses, as pass-throughs.
  linkifyPlainTextUrls: (content: string) => content,
  normalizeConfluenceCodeMacros: (content: string) => content,
  readerClassName: "",
  // No reader model in this test: the changed blocks are found from the HTML.
  readOnlyEditorExtensions: undefined,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const space = { key: "OPS", name: "Operations" } as Space;
const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();

function page(
  id: string,
  title: string,
  extra: Partial<HealthPage> = {},
): HealthPage {
  return {
    id,
    title,
    slug: title.toLowerCase().replace(/ /g, "-"),
    space_key: "OPS",
    space_name: "Operations",
    updated_at: old,
    ...extra,
  };
}

function report(extra: Partial<SpaceHealth> = {}): SpaceHealth {
  return {
    stale_days: 180,
    recent_days: 90,
    stale: [],
    stale_total: 0,
    broken_links: [],
    broken_total: 0,
    orphans: [],
    orphans_total: 0,
    duplicates: [],
    duplicates_total: 0,
    conflicts: [],
    conflicts_total: 0,
    semantic: true,
    ...extra,
  };
}

const staleReport = report({
  stale: [
    {
      page: page("1", "VPN setup"),
      reviewed_at: null,
      newer: [page("2", "Network changes", { updated_at: recent })],
      newer_count: 1,
    },
  ],
  stale_total: 1,
  broken_links: [
    {
      page: page("3", "Hub"),
      href: "/spaces/OPS/pages/never-was",
      target_space_key: "OPS",
      target_slug: "never-was",
      target_title: null,
      reason: "missing",
    },
    {
      page: page("3", "Hub"),
      href: "/spaces/OPS/pages/gone",
      target_space_key: "OPS",
      target_slug: "gone",
      target_title: "Gone page",
      reason: "trashed",
    },
  ],
  broken_total: 2,
  orphans: [page("4", "Forgotten corner")],
  orphans_total: 1,
  duplicates: [
    {
      kind: "title",
      similarity: null,
      pages: [page("5", "Checklist"), page("6", "Checklist (2)")],
    },
    {
      kind: "content",
      similarity: 0.95,
      pages: [
        page("7", "Pay day"),
        page("8", "Wages", { space_key: "HR", space_name: "People" }),
      ],
    },
  ],
  duplicates_total: 2,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(aiStatus).mockResolvedValue({ enabled: true, can_configure: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("space health helpers", () => {
  it("counts, picks the first list with work and links pages", () => {
    expect(healthCounts(staleReport)).toEqual({
      stale: 1,
      broken: 2,
      orphans: 1,
      duplicates: 2,
      conflicts: 0,
    });
    expect(firstBusyTab(staleReport)).toBe("stale");
    expect(firstBusyTab(report({ orphans_total: 3 }))).toBe("orphans");
    expect(firstBusyTab(report())).toBe("stale");
    // Pairs to compare are not problems: they neither open their tab nor add to the total.
    expect(firstBusyTab(report({ conflicts_total: 40 }))).toBe("stale");
    expect(issueTotal(report({ conflicts_total: 40 }))).toBe(0);
    expect(issueTotal(staleReport)).toBe(6);
    expect(healthPageHref({ space_key: "A B", slug: "x/y" })).toBe(
      "/spaces/A%20B/pages/x%2Fy",
    );
    expect(daysSince(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe(
      3,
    );
  });

  it("asks for the comparison in the reader's language, English otherwise", async () => {
    vi.mocked(api.post).mockResolvedValue({
      result: "",
      compared: [],
      cached: false,
    });
    await checkStalePage("OPS", "vpn", "vi");
    await checkStalePage("OPS", "vpn", "fr");
    expect(vi.mocked(api.post).mock.calls.map((call) => call[1])).toEqual([
      { locale: "vi" },
      { locale: "en" },
    ]);
  });
});

describe("SpaceHealthDialog", () => {
  it("opens on the first list with something in it, with a count on every tab", async () => {
    vi.mocked(api.get).mockResolvedValue(
      report({ broken_links: staleReport.broken_links, broken_total: 2 }),
    );
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    const broken = await screen.findByRole("tab", { name: /Broken links/ });
    expect(broken).toHaveAttribute("aria-selected", "true");
    expect(broken).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /Out of date/ })).toHaveTextContent(
      "0",
    );
    expect(api.get).toHaveBeenCalledWith(
      "/api/v1/spaces/OPS/health?stale_days=180",
    );
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.getByText("In the Trash")).toBeInTheDocument();
    expect(screen.getByText("/spaces/OPS/pages/never-was")).toBeInTheDocument();
    expect(screen.getByText(/Gone page/)).toBeInTheDocument();
  });

  it("lists a stale page with the newer pages, and asks the AI to compare them", async () => {
    vi.mocked(api.get).mockResolvedValue(staleReport);
    vi.mocked(api.post).mockResolvedValue({
      result: '- "vpn1" - **Network changes** says vpn2.',
      compared: [page("2", "Network changes")],
      cached: false,
    });
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await screen.findByRole("button", { name: "VPN setup" });
    expect(
      screen.getByText("1 related page was edited since:"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Network changes" }),
    ).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Check with AI" }));

    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/spaces/OPS/pages/vpn-setup/stale-check",
      {
        locale: "en",
      },
    );
    expect(await screen.findByText("AI comparison")).toBeInTheDocument();
    expect(screen.getByText(/says vpn2/)).toBeInTheDocument();
  });

  it("says why the AI check could not run", async () => {
    vi.mocked(api.get).mockResolvedValue(staleReport);
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(429, "rate_limited", "Too many"),
    );
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(
      await screen.findByRole("button", { name: "Check with AI" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You have reached your AI limit",
    );
  });

  it("offers no AI check when the assistant is off", async () => {
    vi.mocked(aiStatus).mockResolvedValue({
      enabled: false,
      can_configure: false,
    });
    vi.mocked(api.get).mockResolvedValue(staleReport);
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await screen.findByRole("button", { name: "VPN setup" });
    expect(
      screen.queryByRole("button", { name: "Check with AI" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dismiss: still accurate" }),
    ).toBeInTheDocument();
  });

  it("marks a page still correct and takes it off the list", async () => {
    vi.mocked(api.get).mockResolvedValue(staleReport);
    vi.mocked(api.post).mockResolvedValue({
      reviewed_at: new Date().toISOString(),
    });
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(
      await screen.findByRole("button", { name: "Dismiss: still accurate" }),
    );

    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/spaces/OPS/pages/vpn-setup/review",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "VPN setup" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Nothing looks out of date")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Out of date/ })).toHaveTextContent(
      "0",
    );
  });

  it("looks further back when another period is chosen", async () => {
    vi.mocked(api.get).mockResolvedValue(staleReport);
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(await screen.findByRole("button", { name: "12 months" }));

    expect(api.get).toHaveBeenLastCalledWith(
      "/api/v1/spaces/OPS/health?stale_days=365",
    );
    expect(screen.getByRole("button", { name: "12 months" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows orphans and duplicates, naming another space", async () => {
    vi.mocked(api.get).mockResolvedValue(staleReport);
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(await screen.findByRole("tab", { name: /Orphans/ }));
    expect(
      screen.getByRole("button", { name: "Forgotten corner" }),
    ).toBeInTheDocument();

    await actor.click(screen.getByRole("tab", { name: /Duplicates/ }));
    const panel = screen.getByRole("tabpanel");
    expect(
      within(panel).getByText("2 pages with the same title"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("95%")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: /Wages in People/ }),
    ).toBeInTheDocument();
  });

  it("compares two duplicate pages line by line", async () => {
    const actor = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (url: string) =>
      url.includes("/health")
        ? staleReport
        : url.endsWith("/pay-day")
          ? { content: "<p>Paid on the 5th</p><p>Bring ID</p>" }
          : { content: "<p>Paid on the 5th</p><p>Ask HR</p>" },
    );
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(await screen.findByRole("tab", { name: /Duplicates/ }));
    const panel = screen.getByRole("tabpanel");
    await actor.click(
      within(panel).getAllByRole("button", { name: "Compare" })[1],
    );
    const modal = await screen.findByRole("dialog", { name: "Compare pages" });
    expect(
      await within(modal).findByText("1 lines in both pages"),
    ).toBeInTheDocument();
    expect(within(modal).getByText("2 lines differ")).toBeInTheDocument();

    // Line by line: numbered lines, the changed words of a changed line marked.
    await actor.click(
      within(modal).getByRole("button", { name: "Line by line" }),
    );
    expect(within(modal).getAllByText("Paid on the 5th")).toHaveLength(2);
    expect(within(modal).getAllByText("2 lines")).toHaveLength(2);
    const removed = within(modal).getByText("Bring ID");
    expect(removed.tagName).toBe("MARK");
    expect(removed).toHaveClass("bg-danger/25");
    expect(within(modal).getByText("Ask HR")).toHaveClass("bg-success/25");

    // Then each page whole, side by side, marked as the page history marks it.
    await actor.click(within(modal).getByRole("button", { name: "Page view" }));
    const left = within(modal).getByRole("region", { name: "Pay day" });
    const right = within(modal).getByRole("region", { name: /Wages/ });
    expect(
      await within(left).findByText("Paid on the 5th"),
    ).toBeInTheDocument();
    expect(within(left).getByText("1 only here")).toBeInTheDocument();
    expect(left.querySelector("p.wh-diff-line-delete")?.textContent).toBe(
      "Bring ID",
    );
    expect(right.querySelector("p.wh-diff-line-add")?.textContent).toBe(
      "Ask HR",
    );
    // What both pages say is left unmarked.
    expect(right.querySelectorAll("p.wh-diff-line-add")).toHaveLength(1);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    const leftPane = left.querySelector('[class*="overflow-auto"]') as HTMLElement;
    const rightPane = right.querySelector('[class*="overflow-auto"]') as HTMLElement;
    Object.defineProperties(leftPane, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 500 } });
    Object.defineProperties(rightPane, { scrollHeight: { configurable: true, value: 2000 }, clientHeight: { configurable: true, value: 500 } });
    leftPane.scrollTop = 250;
    leftPane.scrollLeft = 30;
    fireEvent.scroll(leftPane);
    expect(rightPane.scrollTop).toBe(750);
    expect(rightPane.scrollLeft).toBe(30);
    Object.defineProperties(rightPane, { scrollHeight: { configurable: true, value: 500 }, clientHeight: { configurable: true, value: 500 } });
    rightPane.scrollTop = 0;
    fireEvent.scroll(rightPane);
    expect(leftPane.scrollTop).toBe(0);
    await actor.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Compare pages" })).toBeNull();
  });

  it("says when two pages could not be compared", async () => {
    const actor = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes("/health")) return staleReport;
      throw new Error("boom");
    });
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(await screen.findByRole("tab", { name: /Duplicates/ }));
    const panel = screen.getByRole("tabpanel");
    await actor.click(
      within(panel).getAllByRole("button", { name: "Compare" })[0],
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be compared",
    );
  });

  it("splits page html into blocks that keep their formatting", () => {
    expect(
      pageTextLines(
        "<h1>Title</h1><ul><li>one <b>two</b></li><li>three</li></ul><script>x()</script>a<br>b",
      ),
    ).toEqual(["Title", "one two", "three", "a", "b"]);
    expect(
      pageBlocks(
        '<h2>Setup</h2><p>Run <code>make up</code> on <b>prod</b>, see <a href="https://x.io/a">docs</a></p><ol><li>first</li></ol><pre>a\nb</pre>',
      ),
    ).toEqual([
      { text: "Setup", md: "## Setup" },
      {
        text: "Run make up on prod, see docs",
        md: "Run `make up` on **prod**, see [docs](https://x.io/a)",
      },
      { text: "first", md: "1. first" },
      { text: "a b", md: "```\na\nb\n```" },
    ]);
  });

  it("keeps media labels and plain links when optional attributes are absent", () => {
    const blocks = pageBlocks(
      '<p><img title="Topology" src="/topology.png"></p><p><iframe src="/embed"></iframe></p><p><a href="/local">Internal</a></p>',
    );
    expect(blocks.map((block) => block.text)).toEqual([
      "[image] Topology",
      "[embed] /embed",
      "Internal",
    ]);
    expect(blocks[2]?.md).toBe("Internal");
    expect(pageBlocks("<p><img></p>")[0]?.text).toBe("[image]");
  });

  it("uses a bounded comparison for large pages and large word changes", () => {
    const block = (text: string) => ({ text, md: text });
    const before = Array.from({ length: 2001 }, (_, i) => block(`Block ${i}`));
    const after = Array.from({ length: 2000 }, (_, i) => block(`Block ${i}`));
    expect(diffBlocks(before, after).filter((row) => row.kind === "change")).toHaveLength(1);

    const long = Array.from({ length: 401 }, (_, i) => `word${i}`).join(" ");
    expect(wordSegments(long, "replacement")).toEqual({
      old: [{ operation: "delete", text: long }],
      new: [{ operation: "add", text: "replacement" }],
    });
    expect(rowsToRevisionDiff(diffBlocks([], [block("Added")]), ["Old", "New"]).lines[0]?.operation).toBe("add");
  });

  it("marks the changed words, in the page history's diff shape", () => {
    expect(wordSegments("port 80 open", "port 443 open")).toEqual({
      old: [
        { operation: "equal", text: "port " },
        { operation: "delete", text: "80" },
        { operation: "equal", text: " open" },
      ],
      new: [
        { operation: "equal", text: "port " },
        { operation: "add", text: "443" },
        { operation: "equal", text: " open" },
      ],
    });
    const block = (text: string) => ({ text, md: text });
    const diff = rowsToRevisionDiff(
      diffBlocks(
        ["Same", "Old", "Gone"].map(block),
        ["Same", "New"].map(block),
      ),
      ["A", "B"],
    );
    expect(diff.lines.map((line) => line.operation)).toEqual([
      "equal",
      "replace",
      "delete",
    ]);
    expect([diff.deleted_count, diff.added_count]).toEqual([2, 1]);
  });

  it("counts a diagram or an image as a line, though it has no words", () => {
    const before = pageBlocks("<p>Intro</p>");
    const after = pageBlocks(
      '<p>Intro</p><div data-type="diagram" data-engine="mermaid" data-code="graph TD; A--&gt;B"></div><p><img src="/a.png" alt="Build"></p>',
    );
    expect(after.map((block) => block.text)).toEqual([
      "Intro",
      "[mermaid] graph TD; A-->B",
      "[image] Build",
    ]);
    const rows = diffBlocks(before, after);
    expect(rows.filter((row) => row.kind === "change" && row.b)).toHaveLength(
      2,
    );
  });

  it("lays two pages side by side, in order", () => {
    const block = (text: string) => ({ text, md: text });
    const rows = diffBlocks(
      ["Intro", "Port 80", "Same", "Only left"].map(block),
      ["intro", "Port 443", "Same", "Extra"].map(block),
    );
    expect(
      rows.map((row) =>
        row.kind === "same"
          ? "same"
          : `${row.a?.text ?? "-"}|${row.b?.text ?? "-"}`,
      ),
    ).toEqual(["same", "Port 80|Port 443", "same", "Only left|Extra"]);
    expect(diffBlocks([], ["x"].map(block))).toEqual([
      { kind: "change", a: null, b: block("x") },
    ]);
  });

  it("says when content duplicates are not looked for", async () => {
    vi.mocked(api.get).mockResolvedValue(report({ semantic: false }));
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(await screen.findByRole("tab", { name: /Duplicates/ }));

    expect(screen.getByText("No duplicates")).toBeInTheDocument();
    expect(screen.getByText(/once semantic search is on/)).toBeInTheDocument();
  });

  it("tells when a long list is cut short", async () => {
    vi.mocked(api.get).mockResolvedValue(
      report({ orphans: [page("4", "Forgotten corner")], orphans_total: 340 }),
    );
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    expect(
      await screen.findByText("Showing the first 1 of 340."),
    ).toBeInTheDocument();
  });

  it("offers to try again when the report cannot be loaded", async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue(report());
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(await screen.findByRole("button", { name: "Try again" }));

    expect(
      await screen.findByText("Nothing looks out of date"),
    ).toBeInTheDocument();
  });

  it("previews a listed page in a modal without leaving the report", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) =>
      url.includes("/health")
        ? staleReport
        : { content: "<p>Connect to the gateway</p>" },
    );
    const onOpenChange = vi.fn();
    const actor = userEvent.setup();
    render(
      <SpaceHealthDialog space={space} open onOpenChange={onOpenChange} />,
    );

    await actor.click(await screen.findByRole("button", { name: "VPN setup" }));

    expect(
      await screen.findByText("Connect to the gateway"),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    const open = screen.getByRole("link", { name: "Open page" });
    expect(open).toHaveAttribute("href", "/spaces/OPS/pages/vpn-setup");

    await actor.click(open);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says when a previewed page could not be loaded", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes("/health")) return staleReport;
      throw new Error("boom");
    });
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(await screen.findByRole("button", { name: "VPN setup" }));
    expect(
      await screen.findByText("The page could not be loaded right now."),
    ).toBeInTheDocument();
  });

  it("explains when a previewed page has no content", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) =>
      url.includes("/health") ? staleReport : { content: "  " },
    );
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);
    await actor.click(await screen.findByRole("button", { name: "VPN setup" }));
    expect(await screen.findByText("This page is empty.")).toBeInTheDocument();
  });

  it("says when the AI is off, or failed, and when a page could not be marked", async () => {
    vi.mocked(api.get).mockResolvedValue(staleReport);
    vi.mocked(api.post)
      .mockRejectedValueOnce(new ApiError(503, "unavailable", "off"))
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new ApiError(500, "server", "Server broke"))
      .mockRejectedValueOnce(new Error("down"));
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    const check = await screen.findByRole("button", { name: "Check with AI" });
    await actor.click(check);
    expect(await screen.findByRole("alert")).toHaveTextContent("not enabled");
    await actor.click(check);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("could not compare"),
    );

    await actor.click(
      screen.getByRole("button", { name: "Dismiss: still accurate" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Server broke"),
    );
    await actor.click(
      screen.getByRole("button", { name: "Dismiss: still accurate" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("The page could not be marked."),
    );
    expect(
      screen.getByRole("button", { name: "VPN setup" }),
    ).toBeInTheDocument();
  });

  it("says when a page was marked before, and when there was nothing newer to compare", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...staleReport,
      stale: [{ ...staleReport.stale[0]!, reviewed_at: old }],
    });
    vi.mocked(api.post).mockResolvedValue({
      result: "",
      compared: [],
      cached: false,
    });
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    expect(await screen.findByText(/marked still correct/)).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Check with AI" }));
    expect(
      await screen.findByText("No newer related page to compare it with."),
    ).toBeInTheDocument();
  });

  it("says when there are no broken links or orphans", async () => {
    vi.mocked(api.get).mockResolvedValue(report());
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(await screen.findByRole("tab", { name: /Broken links/ }));
    expect(screen.getByText("No broken links")).toBeInTheDocument();
    await actor.click(screen.getByRole("tab", { name: /Orphans/ }));
    expect(screen.getByText("No orphan pages")).toBeInTheDocument();
  });

  it("closes with Escape", async () => {
    vi.mocked(api.get).mockResolvedValue(staleReport);
    const onOpenChange = vi.fn();
    const actor = userEvent.setup();
    render(
      <SpaceHealthDialog space={space} open onOpenChange={onOpenChange} />,
    );

    await actor.click(await screen.findByRole("tab", { name: /Orphans/ }));
    await actor.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sums up what there is to look at, or that nothing needs attention", async () => {
    vi.mocked(api.get).mockResolvedValue(staleReport);
    const { unmount } = render(
      <SpaceHealthDialog space={space} open onOpenChange={() => {}} />,
    );

    expect(
      await screen.findByText("6 things to look at in this space"),
    ).toBeInTheDocument();
    // The short description of a list is the tab's tooltip.
    expect(screen.getByRole("tab", { name: /Out of date/ })).toHaveAttribute(
      "title",
      "Older than related pages",
    );
    unmount();

    vi.mocked(api.get).mockResolvedValue(report());
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);
    expect(
      await screen.findByText("Nothing needs attention"),
    ).toBeInTheDocument();
  });

  it("draws a long list of pairs in steps", async () => {
    vi.mocked(api.get).mockResolvedValue(
      report({
        conflicts: Array.from({ length: 35 }, (_, i) => ({
          id: `a${i}:b${i}`,
          page_a: page(`a${i}`, `Left ${i}`),
          page_b: page(`b${i}`, `Right ${i}`),
          relation: "link" as const,
          similarity: null,
        })),
        conflicts_total: 35,
      }),
    );
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(
      await screen.findByRole("tab", { name: /Possible conflicts/ }),
    );
    expect(screen.getByRole("button", { name: "Left 29" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Left 30" })).toBeNull();

    await actor.click(screen.getByRole("button", { name: "Show 5 more" }));
    expect(screen.getByRole("button", { name: "Left 34" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show .* more/ })).toBeNull();
  });

  it("reveals a long orphan list in steps", async () => {
    vi.mocked(api.get).mockResolvedValue(report({
      orphans: Array.from({ length: 35 }, (_, i) => page(`o${i}`, `Orphan ${i}`)),
      orphans_total: 35,
    }));
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);
    await actor.click(await screen.findByRole("tab", { name: /Orphans/ }));
    expect(screen.getByRole("button", { name: "Orphan 29" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Orphan 30" })).toBeNull();
    await actor.click(screen.getByRole("button", { name: "Show 5 more" }));
    expect(screen.getByRole("button", { name: "Orphan 34" })).toBeInTheDocument();
  });

  it("explains conflict availability and reports cross-space check errors", async () => {
    const conflict = {
      id: "a:b", page_a: page("a", "Gateway"),
      page_b: page("b", "Firewall", { space_key: "SEC", space_name: "Security" }),
      relation: "similar" as const, similarity: 0.8,
    };
    vi.mocked(api.get).mockResolvedValue(report({ conflicts: [conflict], conflicts_total: 1 }));
    vi.mocked(aiStatus).mockResolvedValue({ enabled: false, can_configure: false });
    vi.mocked(api.post).mockRejectedValue(new Error("check failed"));
    const actor = userEvent.setup();
    const first = render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);
    await actor.click(await screen.findByRole("tab", { name: /Possible conflicts/ }));
    expect(screen.getByText(/Turn on the AI assistant/)).toBeInTheDocument();
    first.unmount();
    vi.mocked(aiStatus).mockResolvedValue({ enabled: true, can_configure: false });
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);
    await actor.click(await screen.findByRole("tab", { name: /Possible conflicts/ }));
    await actor.click(screen.getByRole("button", { name: "Detect conflicts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not compare");
    expect(api.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ page_b_space_key: "SEC" }));
  });

  it("shows an empty conflict list", async () => {
    vi.mocked(api.get).mockResolvedValue(report());
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);
    await actor.click(await screen.findByRole("tab", { name: /Possible conflicts/ }));
    expect(screen.getByText("No related pages to compare")).toBeInTheDocument();
  });

  it("shows a cached conflict table with its trailing advice", async () => {
    vi.mocked(api.get).mockResolvedValue(report({
      conflicts: [{ id: "a:b", page_a: page("a", "Gateway"), page_b: page("b", "Firewall"), relation: "mention", similarity: null }],
      conflicts_total: 1,
    }));
    vi.mocked(api.post).mockResolvedValue({
      has_conflict: true, verdict: "conflict", cached: true,
      result: "| Subject | Gateway | Firewall | Note |\n|---|---|---|---|\n| Port | 80 | 443 | Choose one |\n\nResolve today.",
      compared: [page("a", "Gateway"), page("b", "Firewall")],
    });
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);
    await actor.click(await screen.findByRole("tab", { name: /Possible conflicts/ }));
    await actor.click(screen.getByRole("button", { name: "Detect conflicts" }));
    expect(await screen.findByText("Cached result")).toBeInTheDocument();
    expect(screen.getByText("Resolve today.")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "View details" }));
    expect(within(screen.getByRole("dialog", { name: "Discrepancies between two pages" })).getByText("Resolve today.")).toBeInTheDocument();
  });

  it("reports consistent pages without suggesting a duplicate comparison", async () => {
    vi.mocked(api.get).mockResolvedValue(report({
      conflicts: [{ id: "a:b", page_a: page("a", "Gateway"), page_b: page("b", "Firewall"), relation: "link", similarity: null }],
      conflicts_total: 1,
    }));
    vi.mocked(api.post).mockResolvedValue({
      has_conflict: false, verdict: "consistent", cached: false,
      result: "The port numbers agree.", compared: [page("a", "Gateway"), page("b", "Firewall")],
    });
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);
    await actor.click(await screen.findByRole("tab", { name: /Possible conflicts/ }));
    await actor.click(screen.getByRole("button", { name: "Detect conflicts" }));
    expect(await screen.findByText("The port numbers agree.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
  });

  it("does not offer comparison for a single-page duplicate", async () => {
    vi.mocked(api.get).mockResolvedValue(report({
      duplicates: [{ kind: "title", similarity: null, pages: [page("one", "Only page")] }],
      duplicates_total: 1,
    }));
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);
    await actor.click(await screen.findByRole("tab", { name: /Duplicates/ }));
    expect(screen.getByText("Only page")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
  });

  it("shows candidate conflict pairs and runs AI contradiction detection", async () => {
    const conflictRep = report({
      conflicts: [
        {
          id: "1:2",
          page_a: page("1", "Network Gateway"),
          page_b: page("2", "Firewall Ports"),
          relation: "similar",
          similarity: 0.85,
        },
      ],
      conflicts_total: 1,
    });
    vi.mocked(api.get).mockResolvedValue(conflictRep);
    vi.mocked(aiStatus).mockResolvedValue({ enabled: true } as any);
    vi.mocked(api.post).mockResolvedValue({
      has_conflict: true,
      result:
        "| Subject | Network Gateway | Firewall Ports | Note |\n|---|---|---|---|\n| Port kết nối | 8080 | 8443 | Chốt một port |\n| Deadline | 1/12 | 15/12 | Chốt ngày |",
      compared: [page("1", "Network Gateway"), page("2", "Firewall Ports")],
      cached: false,
    });

    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(
      await screen.findByRole("tab", { name: /Possible conflicts/ }),
    );
    expect(screen.getByText("Network Gateway")).toBeInTheDocument();
    expect(screen.getByText("Firewall Ports")).toBeInTheDocument();
    expect(screen.getByText(/85%/)).toBeInTheDocument();

    const checkBtn = screen.getByRole("button", { name: "Detect conflicts" });
    await actor.click(checkBtn);

    expect(await screen.findByText(/Port kết nối/)).toBeInTheDocument();
    expect(screen.getByText(/Discrepancy found/i)).toBeInTheDocument();
    expect(
      screen.getByText("2 discrepancies found between the two pages:"),
    ).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "View details" }));
    const modal = await screen.findByRole("dialog", {
      name: "Discrepancies between two pages",
    });
    expect(within(modal).getByText("8080")).toBeInTheDocument();
    expect(within(modal).getByText("8443")).toBeInTheDocument();
    expect(within(modal).getByText("Chốt ngày")).toBeInTheDocument();
  });

  it("calls two repeating pages a duplicate, offers to compare, and folds the answer", async () => {
    vi.mocked(api.get).mockResolvedValue(
      report({
        conflicts: [
          {
            id: "1:2",
            page_a: page("1", "Viettel Cloud"),
            page_b: page("2", "Create a server"),
            relation: "similar",
            similarity: 0.91,
          },
        ],
        conflicts_total: 1,
      }),
    );
    vi.mocked(api.post).mockResolvedValue({
      has_conflict: false,
      verdict: "duplicate",
      result: "**The pages repeat each other.**",
      compared: [page("1", "Viettel Cloud"), page("2", "Create a server")],
      cached: false,
    });
    const actor = userEvent.setup();
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(
      await screen.findByRole("tab", { name: /Possible conflicts/ }),
    );
    await actor.click(screen.getByRole("button", { name: "Detect conflicts" }));

    expect(
      await screen.findByText(/Duplicate content, not a conflict/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare" })).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Collapse" }));
    expect(
      screen.queryByText("The pages repeat each other."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Duplicate content, not a conflict/),
    ).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Expand" }));
    expect(
      screen.getByText("The pages repeat each other."),
    ).toBeInTheDocument();
  });

  it("says where an orphan could be linked from, and copies its link", async () => {
    vi.mocked(api.get).mockResolvedValue(
      report({
        orphans: [
          {
            ...page("4", "Forgotten corner"),
            link_from: [
              {
                page: page("9", "Network guide"),
                reason: "similar",
                similarity: 0.82,
              },
              { page: page("10", "Handbook"), reason: "parent" },
            ],
          },
        ],
        orphans_total: 1,
      }),
    );
    // After userEvent's set-up, which puts in a clipboard of its own.
    const actor = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);

    await actor.click(await screen.findByRole("tab", { name: /Orphans/ }));
    expect(screen.getByText("Could be linked from:")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Network guide" }),
    ).toBeInTheDocument();
    expect(screen.getByText("82% similar")).toBeInTheDocument();
    expect(screen.getByText("Parent page")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringMatching(/\/spaces\/OPS\/pages\/forgotten-corner$/),
      ),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("copies an orphan link as rich HTML and reports clipboard failures", async () => {
    vi.mocked(api.get).mockResolvedValue(report({
      orphans: [page("o1", 'A&B <"guide">')], orphans_total: 1,
    }));
    const actor = userEvent.setup();
    const write = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    vi.stubGlobal("ClipboardItem", class { constructor(_data: Record<string, Blob>) {} });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);
    await actor.click(await screen.findByRole("tab", { name: /Orphans/ }));
    await actor.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    await actor.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("reads the table of contradictions the AI writes", () => {
    expect(
      parseConflictTable(
        "| S | A | B | N |\n|---|---|---|---|\n| port | 1 | 2 | fix |",
      ),
    ).toEqual({
      header: ["S", "A", "B", "N"],
      rows: [["port", "1", "2", "fix"]],
      rest: "",
    });
    expect(parseConflictTable("The pages agree.")).toBeNull();
    expect(parseConflictTable("| a | b |\n| x | y |\n| 1 | 2 |")).toBeNull();
  });

  it("loads nothing while closed", () => {
    render(
      <SpaceHealthDialog space={space} open={false} onOpenChange={() => {}} />,
    );
    expect(api.get).not.toHaveBeenCalled();
  });
});
