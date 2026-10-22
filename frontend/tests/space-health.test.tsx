import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";

import { SpaceHealthDialog } from "@/components/pages/space-health";
import { aiStatus } from "@/lib/ai-summary";
import { api, ApiError } from "@/lib/api-client";
import {
  checkStalePage,
  daysSince,
  firstBusyTab,
  healthCounts,
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

describe("space health helpers", () => {
  it("counts, picks the first list with work and links pages", () => {
    expect(healthCounts(staleReport)).toEqual({
      stale: 1,
      broken: 2,
      orphans: 1,
      duplicates: 2,
    });
    expect(firstBusyTab(staleReport)).toBe("stale");
    expect(firstBusyTab(report({ orphans_total: 3 }))).toBe("orphans");
    expect(firstBusyTab(report())).toBe("stale");
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

    const link = await screen.findByRole("link", { name: "VPN setup" });
    expect(link).toHaveAttribute("href", "/spaces/OPS/pages/vpn-setup");
    expect(
      screen.getByText("1 related page was edited since:"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Network changes" }),
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

    await screen.findByRole("link", { name: "VPN setup" });
    expect(
      screen.queryByRole("button", { name: "Check with AI" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Still correct" }),
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
      await screen.findByRole("button", { name: "Still correct" }),
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
      screen.getByRole("link", { name: "Forgotten corner" }),
    ).toBeInTheDocument();

    await actor.click(screen.getByRole("tab", { name: /Duplicates/ }));
    const panel = screen.getByRole("tabpanel");
    expect(
      within(panel).getByText("2 pages with the same title"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("Nearly the same content (95% alike)"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("link", { name: /Wages in People/ }),
    ).toHaveAttribute("href", "/spaces/HR/pages/wages");
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

  it("closes when a listed page is opened", async () => {
    vi.mocked(api.get).mockResolvedValue(staleReport);
    const onOpenChange = vi.fn();
    const actor = userEvent.setup();
    render(
      <SpaceHealthDialog space={space} open onOpenChange={onOpenChange} />,
    );

    await actor.click(await screen.findByRole("link", { name: "VPN setup" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
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

    await actor.click(screen.getByRole("button", { name: "Still correct" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Server broke"),
    );
    await actor.click(screen.getByRole("button", { name: "Still correct" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("The page could not be marked."),
    );
    expect(screen.getByRole("link", { name: "VPN setup" })).toBeInTheDocument();
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
      await screen.findByText("things to look at in this space"),
    ).toBeInTheDocument();
    expect(screen.getByText("Older than related pages")).toBeInTheDocument();
    unmount();

    vi.mocked(api.get).mockResolvedValue(report());
    render(<SpaceHealthDialog space={space} open onOpenChange={() => {}} />);
    expect(
      await screen.findByText("Nothing needs attention"),
    ).toBeInTheDocument();
  });

  it("loads nothing while closed", () => {
    render(
      <SpaceHealthDialog space={space} open={false} onOpenChange={() => {}} />,
    );
    expect(api.get).not.toHaveBeenCalled();
  });
});
