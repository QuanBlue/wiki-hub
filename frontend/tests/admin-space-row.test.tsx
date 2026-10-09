import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminSpaceRow } from "@/components/admin/space-row-actions";
import { ApiError, api } from "@/lib/api-client";
import type { Space } from "@/types/api";

const { refresh, toastSuccess, toastError } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/components/admin/edit-space-modal", () => ({
  EditSpaceModal: ({ open, space }: { open: boolean; space: Space }) =>
    open ? (
      <div role="dialog" aria-label="edit modal">
        {space.key}
      </div>
    ) : null,
}));

const mocked = vi.mocked(api);

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "s1",
    key: "ENG",
    name: "Engineering",
    description: "Product docs",
    icon: "🛠",
    status: "active",
    visibility: "open",
    group_permission_count: 2,
    direct_user_permission_count: 5,
    ...overrides,
  } as Space;
}

function renderRow(space: Space) {
  return render(
    <table>
      <tbody>
        <AdminSpaceRow space={space} />
      </tbody>
    </table>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.delete.mockResolvedValue(undefined);
});

describe("AdminSpaceRow", () => {
  it("summarises an open, active space", () => {
    renderRow(makeSpace());
    expect(screen.getByRole("link", { name: "Engineering" })).toHaveAttribute("href", "/spaces/ENG");
    expect(screen.getByText("Product docs")).toBeInTheDocument();
    expect(screen.getByText("🛠")).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("falls back for a private, archived space without icon or description", () => {
    renderRow(
      makeSpace({ visibility: "restricted", status: "archived", icon: "", description: "" }),
    );
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("◆")).toBeInTheDocument();
    expect(screen.getByText("ENG")).toBeInTheDocument();
  });

  it("opens the edit modal", async () => {
    renderRow(makeSpace());
    await userEvent.click(screen.getByRole("button", { name: "Edit Engineering" }));
    expect(screen.getByRole("dialog", { name: "edit modal" })).toHaveTextContent("ENG");
  });

  it("deletes a space after confirmation", async () => {
    const actor = userEvent.setup();
    renderRow(makeSpace());
    await actor.click(screen.getByRole("button", { name: "Delete Engineering" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete Engineering?")).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("button", { name: "Delete space" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/spaces/ENG");
    expect(toastSuccess).toHaveBeenCalledWith('Deleted space "Engineering".');
  });

  it("reports why a delete failed", async () => {
    const actor = userEvent.setup();
    renderRow(makeSpace());

    mocked.delete.mockRejectedValueOnce(new ApiError(409, "busy", "Space still has pages."));
    await actor.click(screen.getByRole("button", { name: "Delete Engineering" }));
    await actor.click(await screen.findByRole("button", { name: "Delete space" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Space still has pages."));

    mocked.delete.mockRejectedValueOnce(new Error("network"));
    await actor.click(screen.getByRole("button", { name: "Delete space" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not delete this space."));
    expect(refresh).not.toHaveBeenCalled();
  });
});
