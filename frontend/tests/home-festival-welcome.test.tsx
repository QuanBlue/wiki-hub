import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UserProfile } from "@/components/users/user-profile";
import { api } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/i18n/context";
import type { PublicUser, SeasonalEffectPresetId } from "@/types/api";

const seasonal = vi.hoisted(() => ({ preset: "none" as SeasonalEffectPresetId }));

vi.mock("@/components/theme-color-provider", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/components/theme-color-provider")>();
  return {
    ...mod,
    useThemeSettings: () => ({
      ...mod.useThemeSettings(),
      seasonalTheme: {
        preset: seasonal.preset,
        event_id: null,
        event_name_en: null,
        event_name_vi: null,
        source: "manual" as const,
      },
    }),
  };
});
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/components/users/contribution-chart", () => ({ ContributionChart: () => null }));

class FakeIntersectionObserver {
  observe() {}
  disconnect() {}
}

const USER: PublicUser = {
  username: "ann",
  full_name: "Ann Lee",
  avatar_url: null,
  bio: "",
  pronouns: "",
  profile_url: "",
  social_links: [],
  company: "",
  email: "ann@example.test",
  created_at: "2025-01-01T00:00:00Z",
  last_active_at: null,
  is_workspace_admin: false,
};

function visitHome(user: PublicUser = USER) {
  return render(
    <UserProfile
      user={user}
      initialActivity={{ items: [], next_cursor: null }}
      initialAllActivity={[]}
      stats={{ pages_updated: 0, pages_created: 0, spaces_contributed: 0 }}
      drafts={[]}
      isOwner
      isHome
      isAdmin={false}
      favoriteSpaces={[]}
      pinnedPages={[]}
      likedPages={[]}
    />,
    { wrapper: LocaleProvider },
  );
}

// The effects load on demand (next/dynamic); warm the chunk so tests only wait a tick.
beforeAll(() => import("@/components/users/welcome-effect-overlay"));
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  seasonal.preset = "none";
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.mocked(api.get).mockResolvedValue([]);
});

describe("Home welcome effect during a festival", () => {
  it("greets the member on every visit to Home", async () => {
    seasonal.preset = "christmas";
    const first = visitHome();
    expect(await screen.findByRole("status")).toHaveTextContent("Merry Christmas");
    first.unmount();

    visitHome();
    expect(await screen.findByRole("status")).toHaveTextContent("Merry Christmas");
  });

  it("stays quiet for the rest of the session once the member presses Skip", async () => {
    seasonal.preset = "christmas";
    const user = userEvent.setup();
    const first = visitHome();
    await user.click(await screen.findByRole("button", { name: /skip/i }));
    expect(screen.queryByRole("status")).toBeNull();
    first.unmount();

    visitHome();
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("still plays the member's own effect only once per session outside a festival", async () => {
    const withEffect: PublicUser = { ...USER, welcome_effect: "hacker", welcome_message: "Hi" };
    const first = visitHome(withEffect);
    expect(await screen.findByRole("status")).toHaveTextContent("Hi");
    first.unmount();

    visitHome(withEffect);
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a theme picker on Play when both festival and personal welcome themes exist", async () => {
    seasonal.preset = "christmas";
    const withEffect: PublicUser = {
      ...USER,
      welcome_effect: "hacker",
      welcome_message: "Hello from Hacker",
    };
    const user = userEvent.setup();
    visitHome(withEffect);

    // Initial visit auto-plays the festival effect; dismiss it first.
    await user.click(await screen.findByRole("button", { name: /skip/i }));
    expect(screen.queryByRole("status")).toBeNull();

    // Clicking Play opens a menu with both options instead of immediately playing.
    await user.click(screen.getByRole("button", { name: /replay welcome/i }));
    const festivalOption = await screen.findByRole("menuitem", { name: /festival theme/i });
    const personalOption = screen.getByRole("menuitem", { name: /my welcome theme/i });
    expect(festivalOption).toHaveTextContent(/christmas/i);
    expect(personalOption).toHaveTextContent(/hacker/i);

    // Choosing the personal theme plays the member's welcome effect and greeting.
    await user.click(personalOption);
    expect(await screen.findByRole("status")).toHaveTextContent("Hello from Hacker");
    await user.click(screen.getByRole("button", { name: /skip/i }));

    // Re-opening Play and choosing the festival theme plays the festival greeting.
    await user.click(screen.getByRole("button", { name: /replay welcome/i }));
    await user.click(await screen.findByRole("menuitem", { name: /festival theme/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("Merry Christmas");
  });

  it("plays directly without a menu when only the festival theme is active", async () => {
    seasonal.preset = "christmas";
    const user = userEvent.setup();
    visitHome();

    await user.click(await screen.findByRole("button", { name: /skip/i }));
    expect(screen.queryByRole("status")).toBeNull();

    await user.click(screen.getByRole("button", { name: /replay welcome/i }));
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent("Merry Christmas");
  });
});
