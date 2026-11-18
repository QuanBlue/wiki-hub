import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UserProfileTrigger } from "@/components/users/user-profile-trigger";

describe("UserProfileTrigger", () => {
  it("opens a member summary on click and links to the full profile", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          username: "alice",
          full_name: "Alice Nguyen",
          avatar_url: null,
          bio: "Writes platform documentation.",
          pronouns: "she/her",
          profile_url: "",
          social_links: [],
          company: "Engineering",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<UserProfileTrigger username="alice" fullName="Alice Nguyen" />);
    await user.click(screen.getByRole("button", { name: "Alice Nguyen" }));

    expect(
      await screen.findByText("Writes platform documentation."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View profile" })).toHaveAttribute(
      "href",
      "/users/alice",
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("renders status speech callout when user has an active status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          username: "bob",
          full_name: "Bob Tran",
          avatar_url: null,
          bio: "",
          pronouns: "",
          profile_url: "",
          social_links: [],
          company: "",
          status_emoji: "⏰",
          status_text: "Slow to respond",
          status_expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<UserProfileTrigger username="bob" fullName="Bob Tran" />);
    await user.click(screen.getByRole("button", { name: "Bob Tran" }));

    expect(await screen.findByText("Slow to respond")).toBeInTheDocument();
    expect(screen.getByText("⏰")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View profile" })).toBeInTheDocument();
  });

  it("updates status immediately when wikihub:user-status-changed is dispatched", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          username: "carol",
          full_name: "Carol White",
          avatar_url: null,
          bio: "",
          pronouns: "",
          profile_url: "",
          social_links: [],
          company: "",
          status_emoji: null,
          status_text: null,
          status_expires_at: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<UserProfileTrigger username="carol" fullName="Carol White" />);
    await user.click(screen.getByRole("button", { name: "Carol White" }));

    expect(await screen.findByRole("link", { name: "View profile" })).toBeInTheDocument();
    expect(screen.queryByText("Working remotely")).not.toBeInTheDocument();

    // Dispatch status change event
    window.dispatchEvent(
      new CustomEvent("wikihub:user-status-changed", {
        detail: {
          username: "carol",
          status_emoji: "🏠",
          status_text: "Working remotely",
        },
      }),
    );

    expect(await screen.findByText("Working remotely")).toBeInTheDocument();
    expect(screen.getByText("🏠")).toBeInTheDocument();
  });
});
