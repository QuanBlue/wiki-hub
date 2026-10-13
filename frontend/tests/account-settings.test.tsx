import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccountSettings } from "@/components/account/account-settings";
import type { Me } from "@/types/api";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/components/account/sessions-panel", () => ({
  SessionsPanel: () => <h2>Web sessions</h2>,
}));

const user: Me = {
  id: "user-1",
  username: "alice",
  email: "alice@example.com",
  full_name: "Alice Example",
  avatar_url: null,
  bio: "",
  pronouns: "",
  profile_url: "",
  social_links: [],
  company: "",
  is_active: true,
  is_superuser: false,
  is_effective_admin: false,
  is_protected: false,
  last_login_at: null,
  created_at: "2026-01-01T00:00:00Z",
  groups: [],
  group_memberships: [],
  global_permissions: [],
  global_permission_overrides: [],
  global_permissions_from_groups: [],
  impersonator: null,
};

describe("AccountSettings", () => {
  it("starts with a read-only profile and only shows profile inputs after Edit profile", async () => {
    const actor = userEvent.setup();
    render(<AccountSettings user={user} />);

    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Edit profile" }));

    expect(screen.getByLabelText("Display name")).toHaveValue("Alice Example");
    expect(screen.getByLabelText("Email address")).toHaveValue("alice@example.com");

    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
  });

  it("keeps password and session content isolated to their selected tabs", async () => {
    const actor = userEvent.setup();
    render(<AccountSettings user={user} />);

    await actor.click(screen.getByRole("tab", { name: "Password & authentication" }));
    expect(screen.getByRole("heading", { name: "Sign-in methods" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Profile" })).not.toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByRole("heading", { name: "Change account password" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();

    await actor.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(screen.getByRole("heading", { name: "Web sessions" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  });
});

describe("AccountSettings - keyboard and shortcuts", () => {
  it("moves between tabs with the arrow keys, wrapping at both ends", async () => {
    const actor = userEvent.setup();
    render(<AccountSettings user={user} />);
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();

    await actor.keyboard("{ArrowDown}");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveFocus();
    await actor.keyboard("{ArrowUp}{ArrowUp}");
    expect(tabs[tabs.length - 1]).toHaveAttribute("aria-selected", "true");
    await actor.keyboard("{ArrowDown}");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    // Other keys leave the selection alone.
    await actor.keyboard("{ArrowRight}");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("shows the keyboard shortcuts settings", async () => {
    const actor = userEvent.setup();
    render(<AccountSettings user={user} />);
    await actor.click(screen.getByRole("tab", { name: /shortcuts/i }));
    expect(await screen.findByRole("heading", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });
});
