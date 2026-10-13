import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);

const PROFILE = {
  username: "alice",
  full_name: "Alice Nguyen",
  avatar_url: "/alice.png",
  bio: "",
  pronouns: "",
  profile_url: "",
  social_links: [],
  company: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.get.mockResolvedValue(PROFILE);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("UserProfileTrigger details", () => {
  it("shows an avatar button with initials and the profile picture once loaded", async () => {
    const actor = userEvent.setup();
    render(<UserProfileTrigger username="alice" fullName="Alice Nguyen" variant="avatar" />);
    const button = screen.getByRole("button", { name: /Alice Nguyen/ });
    expect(button).toHaveTextContent("AN");

    await actor.click(button);
    expect(await screen.findByRole("link", { name: "View profile" })).toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute("src", "/alice.png");
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/users/alice/profile");
  });

  it("falls back to an icon when there is no name at all", () => {
    render(<UserProfileTrigger username="" fullName="" variant="avatar" />);
    expect(screen.getByRole("button").querySelector("svg")).not.toBeNull();
  });

  it("shows a loading state, then bio and company", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocked.get.mockReturnValue(new Promise((r) => (resolve = r)));
    const actor = userEvent.setup();
    render(<UserProfileTrigger username="alice" fullName="Alice Nguyen" />);
    await actor.click(screen.getByRole("button", { name: "Alice Nguyen" }));
    expect(await screen.findByText("Loading profile…")).toBeInTheDocument();

    await act(async () =>
      resolve({ ...PROFILE, avatar_url: null, bio: "Writes docs.", company: "Acme" }),
    );
    expect(await screen.findByText("Writes docs.")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("AN")).toBeInTheDocument();
  });

  it("uses the username when the profile has no display name or initials", async () => {
    mocked.get.mockResolvedValue({ ...PROFILE, full_name: "", username: "", avatar_url: null });
    const actor = userEvent.setup();
    render(<UserProfileTrigger username="alice" />);
    await actor.click(screen.getByRole("button", { name: "alice" }));
    expect(await screen.findByRole("link", { name: "View profile" })).toBeInTheDocument();
    expect(document.querySelector("svg.lucide-user-round")).not.toBeNull();
  });

  it("reports an unavailable profile and does not retry on reopen", async () => {
    mocked.get.mockRejectedValue(new Error("nope"));
    const actor = userEvent.setup();
    render(<UserProfileTrigger username="alice" fullName="Alice Nguyen" />);
    const button = screen.getByRole("button", { name: "Alice Nguyen" });
    await actor.click(button);
    expect(await screen.findByText("Profile information is unavailable.")).toBeInTheDocument();

    await actor.keyboard("{Escape}");
    await actor.click(button);
    expect(mocked.get).toHaveBeenCalledTimes(1);
  });

  it("opens on hover after a short delay and closes shortly after leaving", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<UserProfileTrigger username="alice" fullName="Alice Nguyen" openOnHover />);
    const button = screen.getByRole("button", { name: "Alice Nguyen" });

    fireEvent.mouseEnter(button);
    fireEvent.mouseLeave(button);
    fireEvent.mouseEnter(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(await screen.findByRole("link", { name: "View profile" })).toBeInTheDocument();

    fireEvent.mouseLeave(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.queryByRole("link", { name: "View profile" })).not.toBeInTheDocument();
  });

  it("keeps the card open while the pointer is on it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<UserProfileTrigger username="alice" fullName="Alice Nguyen" variant="avatar" openOnHover />);
    const button = screen.getByRole("button");
    fireEvent.mouseEnter(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const link = await screen.findByRole("link", { name: "View profile" });
    const card = link.closest("[data-radix-popper-content-wrapper]")!.firstElementChild!;
    fireEvent.mouseLeave(button);
    fireEvent.mouseEnter(card);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByRole("link", { name: "View profile" })).toBeInTheDocument();
    fireEvent.mouseLeave(card);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.queryByRole("link", { name: "View profile" })).not.toBeInTheDocument();
  });

  it("ignores hover when it is not enabled, and clears a pending timer on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const plain = render(<UserProfileTrigger username="alice" fullName="Alice Nguyen" />);
    fireEvent.mouseEnter(screen.getByRole("button"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(mocked.get).not.toHaveBeenCalled();
    plain.unmount();

    const hover = render(<UserProfileTrigger username="alice" fullName="Alice Nguyen" openOnHover />);
    fireEvent.mouseEnter(screen.getByRole("button"));
    hover.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(mocked.get).not.toHaveBeenCalled();
  });
});
