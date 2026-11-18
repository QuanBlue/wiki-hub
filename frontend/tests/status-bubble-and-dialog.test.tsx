import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  UserStatusBubble,
  UserStatusDialog,
  isUserStatusActive,
} from "@/components/account/status-dialog";
import { api } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    patch: vi.fn(),
  },
}));

describe("UserStatusBubble", () => {
  it("renders null for non-owner when user has no status", () => {
    const { container } = render(
      <UserStatusBubble
        user={{ status_emoji: null, status_text: null }}
        isOwner={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders dimmed 'What\\'s happening?' thought bubble for owner when status is not set", () => {
    const handleClick = vi.fn();
    render(
      <UserStatusBubble
        user={{ status_emoji: null, status_text: null }}
        isOwner={true}
        onClick={handleClick}
      />,
    );

    const bubble = screen.getByRole("button", { name: /set status/i });
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveTextContent(/what's happening/i);

    fireEvent.click(bubble);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("renders thought bubble with emoji and text when status is active", () => {
    const handleClick = vi.fn();
    render(
      <UserStatusBubble
        user={{
          status_emoji: "🔥",
          status_text: "Excited about new release",
          status_expires_at: new Date(Date.now() + 3600000).toISOString(),
        }}
        isOwner={true}
        onClick={handleClick}
      />,
    );

    const bubble = screen.getByRole("button", { name: /update status/i });
    expect(bubble).toHaveTextContent("🔥");
    expect(bubble).toHaveTextContent("Excited about new release");

    fireEvent.click(bubble);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("treats expired status as inactive and hides it from non-owner", () => {
    const { container } = render(
      <UserStatusBubble
        user={{
          status_emoji: "🏖️",
          status_text: "On vacation",
          status_expires_at: new Date(Date.now() - 3600000).toISOString(),
        }}
        isOwner={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("UserStatusDialog", () => {
  it("renders status dialog with preset options and saves new status", async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    const handleUpdated = vi.fn();

    vi.mocked(api.patch).mockResolvedValueOnce({
      id: "u1",
      username: "alice",
      status_emoji: "🟢",
      status_text: "Free to chat",
    } as any);

    render(
      <UserStatusDialog
        open={true}
        onOpenChange={handleClose}
        user={{ status_emoji: null, status_text: null }}
        onUpdated={handleUpdated}
      />,
    );

    expect(screen.getByRole("heading", { name: /about/i })).toBeInTheDocument();
    expect(screen.getByText("0/140")).toBeInTheDocument();

    // Click preset "Free to chat"
    const presetBtn = screen.getByRole("button", { name: /free to chat/i });
    await user.click(presetBtn);

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("Free to chat");

    // Counter updates
    expect(screen.getByText("12/140")).toBeInTheDocument();

    // Save button
    const saveBtn = screen.getByRole("button", { name: /save status/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        "/api/v1/users/me",
        expect.objectContaining({
          status_emoji: "🟢",
          status_text: "Free to chat",
        }),
      );
    });
    expect(handleClose).toHaveBeenCalledWith(false);
  });

  it("shows delete trash button when status is active and allows clearing", async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();

    vi.mocked(api.patch).mockResolvedValueOnce({
      id: "u1",
      username: "alice",
      status_emoji: null,
      status_text: null,
    } as any);

    render(
      <UserStatusDialog
        open={true}
        onOpenChange={handleClose}
        user={{
          status_emoji: "☕",
          status_text: "Grabbing coffee",
          status_expires_at: new Date(Date.now() + 3600000).toISOString(),
        }}
      />,
    );

    const deleteBtn = screen.getByRole("button", { name: /delete status/i });
    expect(deleteBtn).toBeInTheDocument();

    await user.click(deleteBtn);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/api/v1/users/me", {
        clear_status: true,
      });
    });
    expect(handleClose).toHaveBeenCalledWith(false);
  });

  it("clears text with quick X clear button", async () => {
    const user = userEvent.setup();

    render(
      <UserStatusDialog
        open={true}
        onOpenChange={vi.fn()}
        user={{
          status_emoji: "💬",
          status_text: "Testing input clear",
        }}
      />,
    );

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("Testing input clear");

    const clearInputBtn = screen.getByRole("button", { name: /clear input/i });
    await user.click(clearInputBtn);

    expect(input).toHaveValue("");
    expect(screen.getByText("0/140")).toBeInTheDocument();
  });
});
