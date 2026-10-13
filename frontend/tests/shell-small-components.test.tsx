import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImpersonationBanner } from "@/components/layout/impersonation-banner";
import { LanguageToggle } from "@/components/layout/language-toggle";
import {
  NavigationProgressProvider,
  useNavigate,
} from "@/components/layout/navigation-progress";
import { SpaceCard } from "@/components/spaces/space-card";
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import { LocaleProvider } from "@/lib/i18n/context";
import { api } from "@/lib/api-client";
import type { Space, User } from "@/types/api";

const nav = vi.hoisted(() => ({
  pathname: "/",
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: nav.refresh }),
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = "/";
});

// ------------------------------------------------------------ progress bar
function Navigator({ href }: { href: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(href)}>go</button>;
}

describe("NavigationProgressProvider", () => {
  it("shows the bar until the destination path is current", async () => {
    const view = render(
      <NavigationProgressProvider>
        <Navigator href="/spaces/ENG?tab=1#x" />
      </NavigationProgressProvider>,
    );
    const bar = screen.getByRole("progressbar", { hidden: true });
    expect(bar).toHaveAttribute("aria-hidden", "true");

    await userEvent.click(screen.getByText("go"));
    expect(nav.push).toHaveBeenCalledWith("/spaces/ENG?tab=1#x");
    await waitFor(() => expect(bar).toHaveAttribute("aria-hidden", "false"));

    nav.pathname = "/spaces/ENG";
    view.rerender(
      <NavigationProgressProvider>
        <Navigator href="/spaces/ENG?tab=1#x" />
      </NavigationProgressProvider>,
    );
    await waitFor(() => expect(bar).toHaveAttribute("aria-hidden", "true"));
  });

  it("gives up waiting after a failsafe delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <NavigationProgressProvider>
          <Navigator href="/never" />
        </NavigationProgressProvider>,
      );
      const bar = screen.getByRole("progressbar", { hidden: true });
      fireEvent.click(screen.getByText("go"));
      await waitFor(() => expect(bar).toHaveAttribute("aria-hidden", "false"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_100);
      });
      expect(bar).toHaveAttribute("aria-hidden", "true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to a plain push outside the provider", async () => {
    render(<Navigator href="/plain" />);
    await userEvent.click(screen.getByText("go"));
    expect(nav.push).toHaveBeenCalledWith("/plain");
  });
});

// --------------------------------------------------------- language toggle
describe("LanguageToggle", () => {
  it("shows the active language and switches", async () => {
    const actor = userEvent.setup();
    render(
      <LocaleProvider initialLocale="en">
        <LanguageToggle />
      </LocaleProvider>,
    );
    const trigger = screen.getByRole("button", { name: /language/i });
    expect(trigger).toHaveTextContent("EN");

    await actor.click(trigger);
    const english = await screen.findByRole("menuitem", { name: /English/ });
    expect(english).toHaveClass("bg-primary-subtle");
    await actor.click(screen.getByRole("menuitem", { name: /Ti.ng Vi.t|Vietnamese/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /.+/, hidden: true })).toBeInTheDocument());
    expect(document.documentElement.lang).toBe("vi");
  });
});

// ------------------------------------------------------------ scroll to top
describe("ScrollToTop", () => {
  const button = () => screen.getByRole("button", { name: "Scroll to top", hidden: true });

  it("appears after scrolling the page and scrolls the window back up", () => {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    render(<ScrollToTop />);
    expect(button()).toHaveClass("opacity-0");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 500 });
    act(() => {
      fireEvent.scroll(document);
    });
    expect(button()).toHaveClass("opacity-100");

    fireEvent.click(button());
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(button()).toHaveClass("opacity-0");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    act(() => {
      fireEvent.scroll(window);
    });
    expect(button()).toHaveClass("opacity-0");
  });

  it("follows a tall scrolling container but ignores sidebars and short boxes", () => {
    render(<ScrollToTop />);
    const make = (tag: string, clientHeight: number) => {
      const el = document.createElement(tag);
      Object.defineProperty(el, "clientHeight", { value: clientHeight });
      el.scrollTop = 400;
      document.body.appendChild(el);
      return el;
    };
    const tall = make("div", window.innerHeight);
    tall.scrollTo = vi.fn() as unknown as typeof tall.scrollTo;

    const short = make("div", 10);
    act(() => {
      fireEvent.scroll(short);
    });
    expect(button()).toHaveClass("opacity-0");

    const aside = make("aside", window.innerHeight);
    act(() => {
      fireEvent.scroll(aside);
    });
    expect(button()).toHaveClass("opacity-0");

    const insideAside = document.createElement("div");
    Object.defineProperty(insideAside, "clientHeight", { value: window.innerHeight });
    aside.appendChild(insideAside);
    act(() => {
      fireEvent.scroll(insideAside);
    });
    expect(button()).toHaveClass("opacity-0");

    act(() => {
      fireEvent.scroll(tall);
    });
    expect(button()).toHaveClass("opacity-100");
    fireEvent.click(button());
    expect(tall.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    [tall, short, aside].forEach((el) => el.remove());
  });

  it("ignores scrolls from non-element targets", () => {
    render(<ScrollToTop />);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(button()).toHaveClass("opacity-0");
  });
});

