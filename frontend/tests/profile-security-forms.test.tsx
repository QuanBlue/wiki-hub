import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChangePasswordForm } from "@/components/account/change-password-form";
import { ProfileForm } from "@/components/account/profile-form";
import type { Me } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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

describe("account profile and security forms", () => {
  it("validates profile URL fields immediately after they lose focus", async () => {
    const actor = userEvent.setup();
    render(<ProfileForm user={user} onCancel={vi.fn()} onSaved={vi.fn()} />);

    const website = screen.getByLabelText("Website");
    await actor.type(website, "not-a-url");
    await actor.tab();

    expect(screen.getByText("Website must be a valid URL.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("keeps password submission disabled until a current password and every new-password rule are met", async () => {
    const actor = userEvent.setup();
    render(<ChangePasswordForm />);

    const submit = screen.getByRole("button", { name: "Change password" });
    expect(submit).toBeDisabled();

    await actor.type(screen.getByLabelText("Current password"), "Current1!");
    await actor.click(screen.getByRole("button", { name: "Generate password" }));

    expect(screen.getByText("At least 8 characters")).toBeInTheDocument();
    expect(screen.getByText("An uppercase and lowercase letter")).toBeInTheDocument();
    expect(screen.getByText("A number or special character")).toBeInTheDocument();
    expect(screen.getByText("Passwords match")).toBeInTheDocument();
    expect(submit).toBeEnabled();
  });
});
