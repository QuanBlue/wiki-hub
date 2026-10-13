import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserMenu } from "@/components/layout/user-menu";
import { ApiError, api } from "@/lib/api-client";
import type { Me } from "@/types/api";

const { replace, refresh, toastError } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/components/issues/report-issue-dialog", () => ({
  ReportIssueDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="report issue" /> : null,
}));
vi.mock("@/components/layout/switch-account-dialog", () => ({
  SwitchAccountMenu: ({
    canSwitch,
    onSwitched,
  }: {
    canSwitch: boolean;
    onSwitched: () => void;
  }) => (
    <div>
      <span data-testid="can-switch">{String(canSwitch)}</span>
      <button onClick={onSwitched}>switched</button>
    </div>
  ),
}));

const mocked = vi.mocked(api);

function makeUser(overrides: Partial<Me> = {}): Me {
  return {
    id: "u1",
    username: "ann",
    full_name: "Ann Lee",
    avatar_url: null,
    is_superuser: false,
    impersonator: null,
    ...overrides,
  } as unknown as Me;
}

const trigger = (name: string) => screen.getByRole("button", { name: new RegExp(name) });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.post.mockResolvedValue(undefined);
});

describe("UserMenu", () => {
  it("shows initials, falling back to the username, then to a question mark", () => {
    const first = render(<UserMenu user={makeUser()} />);
    expect(screen.getByText("AL")).toBeInTheDocument();
    first.unmount();

    const second = render(<UserMenu user={makeUser({ full_name: "", username: "bob" })} />);
    expect(screen.getByText("B")).toBeInTheDocument();
    second.unmount();

    render(<UserMenu user={makeUser({ full_name: " ", username: " " })} />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("uses the avatar image instead of initials when there is one", () => {
    render(<UserMenu user={makeUser({ avatar_url: "/me.png" })} />);
    expect(screen.queryByText("AL")).not.toBeInTheDocument();
    const avatar = document.querySelector<HTMLElement>("span[aria-hidden][style]")!;
    expect(avatar.style.backgroundImage).toContain("/me.png");
  });

  it("lets only a non-impersonating administrator switch accounts", async () => {
    const actor = userEvent.setup();
    const first = render(<UserMenu user={makeUser({ is_superuser: true })} />);
    await actor.click(trigger("Ann Lee"));
    expect(screen.getByTestId("can-switch")).toHaveTextContent("true");
    first.unmount();

    render(
      <UserMenu
        user={makeUser({
          is_superuser: true,
          impersonator: { username: "root" },
        } as Partial<Me>)}
      />,
    );
    await actor.click(trigger("Ann Lee"));
    expect(screen.getByTestId("can-switch")).toHaveTextContent("false");
    expect(screen.getByText(/root/)).toBeInTheDocument();
  });

  it("links to the account and issues pages, and closes after switching", async () => {
    const actor = userEvent.setup();
    render(<UserMenu user={makeUser()} />);
    await actor.click(trigger("Ann Lee"));
    expect(screen.getByRole("menuitem", { name: /^Account$/ })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("menuitem", { name: /My issues/ })).toHaveAttribute("href", "/issues");

    await actor.click(screen.getByText("switched"));
    await waitFor(() => expect(screen.queryByRole("menuitem")).not.toBeInTheDocument());
  });

  it("opens the report dialog", async () => {
    const actor = userEvent.setup();
    render(<UserMenu user={makeUser()} />);
    await actor.click(trigger("Ann Lee"));
    await actor.click(screen.getByRole("menuitem", { name: /Report/ }));
    expect(await screen.findByRole("dialog", { name: "report issue" })).toBeInTheDocument();
  });

  it("keeps the menu open for clicks inside the account switcher popup", async () => {
    const actor = userEvent.setup();
    render(<UserMenu user={makeUser()} />);
    await actor.click(trigger("Ann Lee"));

    const popup = document.createElement("div");
    popup.setAttribute("data-switch-account-popup", "");
    document.body.appendChild(popup);
    fireEvent.pointerDown(popup);
    expect(screen.getByRole("menuitem", { name: /^Account$/ })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("menuitem")).not.toBeInTheDocument());
    popup.remove();
  });

  it("signs out and returns to the login page", async () => {
    const actor = userEvent.setup();
    render(<UserMenu user={makeUser()} />);
    await actor.click(trigger("Ann Lee"));
    await actor.click(screen.getByRole("menuitem", { name: /Sign out/ }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/auth/logout");
    expect(refresh).toHaveBeenCalled();
  });

  it("reports a failed sign-out and allows another try", async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(500, "x", "Server down."));
    const actor = userEvent.setup();
    render(<UserMenu user={makeUser()} />);
    await actor.click(trigger("Ann Lee"));
    await actor.click(screen.getByRole("menuitem", { name: /Sign out/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();

    await actor.click(trigger("Ann Lee"));
    expect(screen.getByRole("menuitem", { name: /Sign out/ })).not.toHaveAttribute("data-disabled");
  });
});