// ---------------------------------------------------------- impersonation
describe("ImpersonationBanner", () => {
  const viewingAs = { username: "bob", full_name: "Bob Ng" } as User;
  const impersonator = { username: "root" } as User;

  it("names who is being viewed and who is recorded", () => {
    render(<ImpersonationBanner viewingAs={viewingAs} impersonator={impersonator} />);
    expect(screen.getByText("Bob Ng")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("root");
  });

  it("falls back to the username", () => {
    render(
      <ImpersonationBanner viewingAs={{ username: "bob", full_name: "" } as User} impersonator={impersonator} />,
    );
    expect(screen.getByText("bob")).toBeInTheDocument();
  });

  it("returns to the real account", async () => {
    mocked.delete.mockResolvedValue({});
    render(<ImpersonationBanner viewingAs={viewingAs} impersonator={impersonator} />);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/"));
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/auth/impersonate");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("reports a failure and re-enables the button", async () => {
    mocked.delete.mockRejectedValue(new Error("x"));
    render(<ImpersonationBanner viewingAs={viewingAs} impersonator={impersonator} />);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("button")).toBeEnabled();
  });
});

// -------------------------------------------------------------- space card
function space(overrides: Partial<Space> = {}): Space {
  return {
    id: "s1",
    key: "ENG",
    name: "Engineering",
    description: "",
    icon: "",
    status: "active",
    member_count: 1,
    my_role: null,
    is_favorite: false,
    ...overrides,
  } as Space;
}

describe("SpaceCard", () => {
  it("shows the defaults for a bare space", () => {
    render(<SpaceCard space={space()} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/spaces/ENG");
    expect(screen.getByText("📄")).toBeInTheDocument();
    expect(screen.getByText("No description.")).toBeInTheDocument();
    expect(screen.getByText("1 member")).toBeInTheDocument();
  });

  it("shows details for an archived space with members and a role", () => {
    render(
      <SpaceCard
        space={space({ icon: "🚀", description: "Docs", status: "archived", member_count: 4, my_role: "admin" })}
      />,
    );
    expect(screen.getByText("🚀")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("archived")).toBeInTheDocument();
    expect(screen.getByText(/4 members/)).toHaveTextContent("you are admin");
  });

  it("toggles the favourite without navigating", async () => {
    mocked.put.mockResolvedValue(undefined);
    mocked.delete.mockResolvedValue(undefined);
    const actor = userEvent.setup();
    render(<SpaceCard space={space()} />);

    const star = screen.getByRole("button", { name: "Add to favourites" });
    await actor.click(star);
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove from favourites" })).toBeEnabled());
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/ENG/favorite");
    expect(nav.refresh).toHaveBeenCalled();

    await actor.click(screen.getByRole("button", { name: "Remove from favourites" }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith("/api/v1/spaces/ENG/favorite"));
  });

  it("rolls the star back when saving fails", async () => {
    mocked.put.mockRejectedValue(new Error("x"));
    const actor = userEvent.setup();
    render(<SpaceCard space={space()} />);
    await actor.click(screen.getByRole("button", { name: "Add to favourites" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not update favourites."));
    expect(screen.getByRole("button", { name: "Add to favourites" })).toBeInTheDocument();
  });
});
