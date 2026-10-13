import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RefreshButton } from "@/components/admin/refresh-button";
import { StatTile } from "@/components/admin/stat-tile";
import { PageHeader } from "@/components/layout/page-header";
import { HomeSearchTrigger } from "@/components/layout/home-search-trigger";
import { SidebarProvider, useSidebar } from "@/components/layout/sidebar-context";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ReportIssueButton } from "@/components/issues/report-issue-button";
import { NavigationLoading } from "@/components/navigation-loading";
import { PageContentLoading } from "@/components/pages/page-content-loading";
import { RecordVisit } from "@/components/pages/record-visit";
import { SpaceList } from "@/components/spaces/space-list";
import { readRecentlyVisited } from "@/lib/recently-visited";
import type { Space } from "@/types/api";
import { Package } from "lucide-react";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock("@/components/layout/search-modal", () => ({
  SearchModal: ({ open }: { open: boolean }) => (open ? <div role="dialog">search</div> : null),
}));
vi.mock("@/components/issues/report-issue-dialog", () => ({
  ReportIssueDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog">report</div> : null),
}));
vi.mock("@/components/spaces/space-card", () => ({
  SpaceCard: ({ space }: { space: Space }) => <div>card {space.name}</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("PageHeader", () => {
  it("renders every optional part", () => {
    render(
      <PageHeader eyebrow="Work" title="Title" description="About" actions={<button>act</button>} className="x" />,
    );
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "act" })).toBeInTheDocument();
    expect(document.querySelector("header")).toHaveClass("x");
  });

  it("omits the optional parts", () => {
    const { container } = render(<PageHeader title="Only" />);
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelectorAll("div")).toHaveLength(1);
  });
});

describe("StatTile", () => {
  it("formats the count for the locale", () => {
    const first = render(<StatTile icon={Package} label="Items" value={1234567} />);
    expect(screen.getByText("1,234,567")).toBeInTheDocument();
    first.unmount();
    const second = render(<StatTile icon={Package} label="Items" value={1234567} locale="vi" />);
    expect(screen.getByText("1.234.567")).toBeInTheDocument();
    second.unmount();
    render(<StatTile icon={Package} label="Items" value={5} locale={"xx" as "en"} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});

describe("RefreshButton", () => {
  it("re-fetches the current view", async () => {
    render(<RefreshButton label="Refresh" />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refresh).toHaveBeenCalled();
  });
});

describe("SidebarToggle", () => {
  function Probe() {
    const s = useSidebar();
    return <span data-testid="state">{JSON.stringify({ c: s.collapsed, m: s.mobileOpen })}</span>;
  }
  const mount = () =>
    render(
      <SidebarProvider>
        <Probe />
        <SidebarToggle />
      </SidebarProvider>,
    );
  const setDesktop = (desktop: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: desktop,
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  };

  it("opens the drawer on a small screen", async () => {
    setDesktop(false);
    mount();
    const button = screen.getByRole("button", { name: /collapse/i });
    await userEvent.click(button);
    expect(screen.getByTestId("state")).toHaveTextContent('"m":true');
    await userEvent.click(button);
    expect(screen.getByTestId("state")).toHaveTextContent('"m":false');
  });

  it("collapses and expands the rail on a large screen", async () => {
    setDesktop(true);
    mount();
    await userEvent.click(screen.getByRole("button", { name: /collapse/i }));
    expect(screen.getByTestId("state")).toHaveTextContent('"c":true');
    const expand = screen.getByRole("button", { name: /expand/i });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(expand);
    expect(screen.getByTestId("state")).toHaveTextContent('"c":false');
  });
});

describe("ThemeToggle", () => {
  it("switches between light and dark", async () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const button = await screen.findByRole("button");
    await userEvent.click(button);
    await act(async () => {});
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await userEvent.click(screen.getByRole("button"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("RecordVisit", () => {
  it("records the page as visited and renders nothing", () => {
    const { container } = render(<RecordVisit spaceKey="ENG" spaceName="Engineering" slug="intro" title="Intro" />);
    expect(container).toBeEmptyDOMElement();
    expect(readRecentlyVisited()[0]).toMatchObject({ spaceKey: "ENG", slug: "intro", title: "Intro" });
  });
});

describe("SpaceList", () => {
  it("shows an empty state", () => {
    render(<SpaceList spaces={[]} emptyTitle="Nothing" emptyHint="Create one" />);
    expect(screen.getByText("Nothing")).toBeInTheDocument();
    expect(screen.getByText("Create one")).toBeInTheDocument();
  });

  it("shows a card per space", () => {
    render(
      <SpaceList
        spaces={[{ id: "1", name: "A" }, { id: "2", name: "B" }] as Space[]}
        emptyTitle="x"
        emptyHint="y"
      />,
    );
    expect(screen.getByText("card A")).toBeInTheDocument();
    expect(screen.getByText("card B")).toBeInTheDocument();
  });
});

describe("HomeSearchTrigger and ReportIssueButton", () => {
  it("open their dialogs", async () => {
    const first = render(<HomeSearchTrigger />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("dialog")).toHaveTextContent("search");
    first.unmount();

    render(<ReportIssueButton />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("dialog")).toHaveTextContent("report");
  });
});

describe("PageContentLoading", () => {
  it("covers the page only while a navigation is pending", async () => {
    render(
      <>
        <NavigationLoading />
        <PageContentLoading />
        <a href="/elsewhere">go</a>
      </>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("go"));
    expect(await screen.findByRole("status")).toHaveAttribute("aria-busy", "true");
  });
});
