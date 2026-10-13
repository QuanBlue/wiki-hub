import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecentActivityFeed } from "@/components/recent/recent-activity-feed";
import type { Me, RecentPageItem, Space } from "@/types/api";

vi.mock("@/components/pages/page-history-modal", () => ({
  PageHistoryModal: ({
    spaceKey,
    slug,
    pageTitle,
    onOpenChange,
  }: {
    spaceKey: string;
    slug: string;
    pageTitle: string;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div role="dialog" aria-label="history">
      {spaceKey}/{slug}/{pageTitle}
      <button onClick={() => onOpenChange(true)}>stay</button>
      <button onClick={() => onOpenChange(false)}>close</button>
    </div>
  ),
}));
vi.mock("@/components/users/user-profile-trigger", () => ({
  UserProfileTrigger: ({ username, variant }: { username: string; variant?: string }) => (
    <span data-testid={variant === "avatar" ? "avatar" : "name"}>{username}</span>
  ),
}));

function item(overrides: Partial<RecentPageItem>): RecentPageItem {
  return {
    id: "i1",
    title: "Runbook",
    slug: "run book",
    space_key: "ENG",
    space_name: "Engineering",
    updated_at: "2026-03-05T12:00:00Z",
    user_username: "ann",
    user_full_name: "Ann Lee",
    ...overrides,
  } as RecentPageItem;
}

function makeUser(overrides: Partial<Me> = {}): Me {
  return {
    username: "ann",
    full_name: "Ann Lee",
    email: "ann@example.com",
    avatar_url: null,
    ...overrides,
  } as Me;
}

function space(n: number, icon = ""): Space {
  return { id: `s${n}`, key: `K${n}`, name: `Space ${n}`, icon } as Space;
}

describe("RecentActivityFeed", () => {
  it("groups updates by person, with system updates shown plainly", () => {
    render(
      <RecentActivityFeed
        activities={[
          item({ id: "1" }),
          item({ id: "2", title: "Second" }),
          item({ id: "3", title: "Auto", user_username: null, user_full_name: null } as unknown as Partial<RecentPageItem>),
          item({ id: "4", title: "Nameless", user_username: "bob", user_full_name: null } as unknown as Partial<RecentPageItem>),
        ]}
        spaces={[]}
        user={makeUser()}
      />,
    );

    expect(screen.getByText("4 updates")).toBeInTheDocument();
    expect(screen.getAllByTestId("name").map((n) => n.textContent)).toEqual(["ann", "bob"]);
    expect(screen.getAllByTestId("avatar")).toHaveLength(2);
    expect(screen.getByText("system")).toBeInTheDocument();
    // The system group's avatar is its initials.
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Runbook" })).toHaveAttribute(
      "href",
      "/spaces/ENG/pages/run%20book",
    );
    expect(screen.getAllByText(/Updated Mar 5, 2026/).length).toBe(4);
  });

  it("shows an empty state", () => {
    render(<RecentActivityFeed activities={[]} spaces={[]} user={makeUser()} />);
    expect(screen.getByText("No updates yet")).toBeInTheDocument();
    expect(screen.getByText("0 updates")).toBeInTheDocument();
    expect(screen.getByText("No favorite spaces yet.")).toBeInTheDocument();
  });

  it("opens and closes the change history of a page", async () => {
    const actor = userEvent.setup();
    render(<RecentActivityFeed activities={[item({})]} spaces={[]} user={makeUser()} />);

    await actor.click(screen.getByRole("button", { name: "(view change)" }));
    expect(screen.getByRole("dialog", { name: "history" })).toHaveTextContent("ENG/run book/Runbook");
    await actor.click(screen.getByText("stay"));
    expect(screen.getByRole("dialog", { name: "history" })).toBeInTheDocument();
    await actor.click(screen.getByText("close"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists up to six favourite spaces with icon fallbacks", () => {
    const spaces = [space(1, "🚀"), ...[2, 3, 4, 5, 6, 7].map((n) => space(n))];
    render(<RecentActivityFeed activities={[]} spaces={spaces} user={makeUser()} />);
    expect(screen.getByRole("link", { name: /Space 1/ })).toHaveTextContent("🚀");
    expect(screen.getByRole("link", { name: /Space 2/ })).toHaveTextContent("📄");
    expect(screen.queryByText("Space 7")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find knowledge" })).toHaveAttribute("href", "/spaces");
  });

  it("shows the viewer's avatar, or initials built from their name", () => {
    const first = render(
      <RecentActivityFeed activities={[]} spaces={[]} user={makeUser({ avatar_url: "/me.png" })} />,
    );
    expect(document.querySelector("img")).toHaveAttribute("src", "/me.png");
    first.unmount();

    const second = render(<RecentActivityFeed activities={[]} spaces={[]} user={makeUser()} />);
    expect(screen.getByText("AL")).toBeInTheDocument();
    second.unmount();

    render(
      <RecentActivityFeed
        activities={[]}
        spaces={[]}
        user={makeUser({ full_name: "", username: "" })}
      />,
    );
    expect(screen.getByText("W")).toBeInTheDocument();
  });
});
