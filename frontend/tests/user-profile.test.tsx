import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserProfile } from "@/components/users/user-profile";
import { ApiError, api } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/i18n/context";
import type {
  PublicUser,
  RecentPageItem,
  Space,
  UserDraftItem,
  UserPageLabelItem,
  UserPinnedPageItem,
} from "@/types/api";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/components/pages/page-history-modal", () => ({
  PageHistoryModal: ({ pageTitle, onOpenChange }: { pageTitle: string; onOpenChange: (open: boolean) => void }) => (
    <div role="dialog" aria-label={`History of ${pageTitle}`}>
      <button type="button" onClick={() => onOpenChange(true)}>Stay open</button>
      <button type="button" onClick={() => onOpenChange(false)}>Close history</button>
    </div>
  ),
}));
vi.mock("@/components/users/user-profile-trigger", () => ({
  UserProfileTrigger: ({ fullName, variant }: { fullName: string; variant?: string }) => (
    <span data-variant={variant ?? "name"}>{fullName}</span>
  ),
}));

const mocked = vi.mocked(api);

let observerCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
class FakeIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    observerCallback = callback;
  }
  observe() {}
  disconnect() {}
}

const NOW = new Date("2026-06-15T12:00:00Z").getTime();

function minutesAgo(minutes: number) {
  return new Date(NOW - minutes * 60_000).toISOString();
}

function activity(id: string, overrides: Partial<RecentPageItem> = {}): RecentPageItem {
  return {
    id,
    title: `Page ${id}`,
    slug: `page-${id}`,
    space_key: "ENG",
    space_name: "Engineering",
    created_at: minutesAgo(600),
    updated_at: minutesAgo(10),
    user_username: "ann",
    user_full_name: "Ann Lee",
    ...overrides,
  };
}

const USER: PublicUser = {
  username: "ann",
  full_name: "Ann Lee",
  avatar_url: null,
  bio: "Writes docs.",
  pronouns: "",
  profile_url: "",
  social_links: [],
  company: "",
  email: "ann@example.test",
  created_at: "2025-01-01T00:00:00Z",
  last_active_at: minutesAgo(2),
  is_workspace_admin: false,
};

function space(id: string, key: string, name: string): Space {
  return { id, key, name } as Space;
}

function pin(id: string, key: string, slug: string, title: string, spaceName = key): UserPinnedPageItem {
  return { id, title, slug, space_key: key, space_name: spaceName, pinned_at: "2026-01-01T00:00:00Z" };
}

function label(name: string, key: string, slug: string): UserPageLabelItem {
  return { id: `${name}-${slug}`, name, page_id: slug, title: slug, slug, space_key: key, space_name: key };
}

const DRAFT: UserDraftItem = {
  id: "d1",
  page_id: "p1",
  title: "Half-written",
  slug: "half",
  space_key: "ENG",
  space_name: "Engineering",
  content: "",
  updated_at: "2026-06-15T09:30:00Z",
};

type Props = Parameters<typeof UserProfile>[0];

