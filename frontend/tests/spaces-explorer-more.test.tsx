import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SpacesExplorer } from "@/components/spaces/spaces-explorer";
import { api } from "@/lib/api-client";
import type { Space } from "@/types/api";

const m = vi.hoisted(() => ({ refresh: vi.fn(), tab: null as string | null, toastError: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: m.refresh, push: vi.fn() }),
  useSearchParams: () => ({ get: (key: string) => (key === "tab" ? m.tab : null) }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: m.toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/components/admin/edit-space-modal", () => ({
  EditSpaceModal: ({ open, space }: { open: boolean; space: Space }) =>
    open ? <div role="dialog">edit {space.key}</div> : null,
}));

const mocked = vi.mocked(api);

function space(n: number, overrides: Partial<Space> = {}): Space {
  return {
    id: `s${n}`,
    key: `K${n}`,
    name: `Space ${n}`,
    description: `Docs ${n}`,
    icon: "",
    status: "active",
    visibility: "open",
    created_at: "2026-01-01T00:00:00Z",
    owners: [],
    is_owner: false,
    member_count: n,
    group_permission_count: 0,
    is_favorite: false,
    my_role: "admin",
    my_permissions: [],
    created_by_username: "admin",
    ...overrides,
  } as unknown as Space;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.tab = null;
  mocked.put.mockResolvedValue(undefined);
  mocked.delete.mockResolvedValue(undefined);
});

describe("SpacesExplorer", () => {
  it("opens on the tab named in the URL", () => {
    m.tab = "starred";
    render(<SpacesExplorer spaces={[space(1, { is_favorite: true }), space(2)]} />);
    expect(screen.getByText("Space 1")).toBeInTheDocument();
    expect(screen.queryByText("Space 2")).not.toBeInTheDocument();
  });

  it("filters by name, key or description and offers to clear", async () => {
    const actor = userEvent.setup();
    render(<SpacesExplorer spaces={[space(1), space(2, { icon: "🚀", visibility: "restricted", status: "archived" })]} />);
    const search = screen.getByPlaceholderText("Search spaces");
    await actor.type(search, "docs 2");
    expect(screen.getByText("Space 2")).toBeInTheDocument();
    expect(screen.queryByText("Space 1")).not.toBeInTheDocument();
    expect(screen.getByText("🚀")).toBeInTheDocument();
    expect(screen.getByText("archived")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Clear space search" }));
    expect(screen.getByText("Space 1")).toBeInTheDocument();

    await actor.type(search, "k1");
    expect(screen.getByText("Space 1")).toBeInTheDocument();
    await actor.clear(search);
    await actor.type(search, "nothing");
    expect(screen.getByText("No spaces match your search")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("Space 1")).toBeInTheDocument();
  });

  it("explains each empty tab", async () => {
    const actor = userEvent.setup();
    const { rerender } = render(<SpacesExplorer spaces={[]} />);
    expect(screen.getByText("No spaces found")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: /^Favorite/ }));
    expect(screen.getByText("No favorite spaces yet")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: /^Own/ }));
    expect(screen.getByText("You don't own any spaces yet")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: /^All/ }));
    rerender(<SpacesExplorer spaces={[]} />);
    expect(screen.getByText("No spaces found")).toBeInTheDocument();
  });

  it("paginates and changes the page size", async () => {
    const actor = userEvent.setup();
    const many = Array.from({ length: 27 }, (_, i) => space(i + 1));
    render(<SpacesExplorer spaces={many} />);
    expect(screen.getByText("Showing 1–10 of 27")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Showing 11–20 of 27")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Showing 21–27 of 27")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    await actor.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByText("Showing 11–20 of 27")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Rows per page" }));
    await actor.click(await screen.findByRole("menuitemradio", { name: "25" }));
    expect(screen.getByText("Showing 1–25 of 27")).toBeInTheDocument();
  });

  it("toggles a favourite and rolls back on failure", async () => {
    const actor = userEvent.setup();
    render(<SpacesExplorer spaces={[space(1), space(2, { is_favorite: true })]} />);
    await actor.click(screen.getByRole("button", { name: "Add Space 1 to favourites" }));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/K1/favorite"));
    expect(m.refresh).toHaveBeenCalled();

    await actor.click(screen.getByRole("button", { name: "Remove Space 2 from favourites" }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith("/api/v1/spaces/K2/favorite"));

    mocked.put.mockRejectedValueOnce(new Error("x"));
    await actor.click(screen.getByRole("button", { name: "Add Space 2 to favourites" }));
    await waitFor(() => expect(m.toastError).toHaveBeenCalledWith("Could not update favourites."));
    expect(screen.getByRole("button", { name: "Add Space 2 to favourites" })).toBeInTheDocument();
  });

  it("opens the edit modal for administrators only", async () => {
    const actor = userEvent.setup();
    render(
      <SpacesExplorer
        spaces={[
          space(1),
          space(2, { my_role: "viewer", my_permissions: ["admin"] } as Partial<Space>),
          space(3, { my_role: "viewer", my_permissions: [] } as Partial<Space>),
        ]}
      />,
    );
    const edits = screen.getAllByRole("button", { name: "Edit" });
    expect(edits.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false, true]);
    await actor.click(edits[0]);
    expect(within(screen.getByRole("dialog")).getByText("edit K1")).toBeInTheDocument();
  });
});
