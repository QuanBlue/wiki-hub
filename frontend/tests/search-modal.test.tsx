import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SearchModal } from "@/components/layout/search-modal";
import { CHEAT_SHEET_OPEN_EVENT, triggerOpenSearch } from "@/lib/cheat-sheet";
import { api } from "@/lib/api-client";
import { resetAllShortcuts, setBindings } from "@/lib/keyboard-shortcuts";
import { markLocalFindActive } from "@/lib/local-find-registry";
import type { Me, SearchResults } from "@/types/api";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@/components/layout/navigation-progress", () => ({
  useNavigate: () => navigate,
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

const RESULTS: SearchResults = {
  query: "ops",
  spaces: [
    { id: "s1", key: "OPS", name: "Operations", description: "Ops handbook" },
    { id: "s2", key: "BARE", name: "Bare ops", description: "" },
  ],
  pages: [
    {
      id: "p1",
      title: "Ops runbook",
      slug: "ops-runbook",
      space_key: "OPS",
      space_name: "Operations",
      snippet: "How to run ops (really) [fast]",
      updated_at: null,
    },
    {
      id: "p2",
      title: "No snippet",
      slug: "no snippet",
      space_key: "OPS",
      space_name: "Operations",
      snippet: "",
      updated_at: null,
    },
  ],
};

const USER = { is_superuser: false, global_permissions: [] } as unknown as Me;

function Harness({ initialOpen = true, user }: { initialOpen?: boolean; user?: Me }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <SearchModal open={open} onOpenChange={setOpen} user={user} />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  mocked.get.mockResolvedValue(RESULTS);
});

