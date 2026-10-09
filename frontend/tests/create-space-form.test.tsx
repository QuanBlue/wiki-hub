import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateSpaceForm } from "@/components/spaces/create-space-form";
import { ApiError, api } from "@/lib/api-client";
import type { Space, User } from "@/types/api";

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

const mocked = vi.mocked(api);

const USERS = [
  { id: "u1", username: "ann", full_name: "Ann Lee", email: "ann@example.com" },
  { id: "u2", username: "bob", full_name: "", email: "bob@example.com" },
  { id: "u3", username: "cat", full_name: "Cat Doe", email: "cat@example.com" },
] as User[];

async function openDialog(actor: ReturnType<typeof userEvent.setup>) {
  await actor.click(screen.getByRole("button", { name: "Create space" }));
  return screen.findByRole("dialog");
}

function submitButton() {
  const buttons = screen.getAllByRole("button", { name: "Create space" });
  return buttons[buttons.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.get.mockResolvedValue([{ name: "  Engineering " }] as Space[]);
  mocked.post.mockResolvedValue({ key: "OPS", name: "Ops" });
  mocked.put.mockResolvedValue({});
});

describe("CreateSpaceForm", () => {
  it("derives the key and validates the name", async () => {
    const actor = userEvent.setup();
    render(<CreateSpaceForm />);
    await openDialog(actor);
    await waitFor(() => expect(mocked.get).toHaveBeenCalled());

    const name = screen.getByLabelText("Name");
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText("Space key: —")).toBeInTheDocument();

    await actor.type(name, "Ops Team 2");
    expect(screen.getByText("Space key: OPS_TEAM_2")).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();

    await actor.clear(name);
    await actor.type(name, "2fast");
    expect(screen.getByText(/must start with a letter/)).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Space key: S2FAST")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await actor.clear(name);
    await actor.type(name, "engineering");
    expect(await screen.findByText(/A space named "engineering" already exists/)).toBeInTheDocument();

    // A name made only of symbols derives no key at all.
    await actor.clear(name);
    await actor.type(name, "é!!");
    expect(screen.getByText("Space key: —")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("ignores a failed duplicate-name lookup and a late response", async () => {
    mocked.get.mockRejectedValueOnce(new Error("offline"));
    const actor = userEvent.setup();
    render(<CreateSpaceForm />);
    await openDialog(actor);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(1));

    await actor.type(screen.getByLabelText("Name"), "Engineering");
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
  });

  it("drops the name lookup when the dialog closes before it resolves", async () => {
    let resolve: (value: Space[]) => void = () => {};
    mocked.get.mockReturnValueOnce(new Promise<Space[]>((r) => (resolve = r)));
    const actor = userEvent.setup();
    render(<CreateSpaceForm />);
    await openDialog(actor);
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    resolve([{ name: "Late" }] as Space[]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("creates a plain space without member management", async () => {
    const actor = userEvent.setup();
    render(<CreateSpaceForm />);
    await openDialog(actor);

    await actor.type(screen.getByLabelText("Name"), "Ops");
    await actor.type(screen.getByLabelText(/Description/), " About ops ");
    await actor.click(screen.getByRole("button", { name: "Space access" }));
    await actor.click(await screen.findByRole("menuitemradio", { name: /Restricted/ }));
    expect(screen.getByRole("button", { name: "Space access" })).toHaveTextContent(/Restricted/);
    await actor.click(submitButton());

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/spaces", {
      key: "OPS",
      name: "Ops",
      description: "About ops",
      icon: "",
      visibility: "restricted",
    });
    expect(mocked.put).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Space "Ops" created.');
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("assigns the owner and the chosen members", async () => {
    const actor = userEvent.setup();
    render(<CreateSpaceForm users={USERS} />);
    await openDialog(actor);

    await actor.type(screen.getByLabelText("Name"), "Ops");
    expect(screen.getByText("0 selected")).toBeInTheDocument();

    // The first user is the default owner and cannot be toggled as a member.
    const ownerBox = screen.getByRole("checkbox", { name: "Add Ann Lee" });
    expect(ownerBox).toBeChecked();
    expect(ownerBox).toBeDisabled();

    await actor.click(screen.getByRole("checkbox", { name: "Add bob" }));
    await actor.click(screen.getByRole("checkbox", { name: "Add Cat Doe" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await actor.click(screen.getByRole("checkbox", { name: "Add Cat Doe" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await actor.click(screen.getByRole("checkbox", { name: "Add Cat Doe" }));

    // Choosing bob as owner drops him from the member selection.
    await actor.click(screen.getByRole("button", { name: "Space owner" }));
    await actor.click(await screen.findByRole("menuitemradio", { name: /bob/ }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Space owner" })).toHaveTextContent("bob");

    await actor.click(submitButton());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/OPS/members", {
      user_id: "u2",
      role: "admin",
    });
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/OPS/members", {
      user_id: "u3",
      role: "viewer",
    });
    expect(mocked.put).toHaveBeenCalledTimes(2);
  });

  it("filters the member list", async () => {
    const actor = userEvent.setup();
    render(<CreateSpaceForm users={USERS} />);
    await openDialog(actor);

    const filter = screen.getByLabelText("Filter users");
    await actor.type(filter, "cat@");
    expect(screen.getByRole("checkbox", { name: "Add Cat Doe" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Add bob" })).not.toBeInTheDocument();

    await actor.clear(filter);
    await actor.type(filter, "nobody");
    expect(screen.getByText("No users match this filter.")).toBeInTheDocument();
  });

  it("reports a partial membership failure with and without a server message", async () => {
    const actor = userEvent.setup();
    mocked.put.mockRejectedValueOnce(new ApiError(403, "forbidden", "No rights."));
    const first = render(<CreateSpaceForm users={USERS} />);
    await openDialog(actor);
    await actor.type(screen.getByLabelText("Name"), "Ops");
    await actor.click(submitButton());
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Space created, but some members could not be added: No rights.",
      ),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    first.unmount();

    toastError.mockClear();
    mocked.put.mockRejectedValueOnce(new Error("network"));
    render(<CreateSpaceForm users={USERS} />);
    await openDialog(actor);
    await actor.type(screen.getByLabelText("Name"), "Ops");
    await actor.click(submitButton());
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Space created, but some members could not be added."),
    );
  });

  it("shows the API error when the space cannot be created", async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(409, "conflict", "Key taken."));
    const actor = userEvent.setup();
    render(<CreateSpaceForm />);
    await openDialog(actor);
    await actor.type(screen.getByLabelText("Name"), "Ops");
    await actor.click(submitButton());

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(toastError).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // The form stays open and editable for another attempt.
    expect(screen.getByLabelText("Name")).toBeEnabled();
  });

  it("does not submit an invalid name from the keyboard", async () => {
    const actor = userEvent.setup();
    render(<CreateSpaceForm />);
    await openDialog(actor);
    await actor.type(screen.getByLabelText("Name"), "9lives{Enter}");
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("clears the form when the dialog is dismissed", async () => {
    const actor = userEvent.setup();
    render(<CreateSpaceForm users={USERS} />);
    await openDialog(actor);
    await actor.type(screen.getByLabelText("Name"), "Draft");
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await openDialog(actor);
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });
});
