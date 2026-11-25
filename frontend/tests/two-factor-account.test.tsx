import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TwoFactorPanel } from "@/components/account/two-factor-panel";
import { ApiError, api } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/i18n/context";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
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

const SAMPLE_CODES = [
  "AAAA-1111",
  "BBBB-2222",
  "CCCC-3333",
  "DDDD-4444",
  "EEEE-5555",
  "FFFF-6666",
  "GGGG-7777",
  "HHHH-8888",
  "IIII-9999",
  "JJJJ-0000",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TwoFactorPanel (Account → Security)", () => {
  it("completes the Enable 2FA setup → confirm → recovery codes flow", async () => {
    const actor = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, writable: true });

    mocked.get
      .mockResolvedValueOnce({
        enabled: false,
        enabled_at: null,
        recovery_codes_remaining: 0,
        enforced: false,
      })
      .mockResolvedValueOnce({
        enabled: true,
        enabled_at: "2026-11-25T10:00:00Z",
        recovery_codes_remaining: 10,
        enforced: false,
      });

    mocked.post
      .mockResolvedValueOnce({
        secret: "JBSWY3DPEHPK3PXP",
        otpauth_uri:
          "otpauth://totp/WikiHub:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=WikiHub",
      })
      .mockResolvedValueOnce({
        enabled: true,
        recovery_codes: SAMPLE_CODES,
      });

    render(<TwoFactorPanel />);

    expect(await screen.findByText("Disabled")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: /Enable 2FA/i }));

    const setupDialog = await screen.findByRole("dialog", {
      name: /Set up two-factor authentication/i,
    });
    expect(await within(setupDialog).findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(within(setupDialog).getByLabelText("Two-factor authentication QR code")).toBeInTheDocument();

    // Copy manual secret
    await actor.click(within(setupDialog).getByRole("button", { name: /Copy key/i }));
    expect(writeText).toHaveBeenCalledWith("JBSWY3DPEHPK3PXP");

    // Enter 6-digit code — auto-confirms when full
    await actor.type(within(setupDialog).getByLabelText(/6-digit authentication code/i), "123456");

    await waitFor(() =>
      expect(mocked.post).toHaveBeenCalledWith("/api/v1/auth/2fa/confirm", { code: "123456" }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Two-factor authentication enabled.");

    // Recovery codes modal is shown
    const recoveryDialog = await screen.findByRole("dialog", {
      name: /Save your recovery codes/i,
    });
    expect(within(recoveryDialog).getByText("AAAA-1111")).toBeInTheDocument();
    expect(within(recoveryDialog).getByText("JJJJ-0000")).toBeInTheDocument();

    await actor.click(within(recoveryDialog).getByRole("button", { name: /Copy all/i }));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("AAAA-1111"));

    const doneBtn = within(recoveryDialog).getByRole("button", { name: "Done" });
    expect(doneBtn).toBeDisabled();

    await actor.click(within(recoveryDialog).getByRole("button", { name: /Download \.txt/i }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    expect(doneBtn).toBeEnabled();

    await actor.click(doneBtn);
    await waitFor(() => expect(screen.getByText("Enabled")).toBeInTheDocument());
    expect(screen.getByText("10 recovery codes remaining")).toBeInTheDocument();
  });

  it("regenerates recovery codes with password + TOTP code", async () => {
    const actor = userEvent.setup();
    mocked.get.mockResolvedValue({
      enabled: true,
      enabled_at: "2026-11-25T10:00:00Z",
      recovery_codes_remaining: 2,
      enforced: false,
    });
    mocked.post.mockResolvedValueOnce({ recovery_codes: SAMPLE_CODES });

    render(<TwoFactorPanel />);

    expect(
      await screen.findByText(/Only 2 recovery codes remaining/i),
    ).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: /Regenerate recovery codes/i }));
    const dialog = await screen.findByRole("dialog", { name: /Regenerate recovery codes/i });

    await actor.type(within(dialog).getByLabelText(/Current password/i), "Secret123!");
    await actor.type(within(dialog).getByLabelText(/6-digit authentication code/i), "654321");

    await waitFor(() =>
      expect(mocked.post).toHaveBeenCalledWith("/api/v1/auth/2fa/recovery-codes/regenerate", {
        password: "Secret123!",
        code: "654321",
      }),
    );

    const recoveryDialog = await screen.findByRole("dialog", {
      name: /Save your recovery codes/i,
    });
    expect(within(recoveryDialog).getByText("BBBB-2222")).toBeInTheDocument();
  });

  it("disables 2FA when not enforced and reports API errors", async () => {
    const actor = userEvent.setup();
    mocked.get.mockResolvedValueOnce({
      enabled: true,
      enabled_at: "2026-11-25T10:00:00Z",
      recovery_codes_remaining: 8,
      enforced: false,
    });
    mocked.post
      .mockRejectedValueOnce(new ApiError(400, "invalid_code", "Invalid 2FA code."))
      .mockResolvedValueOnce({
        enabled: false,
        enabled_at: null,
        recovery_codes_remaining: 0,
        enforced: false,
      });

    render(
      <LocaleProvider>
        <TwoFactorPanel />
      </LocaleProvider>,
    );
    await screen.findByText("Enabled");

    await actor.click(screen.getByRole("button", { name: /Disable 2FA/i }));
    const dialog = await screen.findByRole("dialog", {
      name: /Disable two-factor authentication/i,
    });

    await actor.type(within(dialog).getByLabelText(/Current password/i), "Secret123!");
    await actor.type(within(dialog).getByLabelText(/6-digit authentication code/i), "000000");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Invalid 2FA code.");

    await actor.click(within(dialog).getByRole("button", { name: /Use a recovery code/i }));
    await actor.type(within(dialog).getByLabelText(/Recovery code/i), "AAAA-1111");
    await actor.click(within(dialog).getByRole("button", { name: /Disable 2FA/i }));

    await waitFor(() =>
      expect(mocked.post).toHaveBeenLastCalledWith("/api/v1/auth/2fa/disable", {
        password: "Secret123!",
        code: "AAAA-1111",
      }),
    );
    expect(await screen.findByText("Disabled")).toBeInTheDocument();
  });

  it("locks the Disable 2FA button when workspace policy enforces 2FA", async () => {
    mocked.get.mockResolvedValueOnce({
      enabled: true,
      enabled_at: "2026-11-25T10:00:00Z",
      recovery_codes_remaining: 10,
      enforced: true,
    });

    render(<TwoFactorPanel />);

    expect(await screen.findByText("Required by policy")).toBeInTheDocument();
    const disableBtn = screen.getByRole("button", { name: /Disable 2FA/i });
    expect(disableBtn).toBeDisabled();
    expect(disableBtn).toHaveAttribute(
      "title",
      expect.stringContaining("required by workspace policy"),
    );
  });
});
