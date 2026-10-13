import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ErrorPage from "@/app/error";
import NotFound from "@/app/not-found";
import { StorageTabs } from "@/components/admin/storage-tabs";
import { NavigationLoading, useNavigationPending } from "@/components/navigation-loading";
import type { Me, SiteSettings } from "@/types/api";

const m = vi.hoisted(() => ({
  pathname: "/",
  back: vi.fn(),
  push: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => m.pathname,
  useRouter: () => ({ back: m.back, push: m.push }),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/i18n/server", () => ({
  getServerLocale: async () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock("@/components/admin/storage-panel", () => ({ StoragePanel: () => <div>storage-panel</div> }));
vi.mock("@/components/admin/storage-quotas-card", () => ({
  StorageQuotasCard: () => <div>quotas-card</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  m.pathname = "/";
});

describe("ErrorPage", () => {
  it("offers a retry and going back", async () => {
    const reset = vi.fn();
    const actor = userEvent.setup();
    render(<ErrorPage error={new Error("x")} reset={reset} />);
    await actor.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalled();

    Object.defineProperty(window.history, "length", { configurable: true, value: 3 });
    await actor.click(screen.getByRole("button", { name: /go back/i }));
    expect(m.back).toHaveBeenCalled();
  });

  it("goes home when there is nothing to go back to", async () => {
    Object.defineProperty(window.history, "length", { configurable: true, value: 1 });
    render(<ErrorPage error={new Error("x")} reset={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /go back/i }));
    expect(m.push).toHaveBeenCalledWith("/");
  });
});

describe("NotFound", () => {
  it("renders inside the shell for a signed-in user", async () => {
    m.getCurrentUser.mockResolvedValue({ id: "u1" } as Me);
    render(await NotFound());
    expect(screen.getByTestId("shell")).toBeInTheDocument();
    expect(screen.getByText("errors.notFoundTitle")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /errors.notFoundGoHome/ })).toHaveAttribute("href", "/");
  });

  it("renders standalone for an anonymous visitor", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    render(await NotFound());
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /errors.browseSpaces/ })).toHaveAttribute("href", "/spaces");
  });
});

describe("StorageTabs", () => {
  it("keeps both panels mounted and switches which one shows", async () => {
    const actor = userEvent.setup();
    render(<StorageTabs settings={{} as SiteSettings} />);
    expect(screen.getByText("storage-panel").parentElement).not.toHaveClass("hidden");
    expect(screen.getByText("quotas-card").parentElement).toHaveClass("hidden");

    await actor.click(screen.getByRole("tab", { name: "Quotas" }));
    expect(screen.getByText("storage-panel").parentElement).toHaveClass("hidden");
    expect(screen.getByText("quotas-card").parentElement).not.toHaveClass("hidden");
    expect(screen.getByRole("tab", { name: "Quotas" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("NavigationLoading", () => {
  function Pending() {
    return <span data-testid="pending">{String(useNavigationPending())}</span>;
  }

  function link(href: string, attrs: Record<string, string> = {}) {
    const a = document.createElement("a");
    a.href = href;
    Object.entries(attrs).forEach(([k, v]) => a.setAttribute(k, v));
    a.textContent = "link";
    document.body.appendChild(a);
    return a;
  }

  afterEachCleanup();

  it("shows the bar after an internal link click and clears it when the path changes", async () => {
    const view = render(
      <>
        <NavigationLoading />
        <Pending />
      </>,
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    const a = link("/spaces/ENG");
    fireEvent.click(a);
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByTestId("pending")).toHaveTextContent("true");

    m.pathname = "/spaces/ENG";
    view.rerender(
      <>
        <NavigationLoading />
        <Pending />
      </>,
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });

  it("ignores clicks that will not navigate in this tab", () => {
    render(<NavigationLoading />);
    const cases: Array<[HTMLElement, MouseEventInit?]> = [
      [link("/a"), { button: 1 }],
      [link("/a"), { metaKey: true }],
      [link("/a"), { ctrlKey: true }],
      [link("/a"), { shiftKey: true }],
      [link("/a"), { altKey: true }],
      [link("/a", { target: "_blank" })],
      [link("/a", { download: "" })],
      [link("https://elsewhere.example/page")],
      [link(window.location.href)],
      [document.body],
    ];
    for (const [el, init] of cases) {
      fireEvent.click(el, init);
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    }
    // A click on text that is not inside a link at all.
    fireEvent.click(document);
  });

  it("treats an explicit _self target as internal", () => {
    render(<NavigationLoading />);
    fireEvent.click(link("/self", { target: "_self" }));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("gives up after a few seconds if the route never changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<NavigationLoading />);
      fireEvent.click(link("/stuck"));
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8100);
      });
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

function afterEachCleanup() {
  beforeEach(() => {
    document.querySelectorAll("a").forEach((a) => a.remove());
  });
}
