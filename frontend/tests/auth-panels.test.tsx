import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AuthPanels } from "@/components/auth/auth-panels";
import { api } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const CONTACT_TITLE = "Contact an administrator";

function panes() {
  // Each pane's wrapper is the element carrying `inert`.
  // `hidden: true` because the parked pane is aria-hidden.
  const find = (name: string) =>
    screen.getByRole("heading", { name, hidden: true }).closest("[aria-hidden]");
  const login = find("Welcome back");
  const contact = find(CONTACT_TITLE);
  return { login: login as HTMLElement, contact: contact as HTMLElement };
}

describe("AuthPanels", () => {
  it("starts on the sign-in form, with the contact form parked out of reach", () => {
    render(<AuthPanels siteName="WikiHub" />);

    const { login, contact } = panes();
    expect(login).not.toHaveAttribute("inert");
    expect(contact).toHaveAttribute("inert");
    expect(contact).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send request" })).toBeNull();
  });

  it("swaps to the contact form in place, and back again", async () => {
    const user = userEvent.setup();
    render(<AuthPanels siteName="WikiHub" />);

    await user.click(screen.getByRole("button", { name: "Contact an administrator" }));

    let { login, contact } = panes();
    expect(login).toHaveAttribute("inert");
    expect(contact).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Send request" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    // Focus follows the switch, so keyboard users are not left behind.
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: CONTACT_TITLE }),
    );

    await user.click(screen.getByRole("button", { name: "Back to sign in" }));

    ({ login, contact } = panes());
    expect(login).not.toHaveAttribute("inert");
    expect(contact).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("opens on the contact form when asked to, e.g. from an old /contact-admin link", () => {
    render(<AuthPanels siteName="WikiHub" initialView="contact" />);

    expect(screen.getByRole("button", { name: "Send request" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("keeps the address in step with the visible form", async () => {
    const user = userEvent.setup();
    render(<AuthPanels siteName="WikiHub" />);

    await user.click(screen.getByRole("button", { name: "Contact an administrator" }));
    expect(window.location.search).toBe("?view=contact");

    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(window.location.search).toBe("");
  });

  it("swaps the heading for the sent screen, whose own button leads back to sign in", async () => {
    vi.mocked(api.post).mockResolvedValue({ delivery: "sent" });
    const user = userEvent.setup();
    render(<AuthPanels siteName="WikiHub" />);

    await user.click(screen.getByRole("button", { name: "Contact an administrator" }));
    await user.type(screen.getByLabelText(/^Your name/u), "Alice");
    await user.type(screen.getByLabelText(/^Your email/u), "alice@example.org");
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByRole("heading", { name: "Request sent" })).toBeInTheDocument();
    // The form's own heading and the small back link give way to it.
    expect(screen.queryByRole("heading", { name: "Contact an administrator" })).toBeNull();
    const back = screen.getAllByRole("button", { name: "Back to sign in" });
    expect(back).toHaveLength(1);

    await user.click(back[0]!);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("hands back an empty contact form after leaving it", async () => {
    const user = userEvent.setup();
    render(<AuthPanels siteName="WikiHub" />);

    await user.click(screen.getByRole("button", { name: "Contact an administrator" }));
    await user.type(screen.getByLabelText(/^Your name/u), "Alice");
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));

    await waitFor(() => {
      expect(
        (screen.getByLabelText(/^Your name/u, { selector: "input" }) as HTMLInputElement)
          .value,
      ).toBe("");
    });
  });
});
