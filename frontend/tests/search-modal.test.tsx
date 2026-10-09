import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SearchModal } from "@/components/layout/search-modal";
import { api } from "@/lib/api-client";
import { markLocalFindActive } from "@/lib/local-find-registry";
import type { SearchResults } from "@/types/api";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@/components/layout/navigation-progress", () => ({
  useNavigate: () => navigate,
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
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

function Harness({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <SearchModal open={open} onOpenChange={setOpen} />
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
    await waitFor(() => expect(screen.getByPlaceholderText("Search WikiHub...")).toHaveFocus());
    expect(mocked.get).not.toHaveBeenCalled();
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
    await actor.type(screen.getByPlaceholderText("Search WikiHub..."), "(really)");
    await screen.findByText("Pages (2)");
    expect(document.querySelector("mark")).toHaveTextContent("(really)");
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
    fireEvent.keyDown(screen.getByPlaceholderText("Search WikiHub..."), { key: "Enter" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows an empty state, and treats a failed search as no results", async () => {
    const actor = userEvent.setup();
    mocked.get.mockResolvedValueOnce({ query: "zzz", spaces: [], pages: [] });
    render(<Harness />);
    const input = screen.getByPlaceholderText("Search WikiHub...");
    await actor.type(input, "zzz");
    expect(await screen.findByText(/No spaces or pages matched/)).toBeInTheDocument();

    mocked.get.mockRejectedValueOnce(new Error("offline"));
    await actor.type(input, "y");
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/No spaces or pages matched/)).toBeInTheDocument();
  });

  it("shows a searching indicator while the request is in flight", async () => {
    let resolve: (value: SearchResults) => void = () => {};
    mocked.get.mockReturnValueOnce(new Promise<SearchResults>((r) => (resolve = r)));
    const actor = userEvent.setup();
    render(<Harness />);
    await actor.type(screen.getByPlaceholderText("Search WikiHub..."), "ops");
    expect(await screen.findByText("Searching WikiHub...")).toBeInTheDocument();
    await act(async () => resolve(RESULTS));
    expect(await screen.findByText("Pages (2)")).toBeInTheDocument();
  });

  it("clears the query from the clear button", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    const input = screen.getByPlaceholderText("Search WikiHub...");
    await actor.type(input, "ops");
    await screen.findByText("Spaces (2)");
    await actor.click(screen.getByRole("button", { name: "Clear search query" }));
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
});
