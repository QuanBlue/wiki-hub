import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GroupUsagePanel } from "@/components/admin/group-usage-panel";
import { ApiError, api } from "@/lib/api-client";
import type { Group, GroupUsage } from "@/types/api";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);
const group = { id: "g1", name: "Docs" } as Group;

const USAGE: GroupUsage = {
  spaces: [
    { space_id: "s1", space_key: "ENG", space_name: "Engineering", permissions: ["view", "add"] },
    { space_id: "s2", space_key: "OPS", space_name: "Operations", permissions: ["export", "custom" as never] },
  ],
  pages: [
    {
      page_id: "p1",
      page_title: "Runbook",
      page_slug: "run book",
      space_id: "s1",
      space_key: "ENG",
      space_name: "Engineering",
      entries: [
        { permission: "view", denied: false },
        { permission: "edit", denied: true },
      ],
    },
  ],
};

function renderPanel(usage: GroupUsage | null = USAGE, loading = false) {
  const onUsageChanged = vi.fn();
  render(
    <GroupUsagePanel group={group} usage={usage} loading={loading} onUsageChanged={onUsageChanged} />,
  );
  return { onUsageChanged, actor: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.delete.mockResolvedValue(undefined);
});

describe("GroupUsagePanel", () => {
  it("shows a loading state, and an empty state when the group is used nowhere", () => {
    const { unmount } = render(
      <GroupUsagePanel group={group} usage={null} loading onUsageChanged={vi.fn()} />,
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    unmount();

    renderPanel({ spaces: [], pages: [] });
    expect(screen.getByText("Not used anywhere")).toBeInTheDocument();
  });

  it("lists spaces with their permission labels, and pages with grants and blocks", async () => {
    const { actor } = renderPanel();

    expect(screen.getByRole("link", { name: /Engineering/ })).toHaveAttribute("href", "/spaces/ENG");
    expect(screen.getByText("Add/Edit")).toBeInTheDocument();
    expect(screen.getByText("Export")).toBeInTheDocument();
    expect(screen.getByText("custom")).toBeInTheDocument();

    await actor.click(screen.getByRole("tab", { name: /Pages \(1\)/ }));
    expect(screen.getByRole("link", { name: /Runbook/ })).toHaveAttribute(
      "href",
      "/spaces/ENG/pages/run%20book",
    );
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("removes one space grant, deleting each of its permissions", async () => {
    const { actor, onUsageChanged } = renderPanel();

    await actor.click(screen.getByRole("button", { name: 'Remove from "Engineering"' }));
    await actor.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(onUsageChanged).toHaveBeenCalledWith({ ...USAGE, spaces: [USAGE.spaces[1]] }),
    );
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/groups/g1/view");
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/groups/g1/add");
    expect(toastSuccess).toHaveBeenCalledWith('Removed from "Engineering".');
  });

  it("removes a page restriction, clearing a block through its own endpoint", async () => {
    const { actor, onUsageChanged } = renderPanel();
    await actor.click(screen.getByRole("tab", { name: /Pages/ }));

    await actor.click(screen.getByRole("button", { name: 'Remove from "Runbook"' }));
    await actor.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onUsageChanged).toHaveBeenCalledWith({ ...USAGE, pages: [] }));
    expect(mocked.delete).toHaveBeenCalledWith(
      "/api/v1/spaces/ENG/pages/run%20book/restrictions/groups/g1/view",
    );
    expect(mocked.delete).toHaveBeenCalledWith(
      "/api/v1/spaces/ENG/pages/run%20book/restrictions/groups/g1/edit/block",
    );
  });

  it("reports a failed removal with the server's reason or a generic one", async () => {
    const { actor } = renderPanel();

    mocked.delete.mockRejectedValueOnce(new ApiError(409, "conflict", "Last admin."));
    await actor.click(screen.getByRole("button", { name: 'Remove from "Engineering"' }));
    await actor.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Last admin."));

    mocked.delete.mockRejectedValue(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not remove this Space."));
  });

  it("backs out of a single removal", async () => {
    const { actor } = renderPanel();

    await actor.click(screen.getByRole("button", { name: 'Remove from "Engineering"' }));
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it("removes several at once, reporting the ones that failed", async () => {
    const { actor, onUsageChanged } = renderPanel();
    mocked.delete.mockImplementation(async (path: string) => {
      if (path.includes("/OPS/")) throw new Error("nope");
      return undefined;
    });

    await actor.click(screen.getByRole("button", { name: "Select" }));
    await actor.click(screen.getByLabelText("Select Engineering"));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await actor.click(screen.getByLabelText("Select Engineering"));
    await actor.click(screen.getByLabelText("Select all Spaces"));
    await actor.click(screen.getByRole("button", { name: "Remove selected" }));
    const confirm = screen.getByRole("alertdialog", { name: "Remove from 2 Spaces?" });
    await actor.click(within(confirm).getByRole("button", { name: "Remove selected" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Removed from 1 Space."));
    expect(toastError).toHaveBeenCalledWith("Could not remove from 1 Space.");
    expect(onUsageChanged).toHaveBeenCalledWith({ ...USAGE, spaces: [USAGE.spaces[1]] });
  });

  it("reports when every selected removal failed", async () => {
    const { actor, onUsageChanged } = renderPanel();
    mocked.delete.mockRejectedValue(new Error("nope"));

    await actor.click(screen.getByRole("button", { name: "Select" }));
    await actor.click(screen.getByLabelText("Select all Spaces"));
    await actor.click(screen.getByRole("button", { name: "Remove selected" }));
    await actor.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove selected" }),
    );

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not remove from 2 Spaces."));
    expect(onUsageChanged).not.toHaveBeenCalled();
  });

  it("clears, unticks all, cancels, and resets selection when switching sub-tab", async () => {
    const { actor } = renderPanel();

    await actor.click(screen.getByRole("button", { name: "Select" }));
    await actor.click(screen.getByLabelText("Select all Spaces"));
    expect(screen.getByRole("button", { name: "Cancel (2)" })).toBeInTheDocument();
    await actor.click(screen.getByLabelText("Select all Spaces"));
    expect(screen.getByText("Select all (2)")).toBeInTheDocument();
    await actor.click(screen.getByLabelText("Select Operations"));
    await actor.click(screen.getByRole("button", { name: "Clear" }));
    await actor.click(screen.getByLabelText("Select Operations"));
    await actor.click(screen.getByRole("button", { name: "Remove selected" }));
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await actor.click(screen.getByRole("button", { name: /^Cancel/ }));
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Select" }));
    await actor.click(screen.getByRole("tab", { name: /Pages/ }));
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
  });

  it("says when one sub-tab is empty and disables selecting there", async () => {
    const { actor } = renderPanel({ spaces: USAGE.spaces, pages: [] });

    await actor.click(screen.getByRole("tab", { name: /Pages \(0\)/ }));

    expect(screen.getByText("Not named on any Page's restrictions.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toBeDisabled();
  });
});
