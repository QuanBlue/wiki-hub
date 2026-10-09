import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StorageQuotasCard } from "@/components/admin/storage-quotas-card";
import { ApiError, api } from "@/lib/api-client";
import type { SiteSettings } from "@/types/api";

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

function makeSettings(
  overrides: Partial<SiteSettings["overrides"]> = {},
): SiteSettings {
  return {
    overrides: {
      max_upload_size_mb: null,
      max_backup_import_size_mb: null,
      allowed_attachment_types: null,
      ...overrides,
    },
    effective: {
      max_upload_size_mb: 50,
      max_backup_import_size_mb: 1024,
      allowed_attachment_types: ["png", "pdf"],
    },
  } as unknown as SiteSettings;
}

const upload = () => screen.getByLabelText(/Max Single Attachment Size/);
const backup = () => screen.getByLabelText(/Max Confluence/);
const types = () => screen.getByLabelText(/Allowed Attachment File Extensions/);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.patch.mockResolvedValue({});
});

describe("StorageQuotasCard", () => {
  it("is read-only until Edit is pressed and shows inherited values as placeholders", async () => {
    const actor = userEvent.setup();
    render(<StorageQuotasCard settings={makeSettings()} />);

    expect(screen.getAllByText("(inherited from environment)")).toHaveLength(3);
    expect(upload()).toBeDisabled();
    expect(upload()).toHaveAttribute("placeholder", "50");
    expect(backup()).toHaveAttribute("placeholder", "1024");
    expect(types()).toHaveAttribute("placeholder", "png, pdf");

    await actor.click(screen.getByRole("button", { name: "Edit" }));
    expect(upload()).toBeEnabled();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Storage" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset Storage" })).toBeDisabled();
  });

  it("saves changed limits and trims the extension list", async () => {
    const actor = userEvent.setup();
    render(<StorageQuotasCard settings={makeSettings()} />);
    await actor.click(screen.getByRole("button", { name: "Edit" }));

    await actor.type(upload(), "100");
    await actor.type(backup(), "2048");
    await actor.type(types(), "png, ,jpg ,zip");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Save Storage" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(mocked.patch).toHaveBeenCalledWith("/api/v1/settings", {
      max_upload_size_mb: 100,
      max_backup_import_size_mb: 2048,
      allowed_attachment_types: ["png", "jpg", "zip"],
    });
    expect(toastSuccess).toHaveBeenCalledWith("Storage settings saved successfully.");
    expect(upload()).toBeDisabled();
  });

  it("clears overrides back to the environment values", async () => {
    const actor = userEvent.setup();
    render(
      <StorageQuotasCard
        settings={makeSettings({
          max_upload_size_mb: 80,
          max_backup_import_size_mb: 500,
          allowed_attachment_types: ["png", "gif"],
        })}
      />,
    );
    expect(screen.queryByText("(inherited from environment)")).not.toBeInTheDocument();
    expect(upload()).toHaveValue(80);
    expect(types()).toHaveValue("png, gif");

    await actor.click(screen.getByRole("button", { name: "Edit" }));
    await actor.click(screen.getByRole("button", { name: "Reset Storage" }));
    expect(upload()).toHaveValue(null);
    expect(types()).toHaveValue("");
    await actor.click(screen.getByRole("button", { name: "Save Storage" }));

    await waitFor(() => expect(mocked.patch).toHaveBeenCalled());
    expect(mocked.patch).toHaveBeenCalledWith("/api/v1/settings", {
      max_upload_size_mb: null,
      max_backup_import_size_mb: null,
      allowed_attachment_types: null,
    });
  });

  it("discards edits on Cancel", async () => {
    const actor = userEvent.setup();
    render(<StorageQuotasCard settings={makeSettings({ max_upload_size_mb: 80 })} />);
    await actor.click(screen.getByRole("button", { name: "Edit" }));
    await actor.clear(upload());
    await actor.type(upload(), "5");
    await actor.type(backup(), "7");
    await actor.type(types(), "txt");
    await actor.click(screen.getByRole("button", { name: "Cancel" }));

    expect(upload()).toHaveValue(80);
    expect(backup()).toHaveValue(null);
    expect(types()).toHaveValue("");
    expect(upload()).toBeDisabled();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("reports the server's error, or a generic one", async () => {
    const actor = userEvent.setup();
    render(<StorageQuotasCard settings={makeSettings()} />);
    await actor.click(screen.getByRole("button", { name: "Edit" }));
    await actor.type(upload(), "9");

    mocked.patch.mockRejectedValueOnce(new ApiError(400, "bad", "Too large for the bucket."));
    await actor.click(screen.getByRole("button", { name: "Save Storage" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Too large for the bucket."));

    mocked.patch.mockRejectedValueOnce(new Error("network"));
    await actor.click(screen.getByRole("button", { name: "Save Storage" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not save the settings."));
    expect(refresh).not.toHaveBeenCalled();
    // Still editing, so the user can retry.
    expect(upload()).toBeEnabled();
  });

  it("shows progress while saving", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocked.patch.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const actor = userEvent.setup();
    render(<StorageQuotasCard settings={makeSettings()} />);
    await actor.click(screen.getByRole("button", { name: "Edit" }));
    await actor.type(upload(), "9");
    await actor.click(screen.getByRole("button", { name: "Save Storage" }));

    expect(await screen.findByText("Saving...")).toBeInTheDocument();
    expect(upload()).toBeDisabled();
    resolve({});
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
