import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/auth/login-form";
import { ApiError, api } from "@/lib/api-client";

const { replace, refresh, toastSuccess } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => new URLSearchParams("?next=/spaces"),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:mock-recovery");
  URL.revokeObjectURL = vi.fn();
});

describe("LoginForm 2FA flows", () => {
  it("handles 2FA verification challenge, recovery-code toggle, and completes sign-in", async () => {
    const actor = userEvent.setup();
    mocked.post
      .mockResolvedValueOnce({
        access_token: null,
        token_type: "bearer",
        expires_at: null,
        user: null,
        requires_2fa: true,
        requires_2fa_setup: false,
        challenge_token: "chal-123",
      })
      .mockRejectedValueOnce(new ApiError(401, "invalid_code", "Invalid 2FA code."))
      .mockResolvedValueOnce({
        access_token: "tok",
        token_type: "bearer",
        expires_at: "2026-11-26T00:00:00Z",
        user: { id: "u1", username: "alice" },
        requires_2fa: false,
        requires_2fa_setup: false,
        challenge_token: null,
      });

    render(<LoginForm siteName="WikiHub" />);

    await actor.type(screen.getByLabelText(/Username/i), "alice");
    await actor.type(screen.getByLabelText(/^Password$/i), "Secret123!");
    await actor.click(screen.getByRole("button", { name: /Sign in/i }));

    expect(await screen.findByText("Two-factor authentication")).toBeInTheDocument();

    // Failed authenticator attempt — auto-verifies when all 6 digits are entered
    await actor.type(screen.getByLabelText(/6-digit authentication code/i), "000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid 2FA code.");

    // Switch to recovery code mode
    await actor.click(screen.getByRole("button", { name: /Use a recovery code/i }));
    const recoveryInput = screen.getByLabelText(/Recovery code/i);
    expect(recoveryInput).toHaveAttribute("placeholder", "XXXX-XXXX");

    await actor.type(recoveryInput, "ABCD-1234");
    await actor.click(screen.getByRole("button", { name: /^Verify$/i }));

    await waitFor(() =>
      expect(mocked.post).toHaveBeenLastCalledWith("/api/v1/auth/2fa/verify", {
        challenge_token: "chal-123",
        code: "ABCD-1234",
      }),
    );
    expect(replace).toHaveBeenCalledWith("/spaces");
    expect(refresh).toHaveBeenCalled();
  });

  it("allows backing out of 2FA challenge to the sign-in form", async () => {
    const actor = userEvent.setup();
    mocked.post.mockResolvedValueOnce({
      access_token: null,
      token_type: "bearer",
      expires_at: null,
      user: null,
      requires_2fa: true,
      requires_2fa_setup: false,
      challenge_token: "chal-back",
    });

    render(<LoginForm />);
    await actor.type(screen.getByLabelText(/Username/i), "alice");
    await actor.type(screen.getByLabelText(/^Password$/i), "Secret123!");
    await actor.click(screen.getByRole("button", { name: /Sign in/i }));

    await screen.findByText("Two-factor authentication");
    await actor.click(screen.getByRole("button", { name: /Back to sign in/i }));

    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password$/i)).toHaveValue("");
  });

  it("handles inline forced 2FA setup → QR + confirm → recovery codes → Continue", async () => {
    const actor = userEvent.setup();
    mocked.post
      .mockResolvedValueOnce({
        access_token: null,
        token_type: "bearer",
        expires_at: null,
        user: null,
        requires_2fa: true,
        requires_2fa_setup: true,
        challenge_token: "chal-forced",
      })
      .mockResolvedValueOnce({
        secret: "FORCEDSECRET1234",
        otpauth_uri:
          "otpauth://totp/WikiHub:bob@example.com?secret=FORCEDSECRET1234&issuer=WikiHub",
      })
      .mockResolvedValueOnce({
        enabled: true,
        recovery_codes: ["REC1-AAAA", "REC2-BBBB"],
        access_token: "tok",
        expires_at: "2026-11-26T00:00:00Z",
        user: { id: "u2", username: "bob" },
      });

    render(<LoginForm siteName="Acme Wiki" />);

    await actor.type(screen.getByLabelText(/Username/i), "bob");
    await actor.type(screen.getByLabelText(/^Password$/i), "Secret123!");
    await actor.click(screen.getByRole("button", { name: /Sign in/i }));

    expect(
      await screen.findByText("Two-factor authentication required"),
    ).toBeInTheDocument();
    expect(await screen.findByText("FORCEDSECRET1234")).toBeInTheDocument();
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/auth/2fa/setup", {
      challenge_token: "chal-forced",
    });

    // Auto-confirms once all 6 digits are entered
    await actor.type(screen.getByLabelText(/6-digit authentication code/i), "987654");

    await waitFor(() =>
      expect(mocked.post).toHaveBeenLastCalledWith("/api/v1/auth/2fa/confirm", {
        code: "987654",
        challenge_token: "chal-forced",
      }),
    );

    expect(await screen.findByText("Save your recovery codes")).toBeInTheDocument();
    expect(screen.getByText("REC1-AAAA")).toBeInTheDocument();
    expect(screen.getByText("REC2-BBBB")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    const continueBtn = screen.getByRole("button", { name: /Continue to Acme Wiki/i });
    expect(continueBtn).toBeDisabled();

    await actor.click(screen.getByRole("button", { name: /Download \.txt/i }));
    expect(continueBtn).toBeEnabled();

    await actor.click(continueBtn);
    expect(replace).toHaveBeenCalledWith("/spaces");
    expect(refresh).toHaveBeenCalled();
  });
});
