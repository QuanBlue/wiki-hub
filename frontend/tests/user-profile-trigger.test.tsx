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
});
