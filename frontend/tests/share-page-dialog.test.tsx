import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { SharePageDialog } from "@/components/pages/share-page-dialog";
import { api } from "@/lib/api-client";
import type { MentionCandidate, ShareResult } from "@/types/api";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const BASE = "/api/v1/spaces/ENG/pages/runbook/shares";

const people: MentionCandidate[] = [
  { username: "carol", full_name: "Carol Le", avatar_url: null, can_view: true },
  { username: "dave", full_name: "Dave Pham", avatar_url: null, can_view: false },
  { username: "erin", full_name: "Erin Vo", avatar_url: null, can_view: true },
];

function renderDialog() {
  const onShared = vi.fn();
  const onOpenChange = vi.fn();
  const onCopyLink = vi.fn();
  render(
    <SharePageDialog
      spaceKey="ENG"
      pageSlug="runbook"
      pageTitle="Runbook"
      open
      onOpenChange={onOpenChange}
      onCopyLink={onCopyLink}
      onShared={onShared}
    />,
  );
  return { onShared, onOpenChange, onCopyLink };
}

function option(name: string) {
  return screen.getByText(name).closest("button")!;
}

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue(people);
  vi.mocked(api.post).mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.warning).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("SharePageDialog", () => {
  it("lists people without access as disabled, with the reason", async () => {
    renderDialog();

    await screen.findByText("Carol Le");
    expect(api.get).toHaveBeenCalledWith(`${BASE}/candidates`, { query: { q: "" } });
    const dave = option("Dave Pham");
    expect(dave).toHaveAttribute("aria-disabled", "true");
    expect(dave).toHaveTextContent("No access to this page or space");

    await userEvent.click(dave);
    expect(screen.queryByRole("list", { name: "Sharing with" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  });

  it("shares with the people picked and reports the new count", async () => {
    vi.mocked(api.post).mockResolvedValue({
      share_count: 7,
      shared: ["carol", "erin"],
      no_access: [],
      not_found: [],
    } satisfies ShareResult);
    const { onShared, onOpenChange } = renderDialog();

    await userEvent.click(await screen.findByText("Carol Le"));
    // Keyboard: the arrows skip Dave on the way to Erin.
    const search = screen.getByRole("combobox", { name: "Search by name or username" });
    search.focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    const chips = screen.getByRole("list", { name: "Sharing with" });
    expect(within(chips).getAllByRole("listitem").map((chip) => chip.textContent)).toEqual([
      "Carol Le",
      "Erin Vo",
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Share (2)" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(BASE, { recipients: ["carol", "erin"] }),
    );
    expect(onShared).toHaveBeenCalledWith(7);
    expect(toast.success).toHaveBeenCalledWith("Shared with Carol Le, Erin Vo.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("removes a picked person from the chips", async () => {
    renderDialog();
    await userEvent.click(await screen.findByText("Carol Le"));

    await userEvent.click(screen.getByRole("button", { name: "Remove Carol Le" }));

    expect(screen.queryByRole("list", { name: "Sharing with" })).not.toBeInTheDocument();
  });

  it("warns about anyone who lost access before the share was sent", async () => {
    vi.mocked(api.post).mockResolvedValue({
      share_count: 0,
      shared: [],
      no_access: ["carol"],
      not_found: [],
    } satisfies ShareResult);
    renderDialog();

    await userEvent.click(await screen.findByText("Carol Le"));
    await userEvent.click(screen.getByRole("button", { name: "Share (1)" }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "Not shared with Carol Le - they cannot open this page.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps the dialog open when sharing fails", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("boom"));
    const { onOpenChange, onCopyLink } = renderDialog();

    await userEvent.click(await screen.findByText("Carol Le"));
    await userEvent.click(screen.getByRole("button", { name: "Share (1)" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(onCopyLink).toHaveBeenCalled();
  });

  it("searches as you type", async () => {
    renderDialog();
    await screen.findByText("Carol Le");

    await userEvent.type(screen.getByRole("combobox"), "er");

    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(`${BASE}/candidates`, { query: { q: "er" } }),
    );
  });
});
