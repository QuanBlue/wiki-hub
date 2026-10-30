import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddAdminDialog } from "@/components/admin/add-admin-dialog";
import { api, ApiError } from "@/lib/api-client";
import type { Page, User } from "@/types/api";

const emailMocks = vi.hoisted(() => ({
  canEmail: false,
  notifyAdminGranted: vi.fn(),
  notifyAccountEmail: vi.fn(),
}));

vi.mock("@/components/admin/account-email-option", () => ({
  useCanEmailAccounts: () => emailMocks.canEmail,
  notifyAdminGranted: (...args: any[]) => emailMocks.notifyAdminGranted(...args),
  notifyAccountEmail: (...args: any[]) => emailMocks.notifyAccountEmail(...args),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

function member(id: string, username: string): User {
  return {
    id,
    username,
    email: `${username}@corp.com`,
    full_name: `User ${username}`,
    is_superuser: false,
    is_protected: false,
    receive_admin_emails: true,
    status: "active",
    role: "member",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    global_permissions: [],
  } as unknown as User;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({
    items: [member("u-1", "alice"), member("u-2", "bob")],
    total: 2,
    limit: 100,
    offset: 0,
  } as Page<User>);
});

describe("AddAdminDialog", () => {
  it("does not render when viewer is not a system admin", () => {
    const { container } = render(<AddAdminDialog viewerIsSystemAdmin={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("opens dialog on click and displays eligible members", async () => {
    const user = userEvent.setup();
    render(<AddAdminDialog viewerIsSystemAdmin={true} />);

    const trigger = screen.getByRole("button", { name: /add administrator/i });
    await user.click(trigger);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/promote an existing workspace member/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/users?role=member"),
      );
    });
  });

  it("submits promote member request with receive_admin_emails=true by default", async () => {
    vi.mocked(api.patch).mockResolvedValue({} as any);
    const user = userEvent.setup();
    render(<AddAdminDialog viewerIsSystemAdmin={true} />);

    await user.click(screen.getByRole("button", { name: /add administrator/i }));

    const submitBtn = screen.getByRole("button", { name: /add as administrator/i });
    expect(submitBtn).toBeDisabled();

    // Select a member
    const selectTrigger = screen.getByRole("button", { name: /workspace member/i });
    await user.click(selectTrigger);
    await user.click(screen.getByText("User alice (@alice)"));

    await waitFor(() => {
      expect(screen.getByText(/alice@corp\.com/)).toBeInTheDocument();
    });
    expect(submitBtn).not.toBeDisabled();

    await user.click(submitBtn);

    expect(api.patch).toHaveBeenCalledWith("/api/v1/users/u-1", {
      is_superuser: true,
      receive_admin_emails: true,
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("allows turning off receive_admin_emails before promoting", async () => {
    vi.mocked(api.patch).mockResolvedValue({} as any);
    const user = userEvent.setup();
    render(<AddAdminDialog viewerIsSystemAdmin={true} />);

    await user.click(screen.getByRole("button", { name: /add administrator/i }));

    // Select a member
    const selectTrigger = screen.getByRole("button", { name: /workspace member/i });
    await user.click(selectTrigger);
    await user.click(screen.getByText("User alice (@alice)"));

    await waitFor(() => {
      expect(screen.getByText(/alice@corp\.com/)).toBeInTheDocument();
    });

    // Toggle switch off
    const emailSwitch = screen.getByRole("switch");
    expect(emailSwitch).toHaveAttribute("aria-checked", "true");
    await user.click(emailSwitch);
    expect(emailSwitch).toHaveAttribute("aria-checked", "false");

    const submitBtn = screen.getByRole("button", { name: /add as administrator/i });
    await user.click(submitBtn);

    expect(api.patch).toHaveBeenCalledWith("/api/v1/users/u-1", {
      is_superuser: true,
      receive_admin_emails: false,
    });
  });

  it("switches to create tab and creates a brand new administrator", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes("?q=")) {
        return { items: [], total: 0, limit: 10, offset: 0 } as any;
      }
      return { items: [member("u-1", "alice")], total: 1, limit: 100, offset: 0 } as any;
    });
    vi.mocked(api.post).mockResolvedValue(member("u-new", "charlie"));

    const user = userEvent.setup();
    render(<AddAdminDialog viewerIsSystemAdmin={true} />);

    await user.click(screen.getByRole("button", { name: /add administrator/i }));

    // Switch to Create Tab
    const createTabBtn = screen.getByRole("button", { name: /create new administrator/i });
    await user.click(createTabBtn);

    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/first name/i), "Charlie");
    await user.type(screen.getByLabelText(/username/i), "charlie");
    await user.type(screen.getByLabelText(/e-mail/i), "charlie@corp.com");
    await user.type(screen.getByLabelText(/temporary password/i), "Secret123!");

    await waitFor(() => {
      expect(screen.getByText("Available")).toBeInTheDocument();
    });

    const createBtn = screen.getByRole("button", { name: /create administrator/i });
    await user.click(createBtn);

    expect(api.post).toHaveBeenCalledWith("/api/v1/users", {
      full_name: "Charlie",
      username: "charlie",
      email: "charlie@corp.com",
      password: "Secret123!",
      is_superuser: true,
      receive_admin_emails: true,
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("displays error when promote fails", async () => {
    vi.mocked(api.patch).mockRejectedValue(new ApiError(400, "forbidden", "Permission denied"));
    const user = userEvent.setup();
    render(<AddAdminDialog viewerIsSystemAdmin={true} />);

    await user.click(screen.getByRole("button", { name: /add administrator/i }));

    const selectTrigger = screen.getByRole("button", { name: /workspace member/i });
    await user.click(selectTrigger);
    await user.click(screen.getByText("User alice (@alice)"));

    await waitFor(() => {
      expect(screen.getByText(/alice@corp\.com/)).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole("button", { name: /add as administrator/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Permission denied")).toBeInTheDocument();
    });
  });

  it("handles email notifications when promoting a member", async () => {
    emailMocks.canEmail = true;
    emailMocks.notifyAdminGranted.mockResolvedValueOnce({ email_sent: true });
    vi.mocked(api.patch).mockResolvedValue({} as any);

    const user = userEvent.setup();
    render(<AddAdminDialog viewerIsSystemAdmin={true} />);

    await user.click(screen.getByRole("button", { name: /add administrator/i }));
    await user.click(screen.getByRole("button", { name: /workspace member/i }));
    await user.click(screen.getByText("User alice (@alice)"));
    await user.click(screen.getByRole("button", { name: /add as administrator/i }));

    await waitFor(() => {
      expect(emailMocks.notifyAdminGranted).toHaveBeenCalledWith("u-1");
    });

    // Test when outcome email fails
    emailMocks.notifyAdminGranted.mockResolvedValueOnce({ email_sent: false });
    await user.click(screen.getByRole("button", { name: /add administrator/i }));
    await user.click(screen.getByRole("button", { name: /workspace member/i }));
    await user.click(screen.getByText("User alice (@alice)"));
    await user.click(screen.getByRole("button", { name: /add as administrator/i }));

    await waitFor(() => {
      expect(emailMocks.notifyAdminGranted).toHaveBeenCalledTimes(2);
    });
    emailMocks.canEmail = false;
  });

  it("handles email notifications and errors when creating an admin", async () => {
    emailMocks.canEmail = true;
    emailMocks.notifyAccountEmail.mockResolvedValueOnce({ email_sent: true });
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes("?q=")) return { items: [], total: 0, limit: 10, offset: 0 } as any;
      return { items: [member("u-1", "alice")], total: 1, limit: 100, offset: 0 } as any;
    });
    vi.mocked(api.post).mockResolvedValue(member("u-new", "dave"));

    const user = userEvent.setup();
    render(<AddAdminDialog viewerIsSystemAdmin={true} />);

    await user.click(screen.getByRole("button", { name: /add administrator/i }));
    await user.click(screen.getByRole("button", { name: /create new administrator/i }));

    expect(screen.getByText(/WikiHub will email the sign-in details/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/first name/i), "Dave");
    await user.type(screen.getByLabelText(/username/i), "dave");
    await user.type(screen.getByLabelText(/e-mail/i), "dave@corp.com");
    await user.type(screen.getByLabelText(/temporary password/i), "Secret123!");

    await waitFor(() => {
      expect(screen.getByText("Available")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /create administrator/i }));
    await waitFor(() => {
      expect(emailMocks.notifyAccountEmail).toHaveBeenCalledWith("created", "u-new", "Secret123!");
    });

    // Test when outcome email fails
    emailMocks.notifyAccountEmail.mockResolvedValueOnce({ email_sent: false });
    await user.click(screen.getByRole("button", { name: /add administrator/i }));
    await user.click(screen.getByRole("button", { name: /create new administrator/i }));
    await user.type(screen.getByLabelText(/first name/i), "Dave2");
    await user.type(screen.getByLabelText(/username/i), "dave2");
    await user.type(screen.getByLabelText(/e-mail/i), "dave2@corp.com");
    await user.type(screen.getByLabelText(/temporary password/i), "Secret123!");

    await waitFor(() => {
      expect(screen.getByText("Available")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /create administrator/i }));
    await waitFor(() => {
      expect(emailMocks.notifyAccountEmail).toHaveBeenCalledTimes(2);
    });

    emailMocks.canEmail = false;
  });

  it("handles username_taken and creation errors on Create tab", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes("?q=")) return { items: [], total: 0, limit: 10, offset: 0 } as any;
      return { items: [], total: 0, limit: 100, offset: 0 } as any;
    });
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(409, "username_taken", "Username is already registered"),
    );

    const user = userEvent.setup();
    render(<AddAdminDialog viewerIsSystemAdmin={true} />);

    await user.click(screen.getByRole("button", { name: /add administrator/i }));
    await user.click(screen.getByRole("button", { name: /create new administrator/i }));

    await user.type(screen.getByLabelText(/first name/i), "Dave");
    await user.type(screen.getByLabelText(/username/i), "dave");
    await user.type(screen.getByLabelText(/e-mail/i), "dave@corp.com");
    await user.type(screen.getByLabelText(/temporary password/i), "Secret123!");

    await waitFor(() => {
      expect(screen.getByText("Available")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /create administrator/i }));
    await waitFor(() => {
      expect(screen.getByText("Username is already registered")).toBeInTheDocument();
      expect(screen.getByText("Username is already taken")).toBeInTheDocument();
    });
  });

  it("handles generic error on Create tab", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes("?q=")) return { items: [], total: 0, limit: 10, offset: 0 } as any;
      return { items: [], total: 0, limit: 100, offset: 0 } as any;
    });
    vi.mocked(api.post).mockRejectedValueOnce(new Error("Network drop"));

    const user = userEvent.setup();
    render(<AddAdminDialog viewerIsSystemAdmin={true} />);

    await user.click(screen.getByRole("button", { name: /add administrator/i }));
    await user.click(screen.getByRole("button", { name: /create new administrator/i }));

    await user.type(screen.getByLabelText(/first name/i), "Dave");
    await user.type(screen.getByLabelText(/username/i), "dave");
    await user.type(screen.getByLabelText(/e-mail/i), "dave@corp.com");
    await user.type(screen.getByLabelText(/temporary password/i), "Secret123!");

    await waitFor(() => {
      expect(screen.getByText("Available")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /create administrator/i }));
    await waitFor(() => {
      expect(screen.getByText("Could not create the administrator.")).toBeInTheDocument();
    });
  });

  it("handles member load failures and username availability error", async () => {
    // 1. Rejection with ApiError
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(500, "boom", "Database unavailable"));
    const user = userEvent.setup();
    render(<AddAdminDialog viewerIsSystemAdmin={true} />);
    await user.click(screen.getByRole("button", { name: /add administrator/i }));
    await waitFor(() => {
      expect(screen.getByText("Database unavailable")).toBeInTheDocument();
    });

    // Close dialog via Escape to trigger onOpenChange(false) and reset()
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    // 2. Rejection with generic Error (non-ApiError)
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Network glitch"));
    await user.click(screen.getByRole("button", { name: /add administrator/i }));
    await waitFor(() => {
      expect(screen.getByText(/could not promote user to administrator/i)).toBeInTheDocument();
    });

    // Cancel button resets and closes
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    // 3. Reopen and check username error
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes("?q=")) throw new Error("Search service down");
      return { items: [member("u-1", "alice")], total: 1, limit: 100, offset: 0 } as any;
    });
    await user.click(screen.getByRole("button", { name: /add administrator/i }));
    await user.click(screen.getByRole("button", { name: /create new administrator/i }));
    await user.type(screen.getByLabelText(/username/i), "alice");
    // Wait for debounce and search call
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining("?q=alice"));
    });
    // Create button remains disabled because usernameCheck === "error" (not "available")
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create administrator/i })).toBeDisabled();
    });
  });
});
