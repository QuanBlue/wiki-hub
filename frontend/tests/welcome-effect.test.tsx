import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WelcomeEffectDialog } from "@/components/users/welcome-effect-dialog";
import { WelcomeEffectOverlay } from "@/components/users/welcome-effect-overlay";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { api } from "@/lib/api-client";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe("WelcomeEffectOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true, // reduced motion in jsdom so canvas isn't required
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it("renders owner greeting and custom message, and allows skipping", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    render(
      <WelcomeEffectOverlay
        effect="phoenix"
        ownerName="Alice"
        message="Welcome to my sanctuary!"
        onComplete={onComplete}
      />,
    );

    expect(screen.getByText("Welcome to Alice's Home")).toBeInTheDocument();
    expect(screen.getByText("Welcome to my sanctuary!")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("hides the greeting banner text when no custom greeting is set", () => {
    render(
      <WelcomeEffectOverlay
        effect="hacker"
        ownerName="Alice"
        message=""
        onComplete={vi.fn()}
      />,
    );

    expect(screen.queryByText("Welcome to Alice's Home")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });
});

describe("WelcomeEffectDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it("lets permitted owner preview a theme in the stacked Home preview modal and save via /users/me", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();

    mockedApi.patch.mockResolvedValueOnce({
      username: "alice",
      welcome_effect: "hacker",
      welcome_message: "Access granted",
    });

    render(
      <WelcomeEffectDialog
        open
        onOpenChange={onOpenChange}
        targetName="Alice"
        targetUsername="alice"
        isOwner
        initialEffect=""
        initialMessage=""
        onPreview={onPreview}
        onSaved={onSaved}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Preview Hacker" }));
    expect(onPreview).toHaveBeenCalledWith("hacker", "");
    expect(
      screen.getByRole("heading", { name: "Home preview — Hacker" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use this theme" }));

    const input = screen.getByLabelText("Custom greeting (optional)");
    await user.type(input, "Access granted");

    await user.click(screen.getByRole("button", { name: "Save effect" }));
    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith("/api/v1/users/me", {
        welcome_effect: "hacker",
        welcome_message: "Access granted",
      });
    });
    expect(onSaved).toHaveBeenCalledWith("hacker", "Access granted");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("lets administrator update another member's welcome effect via /users/{id}", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    mockedApi.patch.mockResolvedValueOnce({
      welcome_effect: "admin",
      welcome_message: "",
    });

    render(
      <WelcomeEffectDialog
        open
        onOpenChange={vi.fn()}
        targetUserId="user-123"
        targetName="Bob"
        isOwner={false}
        initialEffect=""
        initialMessage=""
        onPreview={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^Admin/i }));
    await user.click(screen.getByRole("button", { name: "Save effect" }));

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith("/api/v1/users/user-123", {
        welcome_effect: "admin",
        welcome_message: "",
      });
    });
    expect(onSaved).toHaveBeenCalledWith("admin", "");
  });
});

describe("UserProfileTrigger quick profile welcome effect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it("renders matching welcome theme badge and greeting in quick profile popover", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({
      username: "admin",
      full_name: "WikiHub Administrator",
      avatar_url: null,
      bio: "",
      pronouns: "",
      profile_url: "",
      social_links: [],
      company: "",
      welcome_effect: "phoenix",
      welcome_message: "Welcome to my home!",
      email: "admin@wikihub.local",
      created_at: "2026-01-01T00:00:00Z",
      last_active_at: null,
      is_workspace_admin: true,
    });

    render(<UserProfileTrigger username="admin" fullName="WikiHub Administrator" />);
    await user.click(screen.getByRole("button", { name: "WikiHub Administrator" }));

    await waitFor(() => {
      expect(screen.getByText("Welcome to my home!")).toBeInTheDocument();
    });
    expect(screen.getByText("Phoenix")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View profile" })).toBeInTheDocument();
  });
});
