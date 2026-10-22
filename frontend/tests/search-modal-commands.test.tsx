import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SearchModal } from "@/components/layout/search-modal";
import { resetAiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";
import { TRASH_OPEN_EVENT } from "@/lib/space-trash";
import type { Me } from "@/types/api";

const navigate = vi.hoisted(() => vi.fn());
const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("@/components/layout/navigation-progress", () => ({
  useNavigate: () => navigate,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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
const USER = { is_superuser: false, global_permissions: [] } as unknown as Me;

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <SearchModal open={open} onOpenChange={setOpen} user={USER} />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAiStatus();
  pathname.current = "/";
  Element.prototype.scrollIntoView = vi.fn();
  mocked.get.mockImplementation(async (url: string) =>
    url.includes("/ai/status")
      ? { enabled: true, can_configure: false }
      : { query: "", spaces: [], pages: [] },
  );
});

const box = () => screen.getByPlaceholderText("Search WikiHub...");

describe("SearchModal commands and app pages", () => {
  it("lists an app page found by its words, and opens it", async () => {
    const actor = userEvent.setup();
    render(<Harness />);

    await actor.type(box(), "change password");
    await actor.click(
      await screen.findByRole("button", { name: /Change password/ }),
    );

    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/account"));
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("says when no guide matches a :help question, and opens one that does", async () => {
    const actor = userEvent.setup();
    render(<Harness />);

    await actor.type(box(), ":help zzqqxxvv");
    expect(
      await screen.findByText(/No guide matches “zzqqxxvv”/),
    ).toBeInTheDocument();

    await actor.clear(box());
    await actor.type(box(), ":help change password");
    const guide = await screen.findAllByRole("button", { name: /password/i });
    await actor.click(guide[guide.length - 1]);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/help"));
  });

  it("asks the AI in place from :ask, keeping the box open", async () => {
    const actor = userEvent.setup();
    render(<Harness />);

    await actor.type(box(), ":ask");
    const ask = await screen.findByRole("button", { name: /Ask AI/ });
    await waitFor(() => expect(ask).not.toHaveAttribute("aria-disabled"));
    await actor.click(ask);

    expect(screen.getByTestId("state")).toHaveTextContent("open");
  });

  it("opens the Trash of the space being looked at from :trash", async () => {
    pathname.current = "/spaces/OPS/pages/runbook";
    const opened = vi.fn();
    window.addEventListener(TRASH_OPEN_EVENT, opened);
    const actor = userEvent.setup();
    render(<Harness />);

    await actor.type(box(), ":trash");
    await actor.click(await screen.findByRole("button", { name: /Trash/ }));

    expect(opened).toHaveBeenCalledTimes(1);
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
      spaceKey: "OPS",
    });
    window.removeEventListener(TRASH_OPEN_EVENT, opened);
  });
});