function renderProfile(overrides: Partial<Props> = {}) {
  const props: Props = {
    user: USER,
    initialActivity: { items: [activity("m1", { updated_at: minutesAgo(30) })], next_cursor: null },
    initialAllActivity: [
      activity("a1"),
      activity("a2", { updated_at: minutesAgo(20) }),
      activity("a3", { user_username: "", user_full_name: "", updated_at: minutesAgo(40) }),
      activity("a4", { user_username: "bob", user_full_name: "", updated_at: minutesAgo(50) }),
      activity("a5", { updated_at: minutesAgo(60 * 10) }),
    ],
    stats: { pages_updated: 7, pages_created: 3, spaces_contributed: 2 },
    drafts: [DRAFT],
    isOwner: true,
    isAdmin: false,
    favoriteSpaces: [],
    pinnedPages: [],
    likedPages: [],
    ...overrides,
  };
  const view = render(<UserProfile {...props} />, { wrapper: LocaleProvider });
  return { view, props, actor: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
  window.localStorage.clear();
  observerCallback = null;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  mocked.get.mockImplementation(async (path: string) => {
    if (path === "/api/v1/users/me/page-labels") return [];
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("UserProfile summary", () => {
  it("introduces the person with presence, role and stats", () => {
    renderProfile();

    expect(screen.getByRole("heading", { level: 1, name: "Ann Lee" })).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Active now" })).toBeInTheDocument();
    expect(screen.getByText("Writes docs.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit profile/ })).toHaveAttribute("href", "/account");
    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it.each([
    [minutesAgo(30), "Active 30m ago", "30m"],
    [minutesAgo(60 * 5), "Active 5h ago", null],
    [minutesAgo(60 * 30), "Active Yesterday", null],
    [minutesAgo(60 * 24 * 4), "Active 4d ago", null],
    [new Date(NOW + 60_000).toISOString(), "Active now", null],
    ["not a date", "Offline", null],
    [null, "Offline", null],
  ])("describes last activity at %s as %s", (lastActive, label, badge) => {
    renderProfile({ user: { ...USER, last_active_at: lastActive } });

    const indicator = screen.getByRole("img", { name: label });
    expect(indicator).toHaveTextContent(badge ?? "");
  });

  it("shows an avatar, an icon for a nameless account, and no join date when unknown", () => {
    const { view } = renderProfile({
      user: { ...USER, avatar_url: "/a.png", is_workspace_admin: true },
    });
    expect(view.container.querySelector('img[src="/a.png"]')).not.toBeNull();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    view.unmount();

    renderProfile({ user: { ...USER, full_name: " ", username: " ", created_at: "", bio: "", last_active_at: null } });
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("re-reads presence every half minute", () => {
    renderProfile({ user: { ...USER, last_active_at: minutesAgo(3) } });
    expect(screen.getByRole("img", { name: "Active now" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3 * 60_000));

    expect(screen.getByRole("img", { name: "Active 6m ago" })).toBeInTheDocument();
  });
});

describe("UserProfile activity", () => {
  it("groups the workspace feed by person and time, and opens a change's history", async () => {
    const { actor } = renderProfile();

    expect(screen.getAllByText("Ann Lee").length).toBeGreaterThan(1);
    // A nameless system update reads as the workspace itself.
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(screen.getByText("bob", { selector: "[data-variant=name]" })).toBeInTheDocument();
    // A gap of hours starts a new group even for the same person.
    expect(screen.getAllByText("Ann Lee", { selector: "[data-variant=avatar]" })).toHaveLength(2);

    await actor.click(screen.getAllByRole("button", { name: "(view change)" })[0]!);
    const history = screen.getByRole("dialog", { name: "History of Page a1" });
    await actor.click(within(history).getByRole("button", { name: "Stay open" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await actor.click(within(history).getByRole("button", { name: "Close history" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("loads a larger slice of recent activity, and offers a retry when that fails", async () => {
    const { actor } = renderProfile();

    mocked.get.mockRejectedValueOnce(new ApiError(500, "x", "Server error."));
    await actor.click(screen.getByRole("button", { name: "Show recent" }));
    await actor.click(screen.getByRole("menuitemradio", { name: "100" }));
    expect(await screen.findByText("Server error.")).toBeInTheDocument();

    mocked.get.mockResolvedValueOnce([activity("fresh")]);
    await actor.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Page fresh")).toBeInTheDocument();
    expect(mocked.get).toHaveBeenLastCalledWith("/api/v1/pages/recent?limit=100");
  });

  it("says so when there is no activity to show", async () => {
    const { actor } = renderProfile({ initialAllActivity: [], initialActivity: { items: [], next_cursor: null } });

    expect(screen.getByText("No visible activity yet")).toBeInTheDocument();
    await actor.click(screen.getByRole("tab", { name: "My activity" }));
    expect(screen.getByText("No visible activity yet")).toBeInTheDocument();
  });

  it("loads more of the person's own activity as you scroll, skipping duplicates", async () => {
    mocked.get.mockImplementation(async (path: string) => {
      if (path.includes("/activity?")) {
        return { items: [activity("m1"), activity("m2")], next_cursor: "c2" };
      }
      return [];
    });
    const { actor } = renderProfile({
      initialActivity: { items: [activity("m1")], next_cursor: "c1" },
    });

    await actor.click(screen.getByRole("tab", { name: "My activity" }));
    act(() => observerCallback?.([{ isIntersecting: false }]));
    expect(mocked.get).not.toHaveBeenCalledWith(expect.stringContaining("/activity?"));
    await act(async () => observerCallback?.([{ isIntersecting: true }]));

    expect(await screen.findByText("Page m2")).toBeInTheDocument();
    expect(screen.getAllByText("Page m1")).toHaveLength(1);
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/users/ann/activity?limit=20&cursor=c1");
  });

  it("offers a retry when loading more of the person's activity fails", async () => {
    let failNext = true;
    mocked.get.mockImplementation(async (path: string) => {
      if (path.includes("/activity?")) {
        if (failNext) {
          failNext = false;
          throw new ApiError(0, "network_error", "x");
        }
        return { items: [activity("m9")], next_cursor: null };
      }
      return [];
    });
    const { actor } = renderProfile({
      initialActivity: { items: [activity("m1")], next_cursor: "c1" },
    });
    await actor.click(screen.getByRole("tab", { name: "My activity" }));

    await act(async () => observerCallback?.([{ isIntersecting: true }]));
    expect(await screen.findByText("Could not reach the WikiHub API.")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Page m9")).toBeInTheDocument();
  });

  it("loads more on someone else's profile too, where their activity is the main feed", async () => {
    mocked.get.mockImplementation(async (path: string) =>
      path.includes("/activity?") ? { items: [activity("o2")], next_cursor: null } : [],
    );
    renderProfile({
      isOwner: false,
      initialActivity: { items: [activity("o1")], next_cursor: "c1" },
    });

    await act(async () => observerCallback?.([{ isIntersecting: true }]));

    expect(await screen.findByText("Page o2")).toBeInTheDocument();
  });

  it("does not start a second load while one is running", async () => {
    let release: (value: unknown) => void = () => {};
    mocked.get.mockImplementation((path: string) =>
      path.includes("/activity?")
        ? new Promise((resolve) => (release = resolve))
        : Promise.resolve([]),
    );
    const { actor } = renderProfile({
      initialActivity: { items: [activity("m1")], next_cursor: "c1" },
    });
    await actor.click(screen.getByRole("tab", { name: "My activity" }));

    await act(async () => observerCallback?.([{ isIntersecting: true }]));
    await act(async () => observerCallback?.([{ isIntersecting: true }]));
    expect(screen.getByText("Loading more activity…")).toBeInTheDocument();
    expect(mocked.get.mock.calls.filter(([path]) => String(path).includes("/activity?"))).toHaveLength(1);

    await act(async () => release({ items: [], next_cursor: null }));
  });

  it("shows drafts, or says there are none", async () => {
    const { actor, view } = renderProfile();
    await actor.click(screen.getByRole("tab", { name: "Drafts" }));
    expect(screen.getByRole("link", { name: "Half-written" })).toHaveAttribute("href", "/spaces/ENG/pages/half");
    view.unmount();

    const second = renderProfile({ drafts: [] });
    await second.actor.click(screen.getByRole("tab", { name: "Drafts" }));
    expect(screen.getByText("No drafts are available to view.")).toBeInTheDocument();
  });

  it("is limited to the person's own activity on someone else's profile", async () => {
    const { actor, view } = renderProfile({ isOwner: false, isAdmin: false });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["@ann activity"]);
    expect(screen.getByText("Page m1")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edit profile/ })).toBeNull();
    view.unmount();

    renderProfile({ isOwner: false, isAdmin: true });
    expect(screen.getByText("Draft access")).toBeInTheDocument();
    await actor.click(screen.getByRole("tab", { name: "@ann Draft" }));
    expect(screen.getByText("Half-written")).toBeInTheDocument();
  });

  it("follows new activity handed down from the server", () => {
    const { view, props } = renderProfile();

    view.rerender(
      <UserProfile
        {...props}
        initialAllActivity={[activity("z1")]}
        initialActivity={{ items: [activity("z2")], next_cursor: null }}
      />,
    );

    expect(screen.getByText("Page z1")).toBeInTheDocument();
  });
});

describe("UserProfile knowledge", () => {
  const FAVOURITES = [space("s1", "ENG", "Engineering"), space("s2", "OPS", "Operations")];
  const PINNED = [pin("p1", "ENG", "runbook", "Runbook", "Engineering"), pin("p2", "OPS", "oncall", "On-call", "Operations")];
  const LIKED = [pin("l1", "ENG", "style", "Style guide", "Engineering"), pin("l2", "OPS", "intro", "Intro", "Operations")];

  async function openKnowledge(overrides: Partial<Props> = {}) {
    const result = renderProfile({
      favoriteSpaces: FAVOURITES,
      pinnedPages: PINNED,
      likedPages: LIKED,
      ...overrides,
    });
    await result.actor.click(screen.getByRole("tab", { name: "My knowledge" }));
    return result;
  }

  it("searches favourite spaces and toggles them as sidebar shortcuts", async () => {
    const { actor } = await openKnowledge();

    expect(screen.getByText("2/5")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Remove Engineering from sidebar" }));
    expect(screen.getByText("1/5")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Show Engineering in sidebar" }));

    await actor.type(screen.getByLabelText("Search favourite spaces"), "ops");
    expect(screen.queryByText("Engineering")).toBeNull();
    await actor.click(screen.getByRole("button", { name: "Clear space search" }));
    await actor.type(screen.getByLabelText("Search favourite spaces"), "zzz");
    expect(screen.getByText("No favourite spaces match the current filters.")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Operations")).toBeInTheDocument();
  });

  it("won't add a sixth sidebar shortcut", async () => {
    const many = Array.from({ length: 6 }, (_, index) => space(`s${index}`, `K${index}`, `Space ${index}`));
    await openKnowledge({ favoriteSpaces: many });

    expect(screen.getByRole("button", { name: "Show Space 5 in sidebar" })).toBeDisabled();
  });

  it("filters pinned pages by space and label, and toggles sidebar shortcuts", async () => {
    mocked.get.mockImplementation(async (path: string) =>
      path === "/api/v1/users/me/page-labels"
        ? [label("ops", "OPS", "oncall"), label("guide", "ENG", "style")]
        : [],
    );
    const { actor } = await openKnowledge();
    await actor.click(screen.getByRole("button", { name: /Pinned pages/ }));

    await actor.click(screen.getByRole("button", { name: "Remove Runbook from sidebar" }));
    await actor.click(screen.getByRole("button", { name: "Show Runbook in sidebar" }));

    await actor.click(screen.getByRole("button", { name: "Filter by space" }));
    await actor.click(screen.getByRole("option", { name: "Operations" }));
    expect(screen.queryByText("Runbook")).toBeNull();
    await actor.click(screen.getByRole("option", { name: "Engineering" }));
    expect(screen.getByRole("button", { name: "Filter by space" })).toHaveTextContent("2 spaces");
    await actor.click(screen.getByRole("option", { name: "Engineering" }));
    await actor.type(screen.getByLabelText("Search spaces"), "zzz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();

    await actor.click(screen.getByRole("button", { name: "Filter by label" }));
    await actor.click(screen.getByRole("option", { name: "ops" }));
    expect(screen.getByText("On-call")).toBeInTheDocument();
    await actor.click(screen.getByRole("option", { name: "All labels" }));
    expect(screen.getByRole("button", { name: "Filter by label" })).toHaveTextContent("All labels");

    // A label narrows the space choices to spaces that carry it.
    await actor.click(screen.getByRole("button", { name: "Filter by label" }));
    await actor.click(screen.getByRole("option", { name: "ops" }));
    await actor.click(screen.getByRole("button", { name: "Filter by label" }));
    await actor.click(screen.getByRole("button", { name: "Filter by space" }));
    expect(screen.queryByRole("option", { name: "Engineering" })).toBeNull();
    await actor.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Runbook")).toBeInTheDocument();
  });

  it("says so when no pinned page matches", async () => {
    const { actor } = await openKnowledge({ pinnedPages: [] });
    await actor.click(screen.getByRole("button", { name: /Pinned pages/ }));

    expect(screen.getByText("No pinned pages match the current filters.")).toBeInTheDocument();
  });

  it("filters liked pages and pages through a long list", async () => {
    const liked = Array.from({ length: 12 }, (_, index) =>
      pin(`l${index}`, index % 2 ? "OPS" : "ENG", `p${index}`, `Liked ${index}`, index % 2 ? "Operations" : "Engineering"),
    );
    mocked.get.mockImplementation(async (path: string) =>
      path === "/api/v1/users/me/page-labels" ? [label("odd", "OPS", "p1")] : [],
    );
    const { actor } = await openKnowledge({ likedPages: liked });
    await actor.click(screen.getByRole("button", { name: /Liked pages/ }));

    expect(screen.getByText("Showing 1–10 of 12")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Liked 11")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Previous page" }));
    await actor.click(screen.getByRole("button", { name: "Next page" }));
    await actor.selectOptions(screen.getByLabelText("Rows"), "25");
    expect(screen.getByText("Showing 1–12 of 12")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Filter by label" }));
    await actor.click(screen.getByRole("option", { name: "odd" }));
    expect(screen.getAllByText(/^Liked \d+$/)).toHaveLength(1);
    await actor.click(screen.getByRole("button", { name: "Filter by space" }));
    expect(screen.getByRole("option", { name: "Operations" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Engineering" })).toBeNull();
    await actor.click(screen.getByRole("option", { name: "Operations" }));
    await actor.click(screen.getByRole("option", { name: "Operations" }));
    fireEvent.pointerDown(screen.getByRole("listbox"));
    await actor.click(screen.getByRole("option", { name: "All spaces" }));
    await actor.click(screen.getByRole("button", { name: /Saved for later/ }));
    await actor.click(screen.getByRole("button", { name: /Liked pages/ }));
    await actor.click(screen.getByRole("button", { name: "Filter by label" }));
    await actor.click(screen.getByRole("option", { name: "odd" }));
    await actor.click(screen.getByRole("button", { name: "Filter by space" }));
    await actor.click(screen.getByRole("option", { name: "Operations" }));
    await actor.click(screen.getByRole("button", { name: "Filter by label" }));
    await actor.click(screen.getByRole("option", { name: "odd" }));
    expect(screen.getAllByText(/^Liked \d+$/).length).toBeGreaterThan(1);
  });

  it("says so when no liked page matches", async () => {
    const { actor } = await openKnowledge({ likedPages: [] });
    await actor.click(screen.getByRole("button", { name: /Liked pages/ }));

    expect(screen.getByText("No liked pages match the current filters.")).toBeInTheDocument();
  });

  it("lists pages saved for later, naming spaces and dropping pages that are gone", async () => {
    window.localStorage.setItem(
      "wikihub:saved-page-keys",
      JSON.stringify(["ENG/guide", "OPS/gone", "LOST/missing", "BAD", 7]),
    );
    mocked.get.mockImplementation(async (path: string) => {
      if (path === "/api/v1/users/me/page-labels") return [label("keep", "ENG", "guide")];
      if (path === "/api/v1/spaces/ENG/pages/guide") return { title: "Style guide" };
      if (path === "/api/v1/spaces/OPS/pages/gone") throw new ApiError(404, "not_found", "Gone.");
      if (path === "/api/v1/spaces/LOST/pages/missing") throw new ApiError(403, "forbidden", "No.");
      if (path === "/api/v1/spaces/ENG") return { name: "Engineering" };
      throw new Error("offline");
    });
    const { actor } = await openKnowledge();
    await actor.click(screen.getByRole("button", { name: /Saved for later/ }));
    await act(async () => vi.advanceTimersByTime(1));

    expect(await screen.findByText("Style guide")).toBeInTheDocument();
    expect(screen.getAllByText("Engineering").length).toBeGreaterThan(0);
    // A 404 prunes the key everywhere; a permission error only marks it.
    await waitFor(() => expect(screen.queryByText("gone")).toBeNull());
    expect(JSON.parse(window.localStorage.getItem("wikihub:saved-page-keys")!)).not.toContain("OPS/gone");
    expect(screen.getByText("missing")).toBeInTheDocument();
    expect(screen.getAllByText("No longer available").length).toBeGreaterThan(0);

    await actor.click(screen.getByRole("button", { name: "Filter by label" }));
    await actor.click(screen.getByRole("option", { name: "keep" }));
    expect(screen.queryByText("missing")).toBeNull();
    await actor.click(screen.getByRole("button", { name: "Filter by space" }));
    expect(screen.getByRole("option", { name: "Engineering" })).toBeInTheDocument();
  });

  it("re-reads saved pages when another tab or the sidebar changes them", async () => {
    mocked.get.mockImplementation(async (path: string) => {
      if (path === "/api/v1/users/me/page-labels") throw new Error("offline");
      if (path.startsWith("/api/v1/spaces/ENG/pages/")) return { title: "Fresh" };
      return { name: "Engineering" };
    });
    const { actor } = await openKnowledge();
    await actor.click(screen.getByRole("button", { name: /Saved for later/ }));
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByText("No saved pages match the current filters.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Saved for later" })).toHaveAttribute("href", "/saved");

    window.localStorage.setItem("wikihub:saved-page-keys", JSON.stringify(["ENG/new"]));
    act(() => window.dispatchEvent(new Event("wikihub:saved-pages-changed")));
    expect(await screen.findByText("Fresh")).toBeInTheDocument();

    window.localStorage.setItem("wikihub:saved-page-keys", "{broken");
    act(() => window.dispatchEvent(new Event("storage")));
    expect(screen.getByText("No saved pages match the current filters.")).toBeInTheDocument();

    window.localStorage.setItem("wikihub:saved-page-keys", JSON.stringify({ not: "a list" }));
    act(() => window.dispatchEvent(new Event("storage")));
    expect(screen.getByText("No saved pages match the current filters.")).toBeInTheDocument();
  });

  it("prunes a dead page even if storage was overwritten with something else meanwhile", async () => {
    window.localStorage.setItem("wikihub:saved-page-keys", JSON.stringify(["ENG/gone"]));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    mocked.get.mockImplementation(async (path: string) => {
      if (path === "/api/v1/spaces/ENG/pages/gone") {
        await gate;
        throw new ApiError(404, "not_found", "Gone.");
      }
      if (path === "/api/v1/spaces/ENG") return { name: "Engineering" };
      return [];
    });
    renderProfile();
    await act(async () => vi.advanceTimersByTime(1));

    window.localStorage.setItem("wikihub:saved-page-keys", JSON.stringify({ not: "a list" }));
    await act(async () => release());

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("wikihub:saved-page-keys")!)).toEqual([]),
    );
  });

  it("copes with storage that stops working while pruning a dead page", async () => {
    window.localStorage.setItem("wikihub:saved-page-keys", JSON.stringify(["ENG/gone", "ENG/x"]));
    mocked.get.mockImplementation(async (path: string) => {
      if (path === "/api/v1/spaces/ENG/pages/gone") throw new ApiError(404, "not_found", "Gone.");
      if (path === "/api/v1/spaces/ENG/pages/x") return { title: "Kept" };
      if (path === "/api/v1/spaces/ENG") return { name: "Engineering" };
      return [];
    });
    // The first read (on mount) works; pruning the dead key then finds
    // storage blocked. Nothing throws - and with storage unreadable the
    // re-read that follows treats the list as empty.
    const getItem = Storage.prototype.getItem;
    let savedReads = 0;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (key === "wikihub:saved-page-keys" && ++savedReads > 1) throw new Error("blocked");
      return getItem.call(this, key);
    });
    const { actor } = await openKnowledge();
    await actor.click(screen.getByRole("button", { name: /Saved for later/ }));
    await act(async () => vi.advanceTimersByTime(1));

    expect(
      await screen.findByText("No saved pages match the current filters."),
    ).toBeInTheDocument();
    expect(savedReads).toBeGreaterThan(1);
  });

  it("ignores saved-page results that arrive after leaving the profile", async () => {
    window.localStorage.setItem("wikihub:saved-page-keys", JSON.stringify(["ENG/late"]));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    mocked.get.mockImplementation(async (path: string) => {
      if (path === "/api/v1/users/me/page-labels") return [];
      await gate;
      if (path.includes("/pages/")) throw new ApiError(404, "not_found", "Gone.");
      return { name: "Engineering" };
    });
    const { view } = renderProfile();
    await act(async () => vi.advanceTimersByTime(1));

    view.unmount();
    await act(async () => release());

    expect(JSON.parse(window.localStorage.getItem("wikihub:saved-page-keys")!)).toEqual(["ENG/late"]);
  });
});
