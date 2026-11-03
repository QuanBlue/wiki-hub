import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WatchButton } from "@/components/pages/watch-button";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import type { Space, WikiPage } from "@/types/api";

vi.mock("@/lib/api-client", () => ({
  api: {
    put: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockSpace: Space = {
  id: "s-1",
  key: "DEV",
  name: "Development",
  description: "Dev space",
  icon: "code",
  status: "active",
  visibility: "open",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_username: "admin",
  owners: [],
  group_permission_count: 0,
  direct_user_permission_count: 0,
  is_favorite: false,
  is_watched: false,
  is_owner: false,
  member_count: 0,
  my_role: "admin",
};

const mockPage: WikiPage = {
  id: "p-1",
  space_id: "s-1",
  parent_id: null,
  title: "Architecture Guide",
  slug: "architecture-guide",
  content: "Hello world",
  content_format: "html",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_username: "admin",
  updated_by_username: "admin",
  is_watched: false,
  watch_descendants: false,
};

describe("WatchButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with initial unwatched state and opens menu", async () => {
    const user = userEvent.setup();
    render(<WatchButton space={mockSpace} page={mockPage} />);

    const button = screen.getByRole("button", { name: /watch/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);

    expect(screen.getByText("Watch this page")).toBeInTheDocument();
    expect(screen.getByText("Watch page and children")).toBeInTheDocument();
    expect(screen.getByText("Watch entire space")).toBeInTheDocument();
  });

  it("toggles page watch on click", async () => {
    const user = userEvent.setup();
    const onPageWatchChange = vi.fn();

    vi.mocked(api.put).mockResolvedValueOnce({
      watching: true,
      include_descendants: false,
    });

    render(
      <WatchButton
        space={mockSpace}
        page={mockPage}
        onPageWatchChange={onPageWatchChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /watch/i }));
    await user.click(screen.getByText("Watch this page"));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        "/api/v1/spaces/DEV/pages/architecture-guide/watch",
        { watching: true, include_descendants: false },
      );
      expect(onPageWatchChange).toHaveBeenCalledWith(true, false);
    });
  });

  it("toggles branch watch with include_descendants", async () => {
    const user = userEvent.setup();
    const onPageWatchChange = vi.fn();

    vi.mocked(api.put).mockResolvedValueOnce({
      watching: true,
      include_descendants: true,
    });

    render(
      <WatchButton
        space={mockSpace}
        page={mockPage}
        onPageWatchChange={onPageWatchChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /watch/i }));
    await user.click(screen.getByText("Watch page and children"));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        "/api/v1/spaces/DEV/pages/architecture-guide/watch",
        { watching: true, include_descendants: true },
      );
      expect(onPageWatchChange).toHaveBeenCalledWith(true, true);
    });
  });

  it("toggles space watch", async () => {
    const user = userEvent.setup();
    const onSpaceWatchChange = vi.fn();

    vi.mocked(api.put).mockResolvedValueOnce({
      watching: true,
    });

    render(
      <WatchButton
        space={mockSpace}
        page={mockPage}
        onSpaceWatchChange={onSpaceWatchChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /watch/i }));
    await user.click(screen.getByText("Watch entire space"));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith("/api/v1/spaces/DEV/watch", {
        watching: true,
      });
      expect(onSpaceWatchChange).toHaveBeenCalledWith(true);
    });
  });

  it("reports failed page and space watch updates", async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockRejectedValue(new Error("offline"));
    render(<WatchButton space={mockSpace} page={mockPage} />);

    await user.click(screen.getByRole("button", { name: /watch/i }));
    await user.click(screen.getByText("Watch this page"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

    await user.click(screen.getByText("Watch entire space"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
  });
});
