import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MovePageDialog } from "@/components/pages/move-page-dialog";
import { ApiError, api } from "@/lib/api-client";
import type { Space, WikiPage } from "@/types/api";

const { push, refresh, toastSuccess, toastError } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);

const SPACE = { id: "s1", key: "ENG", name: "Engineering" } as Space;
const OTHER = { id: "s2", key: "OPS", name: "Operations" } as Space;

function makePage(id: string, title: string, parent: string | null = null): WikiPage {
  return { id, title, slug: title.toLowerCase().replace(/ /g, "-"), parent_id: parent } as WikiPage;
}

const ROOT = makePage("root", "Handbook");
const PAGE = makePage("page", "Runbook", "root");
const CHILD = makePage("child", "Runbook child", "page");
const GRANDCHILD = makePage("grand", "Deep page", "child");
const SIBLING = makePage("sib", "Sibling page", "root");
const PAGES = [ROOT, PAGE, CHILD, GRANDCHILD, SIBLING];

beforeEach(() => {
  vi.clearAllMocks();
  mocked.get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/spaces") return [SPACE, OTHER];
    if (url === "/api/v1/spaces/OPS/pages") return [makePage("o1", "Ops home")];
    throw new Error(`unexpected ${url}`);
  });
  mocked.post.mockResolvedValue({ title: "Runbook", slug: "runbook" });
});

function renderUncontrolled() {
  return render(<MovePageDialog space={SPACE} page={PAGE} pages={PAGES} />);
}

async function openUncontrolled(actor: ReturnType<typeof userEvent.setup>) {
  await actor.click(screen.getByRole("button", { name: "Move" }));
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByRole("combobox")).toBeEnabled());
  return dialog;
}

