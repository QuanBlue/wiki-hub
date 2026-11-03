import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { PublicShareDialog } from "@/components/pages/public-share-dialog";
import { api } from "@/lib/api-client";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const BASE = "/api/v1/spaces/ENG/pages/runbook/shares";

function renderPublicDialog() {
  const onOpenChange = vi.fn();
  render(
    <PublicShareDialog
      spaceKey="ENG"
      pageSlug="runbook"
      pageTitle="Runbook"
      open
      onOpenChange={onOpenChange}
    />,
  );
  return { onOpenChange };
}

describe("PublicShareDialog", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.delete).mockReset();
  });

  it("shows warning when public sharing is disabled system-wide", async () => {
    vi.mocked(api.get).mockResolvedValue({ enabled: false, shares: [] });

    renderPublicDialog();

    expect(
      await screen.findByText(
        "Public link sharing is currently disabled by system administrator.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create link" })).not.toBeInTheDocument();
  });

  it("lists active public links and allows creating a new link with password", async () => {
    const mockShare = {
      id: "share-uuid-1",
      token: "tok-abc-123",
      page_id: "page-uuid-1",
      created_at: "2026-11-01T10:00:00Z",
      expires_at: "2026-11-08T10:00:00Z",
      has_password: true,
      view_count: 3,
      is_active: true,
      is_expired: false,
      share_url: "/share/tok-abc-123",
    };

    vi.mocked(api.get).mockResolvedValue({ enabled: true, shares: [mockShare] });

    const newShare = {
      id: "share-uuid-2",
      token: "tok-xyz-789",
      page_id: "page-uuid-1",
      created_at: "2026-11-02T10:00:00Z",
      expires_at: null,
      has_password: false,
      view_count: 0,
      is_active: true,
      is_expired: false,
      share_url: "/share/tok-xyz-789",
    };
    vi.mocked(api.post).mockResolvedValue(newShare);

    renderPublicDialog();

    // Check existing share is displayed
    expect(await screen.findByText("Password protected")).toBeInTheDocument();
    expect(screen.getByText("3 views")).toBeInTheDocument();

    // Open create form if collapsed
    const newBtn = screen.queryByRole("button", { name: "New link" });
    if (newBtn) await userEvent.click(newBtn);

    // Configure a new link: select no expiration and toggle password
    await userEvent.click(screen.getByLabelText("Link expires in"));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "No expiration" }));
    const pwCheck = screen.getByLabelText("Password protection (optional)");
    await userEvent.click(pwCheck);

    const pwInput = screen.getByPlaceholderText("Set password (leave blank for none)");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(pwInput).toHaveAttribute("type", "text");
    await userEvent.type(pwInput, "supersecret");

    // Click create link
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/public`, {
        expires_in_days: null,
        password: "supersecret",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Share link created.");
  });

  it("revokes a public link after confirmation and removes it from the list", async () => {
    const mockShare = {
      id: "share-uuid-to-delete",
      token: "tok-delete-me",
      page_id: "page-uuid-1",
      created_at: "2026-11-01T10:00:00Z",
      expires_at: null,
      has_password: false,
      view_count: 0,
      is_active: true,
      is_expired: false,
      share_url: "/share/tok-delete-me",
    };

    vi.mocked(api.get).mockResolvedValue({ enabled: true, shares: [mockShare] });
    vi.mocked(api.delete).mockResolvedValue({});

    renderPublicDialog();

    const revokeButton = await screen.findByTitle("Revoke");
    await userEvent.click(revokeButton);

    // Confirm dialog appears
    const confirmButton = await screen.findByRole("button", { name: "Revoke link" });
    await userEvent.click(confirmButton);

    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith(`${BASE}/public/share-uuid-to-delete`),
    );
    expect(toast.success).toHaveBeenCalledWith("Public link revoked.");
    expect(screen.queryByText("tok-delete-me")).not.toBeInTheDocument();
  });

  it("edits an existing public link to update expiration and password", async () => {
    const mockShare = {
      id: "share-uuid-edit",
      token: "tok-existing-link",
      page_id: "page-uuid-1",
      created_at: "2026-11-01T10:00:00Z",
      expires_at: "2026-11-08T10:00:00Z",
      has_password: false,
      view_count: 5,
      is_active: true,
      is_expired: false,
      share_url: "/share/tok-existing-link",
    };

    vi.mocked(api.get).mockResolvedValue({ enabled: true, shares: [mockShare] });

    const updatedShare = {
      ...mockShare,
      expires_at: "2026-12-01T10:00:00Z",
      has_password: true,
    };
    vi.mocked(api.patch).mockResolvedValue(updatedShare);

    renderPublicDialog();

    const editButton = await screen.findByTitle("Edit link");
    await userEvent.click(editButton);

    // Edit form is displayed
    const expSelect = screen.getByLabelText("Link expires in");
    await userEvent.click(expSelect);
    await userEvent.click(screen.getByRole("menuitemradio", { name: "30 days" }));

    const addPw = screen.getByLabelText("Add password protection");
    await userEvent.click(addPw);

    const pwInput = screen.getByPlaceholderText("Set password (leave blank for none)");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(pwInput).toHaveAttribute("type", "text");
    await userEvent.type(pwInput, "newsecret");

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`${BASE}/public/share-uuid-edit`, {
        expires_in_days: 30,
        password: "newsecret",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Share link updated.");
  });

  it("changes and removes a password on an existing protected link", async () => {
    const share = {
      id: "protected",
      token: "tok-protected",
      page_id: "p1",
      created_at: "2026-11-01T10:00:00Z",
      expires_at: null,
      has_password: true,
      view_count: 0,
      is_active: true,
      is_expired: false,
      share_url: "/share/tok-protected",
    };
    vi.mocked(api.get).mockResolvedValue({ enabled: true, shares: [share] });
    vi.mocked(api.patch).mockResolvedValue(share);
    renderPublicDialog();

    await userEvent.click(await screen.findByTitle("Edit link"));
    await userEvent.click(screen.getByLabelText(/Password protection/));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Change password" }));
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    await userEvent.type(screen.getByPlaceholderText("Set password (leave blank for none)"), "replacement");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`${BASE}/public/protected`, { password: "replacement" }));

    await userEvent.click(await screen.findByTitle("Edit link"));
    await userEvent.click(screen.getByLabelText(/Password protection/));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Remove password" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith(`${BASE}/public/protected`, { clear_password: true }));
  });

  it("copies a link and reports failed create and revoke requests", async () => {
    const share = {
      id: "copy-me",
      token: "tok-copy",
      page_id: "p1",
      created_at: "2026-11-01T10:00:00Z",
      expires_at: null,
      has_password: false,
      view_count: 0,
      is_active: true,
      is_expired: false,
      share_url: "/share/tok-copy",
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.mocked(api.get).mockResolvedValue({ enabled: true, shares: [share] });
    vi.mocked(api.post).mockRejectedValue(new Error("offline"));
    vi.mocked(api.delete).mockRejectedValue(new Error("offline"));
    renderPublicDialog();
    await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/share/tok-copy"));
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New link" }));
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    await userEvent.click(screen.getByTitle("Revoke"));
    await userEvent.click(await screen.findByRole("button", { name: "Revoke link" }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${BASE}/public/copy-me`));
    expect(screen.getByText(/\/share\/tok-copy/)).toBeInTheDocument();
  });

  it("handles a failed load and clears transient state when closed", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("offline"));
    const props = {
      spaceKey: "ENG",
      pageSlug: "runbook",
      pageTitle: "Runbook",
      onOpenChange: vi.fn(),
    };
    const view = render(<PublicShareDialog {...props} open />);
    expect(await screen.findByText("Public link sharing is currently disabled by system administrator.")).toBeInTheDocument();
    view.rerender(<PublicShareDialog {...props} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reports an edit failure and can cancel a pending revoke", async () => {
    const share = {
      id: "failed-edit",
      token: "tok-failed",
      page_id: "p1",
      created_at: "2026-11-01T10:00:00Z",
      expires_at: "2026-11-08T10:00:00Z",
      has_password: false,
      view_count: 0,
      is_active: true,
      is_expired: false,
      share_url: "/share/tok-failed",
    };
    vi.mocked(api.get).mockResolvedValue({ enabled: true, shares: [share] });
    vi.mocked(api.patch).mockRejectedValue(new Error("offline"));
    renderPublicDialog();
    await userEvent.click(await screen.findByTitle("Edit link"));
    await userEvent.click(screen.getByLabelText("Link expires in"));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "No expiration" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`${BASE}/public/failed-edit`, { clear_expiration: true }));
    expect(toast.error).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByTitle("Revoke"));
    await userEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1)!);
    expect(screen.queryByRole("button", { name: "Revoke link" })).not.toBeInTheDocument();
  });
});

