import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SpaceTrashDialog, daysUntil } from "@/components/pages/space-trash";
import { ApiError, api } from "@/lib/api-client";
import type {
  Space,
  TrashList,
  TrashedPage,
  TrashedPageDetail,
} from "@/types/api";

const { push, refresh, toastSuccess, toastError } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const DAY = 24 * 60 * 60 * 1000;

const space = { id: "s1", key: "ENG", name: "Engineering" } as Space;

function item(
  id: string,
  title: string,
  extra: Partial<TrashedPage> = {},
): TrashedPage {
  return {
    id,
    title,
    slug: title.toLowerCase(),
    deleted_at: new Date(Date.now() - DAY).toISOString(),
    purge_at: new Date(Date.now() + 10 * DAY).toISOString(),
    deleted_by_username: "bob",
    deleted_by_full_name: "Bob",
    parent_title: null,
    ...extra,
  };
}

function trash(items: TrashedPage[], canPurge = true): TrashList {
  return { items, retention_days: 30, can_purge: canPurge };
}

// The reader draws attachments and code with a real editor; here only its text matters.
vi.mock("@/components/pages/rich-text-editor", () => ({
  RichTextContent: ({ content }: { content: string }) => (
    <div data-testid="preview-body">{content}</div>
  ),
}));

function detail(extra: Partial<TrashedPageDetail> = {}): TrashedPageDetail {
  return {
    ...item("p1", "Runbook"),
    content: "<p>Page the on-call.</p>",
    content_format: "html",
    ...extra,
  };
}

