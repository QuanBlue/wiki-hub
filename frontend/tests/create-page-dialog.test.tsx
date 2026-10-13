import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreatePageDialog } from "@/components/pages/create-page-dialog";
import { ApiError, api } from "@/lib/api-client";

const { push, toastSuccess, toastError } = vi.hoisted(() => ({
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.post.mockResolvedValue({ title: "Runbook", slug: "run book" });
});

async function openDialog(actor: ReturnType<typeof userEvent.setup>, name: RegExp | string = "Create page") {
  await actor.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog");
}

describe("CreatePageDialog", () => {
  it("describes a top-level page and keeps Create disabled without a title", async () => {
    const actor = userEvent.setup();
    render(<CreatePageDialog spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    expect(within(dialog).getByText("Add a top-level page to this space.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create page" })).toBeDisabled();
    await actor.type(within(dialog).getByLabelText("Title"), "   ");
    expect(within(dialog).getByRole("button", { name: "Create page" })).toBeDisabled();
  });

  it("creates a page, closes and opens it", async () => {
    const actor = userEvent.setup();
    render(<CreatePageDialog spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.type(within(dialog).getByLabelText("Title"), "  Runbook  ");
    await actor.type(within(dialog).getByLabelText(/content/i), "Hello");
    await actor.click(within(dialog).getByRole("button", { name: "Create page" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/spaces/ENG/pages/run%20book"));
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/spaces/ENG/pages", {
      title: "Runbook",
      content: "Hello",
      parent_id: null,
    });
    expect(toastSuccess).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("creates a child page under its parent", async () => {
    const actor = userEvent.setup();
    render(
      <CreatePageDialog
        spaceKey="ENG"
        parentPage={{ id: "parent-1", title: "Handbook" }}
        triggerLabel=""
      />,
    );
    const dialog = await openDialog(actor, "New page");
    expect(within(dialog).getByText(/Handbook/)).toBeInTheDocument();
    await actor.type(within(dialog).getByLabelText("Title"), "Child");
    await actor.click(within(dialog).getByRole("button", { name: "Create page" }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    expect(mocked.post.mock.calls[0][1]).toMatchObject({ parent_id: "parent-1" });
  });

  it("shows the server's message, or a generic one, and lets the user retry", async () => {
    const actor = userEvent.setup();
    render(<CreatePageDialog spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.type(within(dialog).getByLabelText("Title"), "Dup");

    mocked.post.mockRejectedValueOnce(new ApiError(409, "dup", "Title already exists."));
    await actor.click(within(dialog).getByRole("button", { name: "Create page" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Title already exists."));

    mocked.post.mockRejectedValueOnce(new Error("network"));
    await actor.click(within(dialog).getByRole("button", { name: "Create page" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
    expect(push).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Create page" })).toBeEnabled();
  });

  it("ignores submitting an empty title with the keyboard", async () => {
    const actor = userEvent.setup();
    render(<CreatePageDialog spaceKey="ENG" />);
    const dialog = await openDialog(actor);
    await actor.type(within(dialog).getByLabelText("Title"), "{Enter}");
    expect(mocked.post).not.toHaveBeenCalled();
  });
});
