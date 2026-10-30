import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddAdminDialog } from "@/components/admin/add-admin-dialog";
import { api, ApiError } from "@/lib/api-client";
import type { Page, User } from "@/types/api";

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
      first_name: "Charlie",
      last_name: undefined,
      username: "charlie",
      email: "charlie@corp.com",
      password: "Secret123!",
      role: "admin",
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
});
