import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/auth/login-form";
import { ApiError, api } from "@/lib/api-client";

const m = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: m.replace, refresh: m.refresh }),
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);
const consentError = () =>
  new ApiError(403, "privacy_consent_required", "You must accept the personal-data policy to sign in.");

/** jsdom does no layout, so give the policy a scrollable box to read through. */
function fakeScrollableLayout() {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
}

async function signIn() {
  const actor = userEvent.setup();
  render(<LoginForm siteName="WikiHub" />);
  await actor.type(screen.getByLabelText("Username or e-mail"), "ann");
  await actor.type(screen.getByLabelText("Password"), "secret");
  await actor.click(screen.getByRole("button", { name: "Sign in" }));
  return actor;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeScrollableLayout();
});
afterEach(() => vi.restoreAllMocks());

describe("privacy consent at sign-in", () => {
  it("asks for consent and keeps Accept locked until the policy is scrolled to the end", async () => {
    mocked.post.mockRejectedValueOnce(consentError());
    await signIn();

    const accept = await screen.findByRole("button", { name: "Accept and sign in" });
    expect(accept).toBeDisabled();
    expect(m.replace).not.toHaveBeenCalled();

    const scroller = screen.getByTestId("privacy-consent-scroll");
    scroller.scrollTop = 200; // 200 + 300 < 1000 - not yet at the end
    fireEvent.scroll(scroller);
    expect(accept).toBeDisabled();

    scroller.scrollTop = 700; // 700 + 300 >= 1000 - bottom reached
    fireEvent.scroll(scroller);
    await waitFor(() => expect(accept).toBeEnabled());

    // Scrolling back up does not re-lock it.
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(accept).toBeEnabled();
  });

  it("re-submits with accept_privacy and signs in once accepted", async () => {
    mocked.post.mockRejectedValueOnce(consentError()).mockResolvedValueOnce({});
    const actor = await signIn();

    const scroller = await screen.findByTestId("privacy-consent-scroll");
    scroller.scrollTop = 700;
    fireEvent.scroll(scroller);
    await actor.click(await screen.findByRole("button", { name: "Accept and sign in" }));

    await waitFor(() => expect(m.replace).toHaveBeenCalledWith("/"));
    expect(mocked.post).toHaveBeenLastCalledWith("/api/v1/auth/login", {
      username: "ann",
      password: "secret",
      accept_privacy: true,
    });
  });

  it("does not sign in when the policy is declined, and clears the password", async () => {
    mocked.post.mockRejectedValueOnce(consentError());
    const actor = await signIn();

    await actor.click(await screen.findByRole("button", { name: "Decline" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You must accept the personal data policy to sign in.",
    );
    expect(screen.queryByTestId("privacy-consent-scroll")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(mocked.post).toHaveBeenCalledTimes(1); // nothing was sent to accept
    expect(m.replace).not.toHaveBeenCalled();
  });

  it("cannot be dismissed with Escape and has no close button", async () => {
    mocked.post.mockRejectedValueOnce(consentError());
    const actor = await signIn();
    await screen.findByTestId("privacy-consent-scroll");

    await actor.keyboard("{Escape}");
    expect(screen.getByTestId("privacy-consent-scroll")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("closes the dialog and shows the error if the accepting sign-in fails", async () => {
    mocked.post
      .mockRejectedValueOnce(consentError())
      .mockRejectedValueOnce(new ApiError(401, "unauthenticated", "Incorrect username or password."));
    const actor = await signIn();
    const scroller = await screen.findByTestId("privacy-consent-scroll");
    scroller.scrollTop = 700;
    fireEvent.scroll(scroller);
    await actor.click(await screen.findByRole("button", { name: "Accept and sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect username or password.");
    expect(screen.queryByTestId("privacy-consent-scroll")).not.toBeInTheDocument();
  });
});

describe("privacy consent contents links", () => {
  it("scrolls inside the dialog without navigating", async () => {
    mocked.post.mockRejectedValueOnce(consentError());
    const actor = await signIn();
    const scroller = await screen.findByTestId("privacy-consent-scroll");
    scroller.scrollTo = vi.fn() as unknown as typeof scroller.scrollTo;

    const link = scroller.querySelector<HTMLAnchorElement>('a[href^="#"]')!;
    const before = window.location.hash;
    await actor.click(link);

    expect(scroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
    expect(window.location.hash).toBe(before); // default navigation was prevented
  });
});
