import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountSettings } from "@/components/account/account-settings";
import { ApiError, api } from "@/lib/api-client";
import { linkNavigationTarget } from "@/lib/navigation-target";
import type { Me } from "@/types/api";

const m = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: m.refresh, push: m.push }),
}));
vi.mock("@/components/account/sessions-panel", () => ({
  SessionsPanel: () => <h2>Web sessions</h2>,
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const user: Me = {
  id: "user-1",
  username: "alice",
  email: "alice@example.com",
  full_name: "Alice Example",
  avatar_url: null,
  bio: "",
  pronouns: "",
  profile_url: "",
  social_links: [],
  company: "",
  is_active: true,
  is_superuser: false,
  is_effective_admin: false,
  is_protected: false,
  receive_admin_emails: true,
  last_login_at: null,
  privacy_accepted_at: null,
  created_at: "2026-01-01T00:00:00Z",
  groups: [],
  group_memberships: [],
  global_permissions: [],
  global_permission_overrides: [],
  global_permissions_from_groups: [],
  impersonator: null,
};

const DIALOG = "Save your changes before leaving?";

async function startEditing() {
  const actor = userEvent.setup();
  render(
    <>
      <a href="/spaces">Spaces</a>
      <AccountSettings user={user} />
    </>,
  );
  await actor.click(screen.getByRole("button", { name: "Edit profile" }));
  return actor;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.patch).mockResolvedValue({ ...user, full_name: "Alice Changed" });
});

describe("leaving the profile form with unsaved changes", () => {
  it("does not ask when nothing changed", async () => {
    const actor = await startEditing();
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(DIALOG)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
  });

  it("treats typing and then undoing the edit as unchanged", async () => {
    const actor = await startEditing();
    const name = screen.getByLabelText("Display name");
    await actor.type(name, "X");
    await actor.type(name, "{Backspace}");
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(DIALOG)).not.toBeInTheDocument();
  });

  it("asks on Cancel and lets the person keep editing", async () => {
    const actor = await startEditing();
    await actor.type(screen.getByLabelText("Display name"), " Jr");
    await actor.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByText(DIALOG)).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(screen.queryByText(DIALOG)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Alice Example Jr");
  });

  it("leaves without saving when asked to", async () => {
    const actor = await startEditing();
    await actor.type(screen.getByLabelText("Display name"), " Jr");
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(await screen.findByRole("button", { name: "Leave without saving" }));

    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
    expect(screen.getByText("Alice Example")).toBeInTheDocument();
  });

  it("saves and then leaves when asked to", async () => {
    const actor = await startEditing();
    await actor.type(screen.getByLabelText("Display name"), " Jr");
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(await screen.findByRole("button", { name: "Save and leave" }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument(),
    );
    expect(screen.queryByText(DIALOG)).not.toBeInTheDocument();
  });

  it("stays on the form when saving fails validation or the server", async () => {
    const actor = await startEditing();
    const email = screen.getByLabelText("Email address");
    await actor.clear(email);
    await actor.type(email, "not-an-email");
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(await screen.findByRole("button", { name: "Save and leave" }));

    expect(api.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(DIALOG)).not.toBeInTheDocument());
    expect(screen.getByLabelText("Email address")).toBeInTheDocument(); // still editing

    await actor.clear(email);
    await actor.type(email, "alice@example.com");
    await actor.type(screen.getByLabelText("Display name"), "!");
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(500, "boom", "Server broke."));
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(await screen.findByRole("button", { name: "Save and leave" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/./);
    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
  });

  it("asks before switching to another settings tab, and not after saving", async () => {
    const actor = await startEditing();
    await actor.type(screen.getByLabelText("Display name"), " Jr");
    await actor.click(screen.getByRole("tab", { name: "Sessions" }));

    expect(await screen.findByText(DIALOG)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Web sessions" })).not.toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Leave without saving" }));
    expect(screen.getByRole("heading", { name: "Web sessions" })).toBeInTheDocument();
  });

  it("also guards the arrow-key tab switching", async () => {
    const actor = await startEditing();
    await actor.type(screen.getByLabelText("Display name"), " Jr");
    screen.getByRole("tab", { name: "Profile" }).focus();
    await actor.keyboard("{ArrowDown}");
    expect(await screen.findByText(DIALOG)).toBeInTheDocument();
  });

  it("asks before following a link to another page", async () => {
    const actor = await startEditing();
    await actor.type(screen.getByLabelText("Display name"), " Jr");
    await actor.click(screen.getByRole("link", { name: "Spaces" }));

    expect(await screen.findByText(DIALOG)).toBeInTheDocument();
    expect(m.push).not.toHaveBeenCalled();

    await actor.click(screen.getByRole("button", { name: "Leave without saving" }));
    expect(m.push).toHaveBeenCalledWith("/spaces");
  });

  it("lets links through when there is nothing unsaved", async () => {
    const actor = await startEditing();
    // The click is not intercepted, so the dialog never opens.
    fireEvent.click(screen.getByRole("link", { name: "Spaces" }));
    expect(screen.queryByText(DIALOG)).not.toBeInTheDocument();
    await actor.keyboard("{Escape}");
  });

  it("falls back to the browser prompt when the tab is closed", async () => {
    const actor = await startEditing();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await actor.type(screen.getByLabelText("Display name"), " Jr");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe("linkNavigationTarget", () => {
  function click(el: Element, init: MouseEventInit = {}) {
    let result: URL | null | undefined;
    const handler = (event: MouseEvent) => {
      result = linkNavigationTarget(event);
    };
    document.addEventListener("click", handler, { once: true });
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
    return result;
  }
  function link(attrs: Record<string, string>) {
    const a = document.createElement("a");
    Object.entries(attrs).forEach(([k, v]) => a.setAttribute(k, v));
    document.body.appendChild(a);
    return a;
  }

  it("returns the destination of a plain same-tab link", () => {
    expect(click(link({ href: "/spaces" }))?.pathname).toBe("/spaces");
  });

  it("ignores clicks that do not leave the page", () => {
    expect(click(link({ href: "/x", target: "_blank" }))).toBeNull();
    expect(click(link({ href: "/x", download: "" }))).toBeNull();
    expect(click(link({ href: "/x" }), { button: 1 })).toBeNull();
    expect(click(link({ href: "/x" }), { metaKey: true })).toBeNull();
    expect(click(link({ href: window.location.href }))).toBeNull();
    expect(click(document.body)).toBeNull();
  });

  it("lets the caller exempt some links", () => {
    let result: URL | null | undefined;
    const a = link({ href: "/files/1" });
    document.addEventListener(
      "click",
      (event) => {
        result = linkNavigationTarget(event, (href) => href.startsWith("/files"));
      },
      { once: true },
    );
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(result).toBeNull();
  });
});