function renderTrash(open = true) {
  const onOpenChange = vi.fn();
  const view = render(
    <SpaceTrashDialog space={space} open={open} onOpenChange={onOpenChange} />,
  );
  return { onOpenChange, view };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("daysUntil", () => {
  it("counts whole days left, never below zero", () => {
    const now = Date.parse("2026-10-18T00:00:00Z");
    expect(daysUntil("2026-10-20T00:00:00Z", now)).toBe(2);
    expect(daysUntil("2026-10-18T12:00:00Z", now)).toBe(1);
    expect(daysUntil("2026-10-01T00:00:00Z", now)).toBe(0);
  });
});

describe("SpaceTrash", () => {
  it("lists deleted pages with who deleted them and when they go for good", async () => {
    mocked.get.mockResolvedValue(
      trash([
        item("p1", "Runbook", { parent_title: "Guides" }),
        item("p2", "Old notes", {
          deleted_by_full_name: null,
          deleted_by_username: null,
          purge_at: new Date(Date.now() + DAY / 2).toISOString(),
        }),
        item("p3", "Soon", {
          purge_at: new Date(Date.now() - DAY).toISOString(),
        }),
      ]),
    );
    renderTrash();

    expect(await screen.findByText("Runbook")).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/spaces/ENG/trash");
    expect(screen.getByText(/Was under Guides/)).toHaveTextContent(
      "Deleted by Bob",
    );
    expect(screen.getByText("Removed for good in 10 days")).toBeInTheDocument();
    expect(screen.getByText("Removed for good tomorrow")).toBeInTheDocument();
    expect(screen.getByText("Removed for good today")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "Trash" });
    expect(dialog).toHaveTextContent(
      "Pages deleted from Engineering. They can be restored for 30 days",
    );
  });

  it("restores a page and offers to open it", async () => {
    const user = userEvent.setup();
    mocked.get.mockResolvedValue(trash([item("p1", "Runbook")]));
    mocked.post.mockResolvedValueOnce({
      id: "p1",
      title: "Runbook",
      slug: "runbook",
      restored_to_parent: true,
    });
    renderTrash();

    await user.click(await screen.findByRole("button", { name: "Restore" }));

    expect(mocked.post).toHaveBeenCalledWith(
      "/api/v1/spaces/ENG/trash/p1/restore",
    );
    await waitFor(() =>
      expect(screen.queryByText("Runbook")).not.toBeInTheDocument(),
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      'Restored "Runbook".',
      expect.anything(),
    );
    toastSuccess.mock.calls[0]![1].action.onClick();
    expect(push).toHaveBeenCalledWith("/spaces/ENG/pages/runbook");
    expect(refresh).toHaveBeenCalled();
  });

  it("says when a page comes back at the top, and reports a failed restore", async () => {
    const user = userEvent.setup();
    mocked.get.mockResolvedValue(
      trash([item("p1", "Runbook"), item("p2", "Notes")]),
    );
    mocked.post
      .mockResolvedValueOnce({
        id: "p1",
        title: "Runbook",
        slug: "runbook",
        restored_to_parent: false,
      })
      .mockRejectedValueOnce(
        new ApiError(
          404,
          "not_found",
          "That page is not in this space's Trash.",
        ),
      )
      .mockRejectedValueOnce(new Error("offline"));
    renderTrash();

    const buttons = await screen.findAllByRole("button", { name: "Restore" });
    await user.click(buttons[0]!);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringContaining("at the top of the space"),
        expect.anything(),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "That page is not in this space's Trash.",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not restore this page."),
    );
  });

  it("lets a space admin delete one page for good after confirming", async () => {
    const user = userEvent.setup();
    mocked.get.mockResolvedValue(trash([item("p1", "Runbook")]));
    mocked.delete
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline"));
    renderTrash();

    await user.click(
      await screen.findByRole("button", { name: "Delete permanently" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent('"Runbook" and its whole history');
    await user.click(
      within(dialog).getByRole("button", { name: "Delete permanently" }),
    );

    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/spaces/ENG/trash/p1");
    await waitFor(() =>
      expect(screen.getByText("The Trash is empty")).toBeInTheDocument(),
    );
    expect(toastSuccess).toHaveBeenCalledWith('Deleted "Runbook" permanently.');
  });

  it("reports a failed permanent delete and can be dismissed", async () => {
    const user = userEvent.setup();
    mocked.get.mockResolvedValue(trash([item("p1", "Runbook")]));
    mocked.delete.mockRejectedValueOnce(new Error("offline"));
    renderTrash();

    await user.click(
      await screen.findByRole("button", { name: "Delete permanently" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete permanently",
      }),
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not delete this page."),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Runbook")).toBeInTheDocument();
  });

  it("empties the whole Trash for a space admin", async () => {
    const user = userEvent.setup();
    mocked.get.mockResolvedValue(
      trash([item("p1", "Runbook"), item("p2", "Notes")]),
    );
    mocked.delete
      .mockRejectedValueOnce(
        new ApiError(403, "forbidden", "Space admins only."),
      )
      .mockResolvedValueOnce(undefined);
    renderTrash();

    await user.click(
      await screen.findByRole("button", { name: "Empty Trash" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("All 2 pages in the Trash");
    await user.click(
      within(dialog).getByRole("button", { name: "Empty Trash" }),
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Space admins only."),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Empty Trash",
      }),
    );

    expect(mocked.delete).toHaveBeenLastCalledWith("/api/v1/spaces/ENG/trash");
    await waitFor(() =>
      expect(screen.getByText("The Trash is empty")).toBeInTheDocument(),
    );
    expect(toastSuccess).toHaveBeenCalledWith("The Trash is empty.");
  });

  it("keeps permanent deletion away from people who are not space admins", async () => {
    mocked.get.mockResolvedValue(trash([item("p1", "Runbook")], false));
    renderTrash();

    expect(await screen.findByText("Runbook")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete permanently" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Empty Trash" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Only space admins can delete pages permanently."),
    ).toBeInTheDocument();
  });

  it("shows an empty Trash, and a failed load with a retry", async () => {
    const user = userEvent.setup();
    mocked.get
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(trash([]));
    renderTrash();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the Trash.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("The Trash is empty")).toBeInTheDocument();
    expect(screen.getByText(/waits here for 30 days/)).toBeInTheDocument();
  });

  it("opens the Open button on a restore toast by closing the dialog first", async () => {
    const user = userEvent.setup();
    mocked.get.mockResolvedValue(trash([item("p1", "Runbook")]));
    mocked.post.mockResolvedValueOnce({
      id: "p1",
      title: "Runbook",
      slug: "runbook",
      restored_to_parent: true,
    });
    const { onOpenChange } = renderTrash();

    await user.click(await screen.findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    toastSuccess.mock.calls[0]![1].action.onClick();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(push).toHaveBeenCalledWith("/spaces/ENG/pages/runbook");
  });

  it("fetches nothing while closed, and the Trash each time it opens", async () => {
    mocked.get.mockResolvedValue(trash([item("p1", "Runbook")]));
    const { view } = renderTrash(false);
    expect(mocked.get).not.toHaveBeenCalled();

    view.rerender(
      <SpaceTrashDialog space={space} open onOpenChange={vi.fn()} />,
    );
    expect(await screen.findByText("Runbook")).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledTimes(1);

    view.rerender(
      <SpaceTrashDialog space={space} open={false} onOpenChange={vi.fn()} />,
    );
    view.rerender(
      <SpaceTrashDialog space={space} open onOpenChange={vi.fn()} />,
    );
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(2));
  });

  it("closes with Escape, the filter forgotten", async () => {
    const user = userEvent.setup();
    mocked.get.mockResolvedValue(trash([item("p1", "Runbook")]));
    const { onOpenChange } = renderTrash();
    await screen.findByText("Runbook");

    await user.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps a failed reload as it is when a restore made before it ends", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => undefined;
    mocked.get.mockResolvedValueOnce(trash([item("p1", "Runbook")]));
    mocked.post.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { view } = renderTrash();
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    // Closed and opened again while the restore is under way, and the list fails to load.
    mocked.get.mockRejectedValueOnce(new Error("down"));
    view.rerender(
      <SpaceTrashDialog space={space} open={false} onOpenChange={vi.fn()} />,
    );
    view.rerender(
      <SpaceTrashDialog space={space} open onOpenChange={vi.fn()} />,
    );
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();

    finish({
      id: "p1",
      title: "Runbook",
      slug: "runbook",
      restored_to_parent: true,
    });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("uses the retention period the server reports", async () => {
    mocked.get.mockResolvedValue({
      items: [],
      retention_days: 90,
      can_purge: true,
    });
    renderTrash();
    expect(
      await screen.findByText(/waits here for 90 days/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "restored for 90 days",
    );
  });

  it("shows how many pages are in the Trash, and warns about the ones about to go", async () => {
    mocked.get.mockResolvedValue(
      trash([
        item("p1", "Runbook"),
        item("p2", "Soon", {
          purge_at: new Date(Date.now() + 2 * DAY).toISOString(),
        }),
      ]),
    );
    renderTrash();

    const dialog = await screen.findByRole("dialog", { name: /Trash/ });
    expect(
      within(dialog).getByText("2 pages in the Trash"),
    ).toBeInTheDocument();
    // The count sits beside the title; a 2-day page gets the warning tone, a 10-day one does not.
    expect(
      within(dialog).getByText("2", { selector: "span" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Removed for good in 2 days").className,
    ).toMatch(/text-warning/);
    expect(
      within(dialog).getByText("Removed for good in 10 days").className,
    ).not.toMatch(/text-warning/);
    // Deleted yesterday, said the way a person would.
    expect(
      within(dialog).getAllByText(/Deleted by Bob · yesterday/),
    ).toHaveLength(2);
  });

  it("filters a long list by title, and says when nothing matches", async () => {
    const user = userEvent.setup();
    const many = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"].map(
      (name, i) => item(`p${i}`, name),
    );
    mocked.get.mockResolvedValue(trash(many));
    renderTrash();

    const box = await screen.findByRole("searchbox", {
      name: "Filter deleted pages",
    });
    await user.type(box, "ch");
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "zzz");
    expect(
      screen.getByText("No deleted page matches “zzz”."),
    ).toBeInTheDocument();
  });

  it("has no filter box for a short list", async () => {
    mocked.get.mockResolvedValue(
      trash([item("p1", "Alpha"), item("p2", "Bravo")]),
    );
    renderTrash();
    await screen.findByText("Alpha");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("counts a single page in the singular", async () => {
    mocked.get.mockResolvedValue(trash([item("p1", "Alpha")]));
    renderTrash();
    expect(await screen.findByText("1 page in the Trash")).toBeInTheDocument();
  });

  it("shows a loading line until the Trash arrives", () => {
    mocked.get.mockReturnValue(new Promise(() => {}));
    renderTrash();
    expect(screen.getByText("Loading the Trash…")).toBeInTheDocument();
  });

  describe("previewing a deleted page", () => {
    /** The Trash list for the first call, the page itself for the next. */
    function serve(
      items: TrashedPage[],
      page: TrashedPageDetail | Error = detail(),
    ) {
      mocked.get.mockImplementation(async (path: string) => {
        if (path === "/api/v1/spaces/ENG/trash") return trash(items);
        if (page instanceof Error) throw page;
        return page;
      });
    }

    it("opens what the page said, read-only, when the page is clicked", async () => {
      const user = userEvent.setup();
      serve([item("p1", "Runbook")]);
      renderTrash();

      await user.click(await screen.findByRole("button", { name: /Runbook/ }));

      expect(mocked.get).toHaveBeenCalledWith("/api/v1/spaces/ENG/trash/p1");
      const preview = await screen.findByRole("dialog", { name: "Runbook" });
      expect(
        await within(preview).findByTestId("preview-body"),
      ).toHaveTextContent("Page the on-call.");
      expect(preview).toHaveTextContent("Previewing a deleted page");
      expect(preview).toHaveTextContent("Deleted by Bob");
      expect(preview).toHaveTextContent("Read-only");
    });

    it("draws a Markdown page the way the page itself is drawn", async () => {
      const user = userEvent.setup();
      serve(
        [item("p1", "Notes")],
        detail({
          title: "Notes",
          content: "# Heading",
          content_format: "markdown",
        }),
      );
      renderTrash();

      await user.click(await screen.findByRole("button", { name: /Notes/ }));
      expect(await screen.findByTestId("preview-body")).toHaveTextContent(
        "<h1>Heading</h1>",
      );
    });

    it("says so when the page had nothing in it", async () => {
      const user = userEvent.setup();
      serve([item("p1", "Blank")], detail({ title: "Blank", content: "  " }));
      renderTrash();

      await user.click(await screen.findByRole("button", { name: /Blank/ }));
      expect(
        await screen.findByText("This page had no content."),
      ).toBeInTheDocument();
    });

    it("reports a page that could not be read, and tries again", async () => {
      const user = userEvent.setup();
      serve([item("p1", "Runbook")], new Error("offline"));
      renderTrash();

      await user.click(await screen.findByRole("button", { name: /Runbook/ }));
      const preview = await screen.findByRole("dialog", { name: "Runbook" });
      expect(await within(preview).findByRole("alert")).toHaveTextContent(
        "Could not load this page.",
      );

      serve([item("p1", "Runbook")]);
      await user.click(
        within(preview).getByRole("button", { name: "Try again" }),
      );
      expect(
        await within(preview).findByTestId("preview-body"),
      ).toBeInTheDocument();
    });

    it("restores from the preview and closes it", async () => {
      const user = userEvent.setup();
      serve([item("p1", "Runbook")]);
      mocked.post.mockResolvedValueOnce({
        id: "p1",
        title: "Runbook",
        slug: "runbook",
        restored_to_parent: true,
      });
      renderTrash();

      await user.click(await screen.findByRole("button", { name: /Runbook/ }));
      const preview = await screen.findByRole("dialog", { name: "Runbook" });
      await user.click(
        within(preview).getByRole("button", { name: "Restore" }),
      );

      expect(mocked.post).toHaveBeenCalledWith(
        "/api/v1/spaces/ENG/trash/p1/restore",
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Runbook" }),
        ).not.toBeInTheDocument(),
      );
    });

    it("removes the page for good from the preview, after confirming", async () => {
      const user = userEvent.setup();
      serve([item("p1", "Runbook")]);
      mocked.delete.mockResolvedValueOnce(undefined);
      renderTrash();

      await user.click(await screen.findByRole("button", { name: /Runbook/ }));
      const preview = await screen.findByRole("dialog", { name: "Runbook" });
      await user.click(
        within(preview).getByRole("button", { name: "Delete permanently" }),
      );
      await user.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Delete permanently",
        }),
      );

      expect(mocked.delete).toHaveBeenCalledWith("/api/v1/spaces/ENG/trash/p1");
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Runbook" }),
        ).not.toBeInTheDocument(),
      );
      expect(await screen.findByText("The Trash is empty")).toBeInTheDocument();
    });

    it("goes back to the Trash, and offers no permanent delete to a non-admin", async () => {
      const user = userEvent.setup();
      mocked.get.mockImplementation(async (path: string) =>
        path === "/api/v1/spaces/ENG/trash"
          ? trash([item("p1", "Runbook")], false)
          : detail(),
      );
      renderTrash();

      await user.click(await screen.findByRole("button", { name: /Runbook/ }));
      const preview = await screen.findByRole("dialog", { name: "Runbook" });
      expect(
        within(preview).queryByRole("button", { name: "Delete permanently" }),
      ).not.toBeInTheDocument();
      await user.click(
        within(preview).getByRole("button", { name: "Back to the Trash" }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Runbook" }),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByRole("dialog", { name: /Trash/ })).toBeInTheDocument();
    });
  });
});