describe("SearchModal", () => {
  it("shows the quick-search prompt until something is typed", async () => {
    render(<Harness />);
    expect(screen.getByText("Quick Search WikiHub")).toBeInTheDocument();
    // The input takes focus shortly after opening.
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Search WikiHub...")).toHaveFocus(),
    );
    // Opening asks whether the AI assistant is on (for the "Ask AI" row), but searches nothing.
    expect(mocked.get).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/search"),
    );
  });

  it("searches after a pause and lists spaces and pages with highlights", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    await actor.type(screen.getByPlaceholderText("Search WikiHub..."), " ops ");

    expect(await screen.findByText("Spaces (2)")).toBeInTheDocument();
    expect(screen.getByText("Pages (2)")).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/search?q=ops");
    expect(document.querySelectorAll("mark").length).toBeGreaterThan(3);
    expect(document.body.textContent).toContain("— Ops handbook");
    expect(screen.getAllByText("OPS").length).toBeGreaterThan(0);
  });

  it("escapes regex characters in the query when highlighting", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    await actor.type(
      screen.getByPlaceholderText("Search WikiHub..."),
      "(really)",
    );
    await screen.findByText("Pages (2)");
    expect(document.querySelector("mark")).toHaveTextContent("(really)");
  });

  it("marks the words the server searched for, ignoring accents and including synonyms", async () => {
    mocked.get.mockResolvedValue({
      query: "tài khoản nuti",
      spaces: [],
      terms: ["tai khoan", "account", "nuti"],
      pages: [
        {
          id: "p1",
          title: "Account ViettelCloud",
          slug: "account",
          space_key: "OPS",
          space_name: "Operations",
          snippet: "...đăng nhập tài khoản NUTIFOOD_vts...",
          updated_at: null,
        },
      ],
    } satisfies SearchResults);
    const actor = userEvent.setup();
    render(<Harness />);
    await actor.type(
      screen.getByPlaceholderText("Search WikiHub..."),
      "tài khoản nuti",
    );
    await screen.findByText("Pages (1)");

    expect(
      [...document.querySelectorAll("mark")].map((m) => m.textContent),
    ).toEqual(["Account", "tài khoản", "NUTIFOOD"]);
  });

  it("says when the words were found in a file attached to the page", async () => {
    mocked.get.mockResolvedValue({
      query: "zircon",
      spaces: [],
      terms: ["zircon"],
      pages: [
        {
          id: "p1",
          title: "Sales",
          slug: "sales",
          space_key: "OPS",
          space_name: "Operations",
          snippet: "The zircon licence costs 4200",
          updated_at: null,
          file_id: "f1",
          file_name: "prices.pdf",
        },
      ],
    } satisfies SearchResults);
    const actor = userEvent.setup();
    render(<Harness />);
    await actor.type(screen.getByPlaceholderText("Search WikiHub..."), "zircon");

    expect(
      await screen.findByText("In the attached file prices.pdf"),
    ).toBeInTheDocument();
  });

  it("navigates with the arrow keys and Enter", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    const input = screen.getByPlaceholderText("Search WikiHub...");
    await actor.type(input, "ops");
    await screen.findByText("Spaces (2)");

    // Wrap upwards from the first entry to the last page, then back down.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(navigate).toHaveBeenCalledWith("/spaces/OPS/pages/ops-runbook");
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("opens a space or an encoded page by clicking", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    await actor.type(screen.getByPlaceholderText("Search WikiHub..."), "ops");
    await screen.findByText("Spaces (2)");

    await actor.hover(screen.getByRole("button", { name: /Bare ops/ }));
    await actor.click(screen.getByRole("button", { name: /Operations/ }));
    expect(navigate).toHaveBeenCalledWith("/spaces/OPS");
  });

  it("encodes the page slug when opening a page", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    await actor.type(screen.getByPlaceholderText("Search WikiHub..."), "ops");
    await screen.findByText("Spaces (2)");
    await actor.click(screen.getByRole("button", { name: /No snippet/ }));
    expect(navigate).toHaveBeenCalledWith("/spaces/OPS/pages/no%20snippet");
  });

  it("ignores keys when there is nothing to pick", async () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByPlaceholderText("Search WikiHub..."), {
      key: "Enter",
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows an empty state, and treats a failed search as no results", async () => {
    const actor = userEvent.setup();
    mocked.get.mockResolvedValueOnce({ query: "zzz", spaces: [], pages: [] });
    render(<Harness />);
    const input = screen.getByPlaceholderText("Search WikiHub...");
    await actor.type(input, "zzz");
    expect(
      await screen.findByText(/No spaces or pages matched/),
    ).toBeInTheDocument();

    mocked.get.mockRejectedValueOnce(new Error("offline"));
    await actor.type(input, "y");
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(/No spaces or pages matched/),
    ).toBeInTheDocument();
  });

  it("shows a searching indicator while the request is in flight", async () => {
    let resolve: (value: SearchResults) => void = () => {};
    mocked.get.mockReturnValueOnce(
      new Promise<SearchResults>((r) => (resolve = r)),
    );
    const actor = userEvent.setup();
    render(<Harness />);
    await actor.type(screen.getByPlaceholderText("Search WikiHub..."), "ops");
    expect(await screen.findByText("Searching WikiHub...")).toBeInTheDocument();
    await act(async () => resolve(RESULTS));
    expect(await screen.findByText("Pages (2)")).toBeInTheDocument();
  });

  it("keeps the answer to the latest question when an earlier, slower one arrives afterwards", async () => {
    const slowEarlier: SearchResults = {
      ...RESULTS,
      query: "ops",
      pages: [
        {
          ...RESULTS.pages[0]!,
          id: "old",
          title: "Answer to the earlier question",
        },
      ],
    };
    const latest: SearchResults = {
      ...RESULTS,
      query: "ops runbook",
      pages: [
        {
          ...RESULTS.pages[0]!,
          id: "new",
          title: "Answer to the latest question",
        },
      ],
    };
    let resolveEarlier: (value: SearchResults) => void = () => {};
    mocked.get
      .mockReturnValueOnce(
        new Promise<SearchResults>((r) => (resolveEarlier = r)),
      )
      .mockResolvedValueOnce(latest);
    const actor = userEvent.setup();
    render(<Harness />);
    const box = screen.getByPlaceholderText("Search WikiHub...");

    await actor.type(box, "ops");
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(1)); // the first is still pending
    await actor.type(box, " runbook");
    expect(
      await screen.findByText("Answer to the latest question"),
    ).toBeInTheDocument();

    // The slow answer to "ops" lands now: it must not replace what is shown.
    await act(async () => resolveEarlier(slowEarlier));
    expect(
      screen.getByText("Answer to the latest question"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Answer to the earlier question")).toBeNull();
  });

  it("clears the query from the clear button", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    const input = screen.getByPlaceholderText("Search WikiHub...");
    await actor.type(input, "ops");
    await screen.findByText("Spaces (2)");
    await actor.click(
      screen.getByRole("button", { name: "Clear search query" }),
    );
    expect(input).toHaveValue("");
    expect(screen.getByText("Quick Search WikiHub")).toBeInTheDocument();
  });

  it("toggles from the global shortcut, unless a local find owns Ctrl+F", async () => {
    render(<Harness initialOpen={false} />);
    expect(screen.getByTestId("state")).toHaveTextContent("closed");

    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    expect(screen.getByTestId("state")).toHaveTextContent("open");
    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    expect(screen.getByTestId("state")).toHaveTextContent("closed");

    // An unrelated key does nothing.
    act(() => {
      fireEvent.keyDown(window, { key: "x" });
    });
    expect(screen.getByTestId("state")).toHaveTextContent("closed");

    // Ctrl+F is no longer a default quick-search chord: it stays the browser's.
    act(() => {
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    });
    expect(screen.getByTestId("state")).toHaveTextContent("closed");

    // A user who binds it themselves still yields to a local find.
    setBindings("search.open", ["Mod+K", "Mod+F"]);
    const release = markLocalFindActive();
    act(() => {
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    });
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
    release();
    act(() => {
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    });
    expect(screen.getByTestId("state")).toHaveTextContent("open");
    resetAllShortcuts();
  });

  it("forgets the query once closed", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    await actor.type(screen.getByPlaceholderText("Search WikiHub..."), "ops");
    await screen.findByText("Spaces (2)");
    await actor.keyboard("{Escape}");
    expect(screen.getByTestId("state")).toHaveTextContent("closed");

    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    expect(screen.getByPlaceholderText("Search WikiHub...")).toHaveValue("");
  });

  it("searches the Help guides for the words after :help instead of the wiki", async () => {
    const actor = userEvent.setup();
    navigate.mockClear();
    render(<Harness />);
    await actor.type(
      screen.getByPlaceholderText("Search WikiHub..."),
      ":help change password",
    );

    expect(await screen.findByText("Help guides", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(mocked.get).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/search"),
    );
    await actor.keyboard("{Enter}");
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/help\/[a-z]+#/));
  });

  it("runs the first command after typing narrows the list, wherever the mouse rested", async () => {
    const actor = userEvent.setup();
    navigate.mockClear();
    render(<Harness user={USER} />);
    const input = screen.getByPlaceholderText("Search WikiHub...");
    await actor.type(input, ":");
    // The pointer rests on a row further down the long list of commands.
    const rows = await screen.findAllByRole("button", { name: /^(Home|Spaces|Recent|Favorites|Saved)/ });
    await actor.hover(rows[3]!);
    await actor.type(input, "help");
    await actor.keyboard("{Enter}");
    expect(navigate).toHaveBeenCalledWith("/help");
  });

  it("shows quick filter options in empty state and inserts prefix on click", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText("Quick filters:")).toBeInTheDocument();

    const spaceChip = screen.getByRole("button", { name: /^space:/ });
    await actor.click(spaceChip);

    const input = screen.getByPlaceholderText("Search WikiHub...");
    expect(input).toHaveValue("space:");
  });

  it("opens with a query from another part of the app", async () => {
    render(<Harness initialOpen={false} />);
    act(() => triggerOpenSearch({ query: "runbook" }));
    expect(screen.getByTestId("state")).toHaveTextContent("open");
    expect(screen.getByPlaceholderText("Search WikiHub...")).toHaveValue("runbook");
  });

  it("inserts AI and Help commands from the empty prompt", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    const input = screen.getByPlaceholderText("Search WikiHub...");
    await actor.click(screen.getByRole("button", { name: /^:ask$/ }));
    expect(input).toHaveValue(":ask ");
    await actor.clear(input);
    await actor.click(screen.getByRole("button", { name: /^:help$/ }));
    expect(input).toHaveValue(":help ");
  });

  it("opens the search shortcuts guide from the empty prompt", async () => {
    const opened = vi.fn();
    window.addEventListener(CHEAT_SHEET_OPEN_EVENT, opened);
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /shortcuts/i }));
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
    expect((opened.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ initialTab: "search" });
    window.removeEventListener(CHEAT_SHEET_OPEN_EVENT, opened);
  });

  it("labels author, type and updated search filters", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    await actor.type(
      screen.getByPlaceholderText("Search WikiHub..."),
      "author:alice type:pdf updated:2026-11-01",
    );
    expect(screen.getByText("Author:")).toBeInTheDocument();
    expect(screen.getByText("File type:")).toBeInTheDocument();
    expect(screen.getByText("Updated:")).toBeInTheDocument();
  });

  it("renders active filter badges when typing filters and allows removing them", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    const input = screen.getByPlaceholderText("Search WikiHub...");
    await actor.type(input, "space:ENG label:runbook deployment");

    expect(screen.getByText("Space:")).toBeInTheDocument();
    expect(screen.getByText("ENG")).toBeInTheDocument();
    expect(screen.getByText("Label:")).toBeInTheDocument();
    expect(screen.getByText("runbook")).toBeInTheDocument();

    // Click remove button on space:ENG badge
    const removeButtons = screen.getAllByRole("button", { name: "Remove filter" });
    await actor.click(removeButtons[0]!);

    expect(input).toHaveValue("label:runbook deployment");
    expect(screen.queryByText("ENG")).not.toBeInTheDocument();
    expect(screen.getByText("runbook")).toBeInTheDocument();
  });
});
