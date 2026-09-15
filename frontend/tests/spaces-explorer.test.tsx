import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SpacesExplorer } from "@/components/spaces/spaces-explorer";
import type { Space } from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

/** `EditSpaceModal` only mounts its content when opened (see its own
 * `open ? <EditSpaceModalContent .../> : null`), so a `SpacesExplorer` test
 * that never clicks "Edit" needs no `api` mock at all - nothing here fires
 * a network request. */
function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: overrides.id ?? "space-1",
    key: overrides.key ?? "ENG",
    name: overrides.name ?? "Engineering",
    description: "",
    icon: "",
    font_family: null,
    max_upload_size_mb: null,
    status: "active",
    visibility: "open",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by_username: "admin",
    owners: [{ user_id: "u-admin", username: "admin", full_name: "WikiHub Administrator" }],
    is_owner: false,
    member_count: 1,
    group_permission_count: 0,
    direct_user_permission_count: 0,
    is_favorite: false,
    my_role: "admin",
    my_permissions: [],
    ...overrides,
  };
}

describe("SpacesExplorer - Own tab and Owner column", () => {
  it("shows the count of spaces the current user owns, and filters to just those on click", async () => {
    const actor = userEvent.setup();
    const owned = makeSpace({ id: "s1", key: "OWN", name: "Mine", is_owner: true });
    const notOwned = makeSpace({ id: "s2", key: "OTHER", name: "Someone else's", is_owner: false });
    render(<SpacesExplorer spaces={[owned, notOwned]} />);

    expect(screen.getByRole("button", { name: /^own \(1\)$/i })).toBeInTheDocument();
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.getByText("Someone else's")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: /^own \(1\)$/i }));

    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.queryByText("Someone else's")).not.toBeInTheDocument();
  });

  it("shows an empty state naming the tab when the user owns nothing", async () => {
    const actor = userEvent.setup();
    render(<SpacesExplorer spaces={[makeSpace({ is_owner: false })]} />);

    await actor.click(screen.getByRole("button", { name: /^own \(0\)$/i }));

    expect(screen.getByText(/don't own any spaces yet/i)).toBeInTheDocument();
  });

  it("shows a single owner's username, or the first plus a count for several", () => {
    const oneOwner = makeSpace({
      id: "s1",
      key: "ONE",
      name: "Solo owned",
      owners: [{ user_id: "u1", username: "alice", full_name: "Alice" }],
    });
    const manyOwners = makeSpace({
      id: "s2",
      key: "MANY",
      name: "Co-owned",
      owners: [
        { user_id: "u1", username: "alice", full_name: "Alice" },
        { user_id: "u2", username: "bob", full_name: "Bob" },
      ],
    });
    render(<SpacesExplorer spaces={[oneOwner, manyOwners]} />);

    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("@alice +1")).toBeInTheDocument();
  });

  it("falls back to the space's creator when it has no tracked Owner", () => {
    render(
      <SpacesExplorer
        spaces={[
          makeSpace({ owners: [], created_by_username: "legacycreator" }),
        ]}
      />,
    );

    expect(screen.getByText("@legacycreator")).toBeInTheDocument();
  });
});

describe("SpacesExplorer - Edit space access", () => {
  it("enables the row's Edit button for an Owner/Admin, disables it (with a tooltip) for anyone else", () => {
    const admin = makeSpace({ id: "s1", key: "ADM", name: "Administered" });
    const viewerOnly = makeSpace({
      id: "s2",
      key: "OPEN",
      name: "Open to everyone",
      my_role: null,
      // An Open space still hands regular members `add`/`view`/etc. (see
      // the permission service) - `admin` is the one permission that stays
      // opt-in, so this is what a non-admin member's row actually looks
      // like, not an empty list.
      my_permissions: ["view", "add"],
    });
    render(<SpacesExplorer spaces={[admin, viewerOnly]} />);

    // Every row gets an Edit button - a non-admin viewer's is disabled
    // (with an explanatory tooltip) rather than hidden outright, so they
    // can see the row's full space-administration action exists without
    // being able to open it. See `canAdmin` in `spaces-explorer.tsx`.
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    expect(editButtons).toHaveLength(2);
    expect(editButtons[0]).toBeEnabled();
    expect(editButtons[1]).toBeDisabled();
    expect(editButtons[1]).toHaveAttribute(
      "title",
      "Only this space's Owner or an Admin can edit it.",
    );
  });
});