describe("MovePageDialog", () => {
  it("moves a page under another parent in the same space", async () => {
    const actor = userEvent.setup();
    renderUncontrolled();
    const dialog = await openUncontrolled(actor);

    const parent = within(dialog).getByRole("combobox");
    expect(parent).toHaveValue("Handbook");
    await actor.click(parent);
    const options = within(dialog).getAllByRole("option").map((o) => o.textContent);
    // Itself and its descendants cannot become its parent.
    expect(options).toEqual(["Top-level page", "Handbook", "Sibling page"]);

    await actor.type(parent, "sib");
    expect(within(dialog).getAllByRole("option")).toHaveLength(2);
    await actor.click(within(dialog).getByRole("option", { name: "Sibling page" }));
    expect(parent).toHaveValue("Sibling page");

    await actor.click(within(dialog).getByRole("button", { name: "Move page" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/spaces/ENG/pages/runbook"));
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/spaces/ENG/pages/runbook/move", {
      destination_space_key: "ENG",
      parent_id: "sib",
    });
    expect(toastSuccess).toHaveBeenCalledWith('Moved "Runbook" to Engineering.');
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("moves to the top level and handles a filter with no match", async () => {
    const actor = userEvent.setup();
    renderUncontrolled();
    const dialog = await openUncontrolled(actor);
    const parent = within(dialog).getByRole("combobox");

    await actor.click(parent);
    await actor.type(parent, "zzz");
    expect(within(dialog).getByText("No matching pages.")).toBeInTheDocument();

    await actor.clear(parent);
    await actor.click(within(dialog).getByRole("option", { name: "Top-level page" }));
    await actor.click(within(dialog).getByRole("button", { name: "Move page" }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    expect(mocked.post.mock.calls[0][1]).toEqual({
      destination_space_key: "ENG",
      parent_id: null,
    });
  });

  it("closes the list when clicking elsewhere, and on Escape", async () => {
    const actor = userEvent.setup();
    renderUncontrolled();
    const dialog = await openUncontrolled(actor);
    const parent = within(dialog).getByRole("combobox");

    await actor.click(parent);
    expect(within(dialog).getByRole("listbox")).toBeInTheDocument();
    // Other keys leave it open, and a press inside the picker does not dismiss it.
    fireEvent.keyDown(parent, { key: "a" });
    fireEvent.pointerDown(within(dialog).getByRole("listbox"));
    expect(within(dialog).getByRole("listbox")).toBeInTheDocument();

    fireEvent.pointerDown(within(dialog).getByText("Destination space"));
    expect(within(dialog).queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.focusIn(parent);
    expect(within(dialog).getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(parent, { key: "Escape" });
    expect(within(dialog).queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("loads the pages of another destination space", async () => {
    const actor = userEvent.setup();
    renderUncontrolled();
    const dialog = await openUncontrolled(actor);

    await actor.click(within(dialog).getByRole("button", { name: "Destination space" }));
    await actor.click(await screen.findByRole("menuitemradio", { name: /Operations/ }));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith("/api/v1/spaces/OPS/pages"));

    const parent = within(dialog).getByRole("combobox");
    await waitFor(() => expect(parent).toBeEnabled());
    expect(parent).toHaveValue("");
    await actor.click(parent);
    // Nothing is excluded in another space, so every page there is eligible.
    expect(within(dialog).getByRole("option", { name: "Ops home" })).toBeInTheDocument();
    await actor.click(within(dialog).getByRole("option", { name: "Ops home" }));

    await actor.click(within(dialog).getByRole("button", { name: "Move page" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/spaces/OPS/pages/runbook"));
    expect(mocked.post.mock.calls[0][1]).toEqual({
      destination_space_key: "OPS",
      parent_id: "o1",
    });
    expect(toastSuccess).toHaveBeenCalledWith('Moved "Runbook" to Operations.');
  });

  it("returns to the current space's own page list", async () => {
    const actor = userEvent.setup();
    renderUncontrolled();
    const dialog = await openUncontrolled(actor);

    await actor.click(within(dialog).getByRole("button", { name: "Destination space" }));
    await actor.click(await screen.findByRole("menuitemradio", { name: /Operations/ }));
    await waitFor(() => expect(within(dialog).getByRole("combobox")).toBeEnabled());
    mocked.get.mockClear();

    await actor.click(within(dialog).getByRole("button", { name: "Destination space" }));
    await actor.click(await screen.findByRole("menuitemradio", { name: /Engineering/ }));
    expect(mocked.get).not.toHaveBeenCalled();
    await actor.click(within(dialog).getByRole("combobox"));
    expect(within(dialog).getByRole("option", { name: "Sibling page" })).toBeInTheDocument();
  });

  it("reports a failure to load the destination pages", async () => {
    const actor = userEvent.setup();
    renderUncontrolled();
    const dialog = await openUncontrolled(actor);
    mocked.get.mockRejectedValueOnce(new Error("offline"));

    await actor.click(within(dialog).getByRole("button", { name: "Destination space" }));
    await actor.click(await screen.findByRole("menuitemradio", { name: /Operations/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not load pages in that space."),
    );
    await waitFor(() => expect(within(dialog).getByRole("combobox")).toBeEnabled());
  });

  it("falls back to the current space when the space list cannot load", async () => {
    mocked.get.mockRejectedValueOnce(new Error("offline"));
    const actor = userEvent.setup();
    renderUncontrolled();
    const dialog = await openUncontrolled(actor);
    expect(toastError).toHaveBeenCalledWith("Could not load spaces.");

    await actor.click(within(dialog).getByRole("button", { name: "Destination space" }));
    expect(await screen.findByRole("menuitemradio", { name: "Engineering" })).toBeInTheDocument();
  });

  it("shows the server's message when the move is rejected", async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(409, "conflict", "Title already used."));
    const actor = userEvent.setup();
    renderUncontrolled();
    const dialog = await openUncontrolled(actor);
    await actor.click(within(dialog).getByRole("button", { name: "Move page" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Title already used."));

    mocked.post.mockRejectedValueOnce(new Error("network"));
    await actor.click(within(dialog).getByRole("button", { name: "Move page" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not move this page."));
    expect(push).not.toHaveBeenCalled();
  });

  it("moves without a destination name before the space list is known", async () => {
    mocked.get.mockImplementation(() => new Promise(() => {}));
    const actor = userEvent.setup();
    renderUncontrolled();
    await actor.click(screen.getByRole("button", { name: "Move" }));
    const dialog = await screen.findByRole("dialog");
    // While loading nothing can be submitted.
    expect(within(dialog).getByRole("button", { name: "Move page" })).toBeDisabled();
  });

  it("works controlled, without its own trigger, and reports without a destination", async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/spaces") return [];
      throw new Error("unexpected");
    });
    function Controlled() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <span data-testid="open">{String(open)}</span>
          <MovePageDialog
            space={SPACE}
            page={PAGE}
            pages={PAGES}
            open={open}
            onOpenChange={setOpen}
          />
        </>
      );
    }
    const actor = userEvent.setup();
    render(<Controlled />);

    const dialog = await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /^Move$/ })).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("combobox")).toBeEnabled());
    await actor.click(within(dialog).getByRole("button", { name: "Move page" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Moved "Runbook".'));
    expect(screen.getByTestId("open")).toHaveTextContent("false");
  });
});
