import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangePasswordForm } from "@/components/account/change-password-form";
import { LoginForm } from "@/components/auth/login-form";
import { ApiError, api } from "@/lib/api-client";

const m = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  next: null as string | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: m.replace, refresh: m.refresh }),
  useSearchParams: () => ({ get: (key: string) => (key === "next" ? m.next : null) }),
}));
vi.mock("sonner", () => ({ toast: { success: m.toastSuccess, error: m.toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  m.next = null;
  mocked.post.mockResolvedValue({});
});

describe("LoginForm", () => {
  async function fill(actor: ReturnType<typeof userEvent.setup>, user = " ann ", pass = "secret") {
    await actor.type(screen.getByLabelText("Username or e-mail"), user);
    await actor.type(screen.getByLabelText("Password"), pass);
  }

  it("keeps Sign in disabled until both fields are filled", async () => {
    const actor = userEvent.setup();
    render(<LoginForm />);
    const button = screen.getByRole("button", { name: "Sign in" });
    expect(button).toBeDisabled();
    await actor.type(screen.getByLabelText("Username or e-mail"), "ann");
    expect(button).toBeDisabled();
    await actor.type(screen.getByLabelText("Password"), "x");
    expect(button).toBeEnabled();
  });

  it("signs in with a trimmed username and goes home", async () => {
    const actor = userEvent.setup();
    render(<LoginForm />);
    await fill(actor);
    await actor.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(m.replace).toHaveBeenCalledWith("/"));
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/auth/login", { username: "ann", password: "secret" });
    expect(m.refresh).toHaveBeenCalled();
  });

  it("returns to a safe same-site page, but never an external or protocol-relative one", async () => {
    const actor = userEvent.setup();
    for (const [next, expected] of [
      ["/spaces/ENG", "/spaces/ENG"],
      ["https://evil.example", "/"],
      ["//evil.example", "/"],
    ] as const) {
      m.next = next;
      m.replace.mockClear();
      const view = render(<LoginForm />);
      await fill(actor);
      await actor.click(screen.getByRole("button", { name: "Sign in" }));
      await waitFor(() => expect(m.replace).toHaveBeenCalledWith(expected));
      view.unmount();
    }
  });

  it("shows the server's message and clears the password", async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(401, "invalid_credentials", "Wrong username or password."));
    const actor = userEvent.setup();
    render(<LoginForm />);
    await fill(actor);
    await actor.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(m.replace).not.toHaveBeenCalled();
  });

  it("flags a deactivated account differently", async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(403, "account_inactive", "This account is disabled."));
    const actor = userEvent.setup();
    render(<LoginForm />);
    await fill(actor);
    await actor.click(screen.getByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("text-warning");
    expect(alert.querySelector("svg")).not.toBeNull();
  });

  it("reports a network failure", async () => {
    mocked.post.mockRejectedValueOnce(new TypeError("offline"));
    const actor = userEvent.setup();
    render(<LoginForm />);
    await fill(actor);
    await actor.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });

  it("shows progress while signing in", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocked.post.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const actor = userEvent.setup();
    render(<LoginForm />);
    await fill(actor);
    await actor.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("button", { name: /Signing in/ })).toBeDisabled();
    resolve({});
    await waitFor(() => expect(m.replace).toHaveBeenCalled());
  });
});

describe("ChangePasswordForm", () => {
  const strong = "Abcdef12!Abcdef12!";
  const field = (label: RegExp | string) => document.getElementById(label as string) as HTMLInputElement;

  async function fillAll(actor: ReturnType<typeof userEvent.setup>, current = "old-pass", next = strong, confirm = strong) {
    await actor.type(field("current-password"), current);
    await actor.type(field("next-password"), next);
    await actor.type(field("confirm-password"), confirm);
  }

  it("shows requirement progress and strength levels", async () => {
    const actor = userEvent.setup();
    render(<ChangePasswordForm />);
    expect(screen.getByText("0/4")).toBeInTheDocument();

    await actor.type(field("next-password"), "abc");
    expect(screen.getByText("Use a stronger password")).toBeInTheDocument();
    await actor.clear(field("next-password"));
    await actor.type(field("next-password"), "Abcdefg12345");
    expect(screen.getByText("Good")).toBeInTheDocument();
    await actor.clear(field("next-password"));
    await actor.type(field("next-password"), strong);
    expect(screen.getByText("Strong")).toBeInTheDocument();
    await actor.type(field("confirm-password"), "x");
    expect(screen.getByText("The passwords do not match.")).toBeInTheDocument();
  });

  it("changes the password, clears the form and notifies the caller", async () => {
    const actor = userEvent.setup();
    const onSuccess = vi.fn();
    render(<ChangePasswordForm onSuccess={onSuccess} onCancel={vi.fn()} />);
    await fillAll(actor);
    await actor.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/users/me/password", {
      current_password: "old-pass",
      new_password: strong,
    });
    expect(m.toastSuccess).toHaveBeenCalledWith("Password changed.");
    expect(field("current-password")).toHaveValue("");
    expect(m.refresh).toHaveBeenCalled();
  });

  it("works without callbacks and offers Cancel only when given one", async () => {
    const actor = userEvent.setup();
    const first = render(<ChangePasswordForm />);
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    await fillAll(actor);
    await actor.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalled());
    first.unmount();

    const onCancel = vi.fn();
    render(<ChangePasswordForm onCancel={onCancel} />);
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("blocks a submit that bypasses the disabled button", async () => {
    const actor = userEvent.setup();
    render(<ChangePasswordForm />);
    await actor.type(field("current-password"), "old");
    await actor.type(field("next-password"), "short");
    fireEvent.submit(field("next-password").closest("form")!);
    expect(mocked.post).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("does not meet all requirements");
  });

  it("shows the server's error", async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(400, "bad", "Current password is wrong."));
    const actor = userEvent.setup();
    render(<ChangePasswordForm />);
    await fillAll(actor);
    await actor.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password" })).toBeEnabled();
  });

  it("generates a strong password, fills both fields and copies it", async () => {
    const actor = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ChangePasswordForm />);
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Generate password" }));
    const generated = field("next-password").value;
    expect(generated).toHaveLength(20);
    expect(field("confirm-password")).toHaveValue(generated);
    expect(m.toastSuccess).toHaveBeenCalledWith("A strong password was generated.");

    await actor.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(generated);
    expect(m.toastSuccess).toHaveBeenCalledWith("Password copied to clipboard.");

    writeText.mockRejectedValueOnce(new Error("denied"));
    await actor.click(screen.getByRole("button", { name: "Copy" }));
    expect(m.toastError).toHaveBeenCalled();

    // Editing a generated password hides the Copy button again.
    await actor.type(field("next-password"), "x");
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });
});
