import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PagePresence } from "@/components/pages/page-presence";
import { api } from "@/lib/api-client";
import type { PresenceUser } from "@/types/api";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
  },
}));

describe("PagePresence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when users list is empty", () => {
    const { container } = render(<PagePresence users={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders active users and distinguishes viewing and editing", () => {
    const users: PresenceUser[] = [
      {
        user_id: "u-1",
        username: "alice",
        full_name: "Alice Smith",
        avatar_url: null,
        state: "viewing",
        last_seen: new Date().toISOString(),
      },
      {
        user_id: "u-2",
        username: "bob",
        full_name: "Bob Jones",
        avatar_url: null,
        state: "editing",
        last_seen: new Date().toISOString(),
      },
    ];

    render(<PagePresence users={users} />);

    // Renders initials
    expect(screen.getByText("AS")).toBeInTheDocument();
    expect(screen.getByText("BJ")).toBeInTheDocument();

    // Bob has editing pencil indicator
    expect(screen.getByTitle("Editing")).toBeInTheDocument();
  });

  it("can show avatars without the summary label", () => {
    const { container } = render(
      <PagePresence
        showLabel={false}
        users={[{ user_id: "u-1", username: "alice", full_name: "Alice", state: "viewing", last_seen: "" }]}
      />,
    );
    expect(container.querySelector("[title]")).toBeInTheDocument();
    expect(screen.queryByText("Viewing")).not.toBeInTheDocument();
  });

  it("opens profile hover card when avatar is clicked or hovered", async () => {
    const user = userEvent.setup();
    const users: PresenceUser[] = [
      {
        user_id: "u-1",
        username: "quannt39",
        full_name: "quannt39",
        avatar_url: null,
        state: "viewing",
        last_seen: new Date().toISOString(),
      },
    ];

    vi.mocked(api.get).mockResolvedValue({
      username: "quannt39",
      full_name: "quannt39",
      avatar_url: null,
      bio: "Software Engineer",
      pronouns: "",
      profile_url: "",
      social_links: [],
      company: "Company Inc",
    });

    render(<PagePresence users={users} />);

    // Click the avatar trigger
    const avatarBtn = screen.getByRole("button", { name: /quannt39/i });
    await user.click(avatarBtn);

    // Profile card displays full name, username, bio and View profile button
    await waitFor(() => {
      expect(screen.getByText("@quannt39")).toBeInTheDocument();
      expect(screen.getByText("View profile")).toBeInTheDocument();
      expect(screen.getAllByText("Viewing").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows overflow indicator when there are more than maxVisible users", async () => {
    const user = userEvent.setup();
    const users: PresenceUser[] = [
      { user_id: "1", username: "u1", full_name: "User One", state: "viewing", last_seen: "" },
      { user_id: "2", username: "u2", full_name: "User Two", state: "viewing", last_seen: "" },
      { user_id: "3", username: "u3", full_name: "User Three", state: "viewing", last_seen: "" },
      { user_id: "4", username: "u4", full_name: "User Four", state: "editing", last_seen: "" },
      { user_id: "5", username: "u5", full_name: "User Five", state: "viewing", last_seen: "" },
      { user_id: "6", username: "u6", full_name: "User Six", state: "viewing", last_seen: "" },
    ];

    render(<PagePresence users={users} maxVisible={4} />);

    // Shows first 4 and +2 badge
    expect(screen.getByText("+2")).toBeInTheDocument();

    // Clicking +2 opens popover with all users
    await user.click(screen.getByText("+2"));
    expect(screen.getByText("User Five")).toBeInTheDocument();
    expect(screen.getByText("User Six")).toBeInTheDocument();
  });
});
