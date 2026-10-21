import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SpaceGraphDialog } from "@/components/pages/space-graph";
import { api } from "@/lib/api-client";
import type { GraphNode, Space, SpaceGraph } from "@/types/api";

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
const space = { id: "s1", key: "ENG", name: "Engineering" } as Space;

function node(
  id: string,
  title: string,
  extra: Partial<GraphNode> = {},
): GraphNode {
  return {
    id,
    title,
    slug: title.toLowerCase().replace(/ /g, "-"),
    parent_id: null,
    branch_id: id,
    community: 0,
    degree: 1,
    excerpt: "",
    space_key: "ENG",
    space_name: "Engineering",
    ...extra,
  };
}

const graph: SpaceGraph = {
  spaces: [{ key: "ENG", name: "Engineering", pages: 4 }],
  nodes: [
    node("a", "Deploy guide", {
      degree: 2,
      excerpt: "Ship it with the release script.",
    }),
    node("b", "Rollback steps", { degree: 1 }),
    node("c", "Operations", { degree: 1, community: 1 }),
    node("d", "Lonely notes", { degree: 0, community: 2 }),
  ],
  edges: [
    { source: "a", target: "b", kind: "mention", weight: 1 },
    { source: "c", target: "a", kind: "tree", weight: 1 },
  ],
  total_pages: 4,
  insights: {
    orphans: ["d"],
    bridges: [],
    sparse_groups: [{ community: 0, size: 5 }],
  },
};

function open() {
  render(<SpaceGraphDialog space={space} open onOpenChange={() => {}} />);
}

function pageList() {
  return screen.getByText(/Pages on the map/).closest("details")!;
}

describe("SpaceGraphDialog", () => {
  beforeEach(() => {
    mocked.get.mockReset();
  });

  it("draws every page and names it in a list for keyboards and screen readers", async () => {
    mocked.get.mockResolvedValue(graph);
    open();

    expect(
      await screen.findByRole("img", { name: /Map of 4 pages/ }),
    ).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/spaces/ENG/graph");
    await userEvent.click(screen.getByText(/Pages on the map/));
    for (const title of [
      "Deploy guide",
      "Rollback steps",
      "Operations",
      "Lonely notes",
    ]) {
      expect(
        within(pageList()).getByRole("button", { name: title }),
      ).toBeInTheDocument();
    }
  });

  it("shows insights until a page is picked, then that page and its ties", async () => {
    mocked.get.mockResolvedValue(graph);
    open();

    const orphans = (await screen.findByText("Pages tied to nothing")).closest(
      "section",
    )!;
    await userEvent.click(
      within(orphans).getByRole("button", { name: "Lonely notes" }),
    );
    expect(screen.getByRole("link", { name: /Open page/ })).toHaveAttribute(
      "href",
      "/spaces/ENG/pages/lonely-notes",
    );

    await userEvent.click(screen.getByText(/Pages on the map/));
    await userEvent.click(
      within(pageList()).getByRole("button", { name: "Deploy guide" }),
    );
    expect(
      screen.getByRole("heading", { name: "Deploy guide" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 ties")).toBeInTheDocument();
    expect(
      screen.getByText("Ship it with the release script."),
    ).toBeInTheDocument();
  });

  it("singles out a loosely tied group from the insights", async () => {
    mocked.get.mockResolvedValue(graph);
    open();

    const sparse = (await screen.findByText("Loosely tied groups")).closest(
      "section",
    )!;
    await userEvent.click(
      within(sparse).getByRole("button", { name: "Group 1 (5 pages)" }),
    );

    const legend = screen.getByText("Legend").parentElement!;
    expect(
      within(legend).getByRole("button", { name: /Group 1/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Group" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("finds pages by name, case aside", async () => {
    mocked.get.mockResolvedValue(graph);
    open();
    await screen.findByRole("img");
    const search = screen.getByRole("textbox", {
      name: "Find a page on the map",
    });

    await userEvent.type(search, "ROLLBACK");
    expect(
      screen.getAllByRole("button", { name: "Rollback steps" }).length,
    ).toBeGreaterThan(0);
    await userEvent.clear(search);
    await userEvent.type(search, "zzz");
    expect(screen.getByText("No page on the map matches.")).toBeInTheDocument();
  });

  it("toggles kinds of tie and colouring, saying which is on", async () => {
    mocked.get.mockResolvedValue(graph);
    open();
    await screen.findByRole("img");

    const tree = screen.getByRole("button", { name: "Page tree" });
    expect(tree).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(tree);
    expect(tree).toHaveAttribute("aria-pressed", "false");

    const branch = screen.getByRole("button", { name: "Branch" });
    await userEvent.click(branch);
    expect(branch).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /Under Deploy guide/ }),
    ).toBeInTheDocument();
  });

  it("names every group in the legend and can single one out", async () => {
    mocked.get.mockResolvedValue(graph);
    open();
    await screen.findByRole("img");

    const legend = screen.getByText("Legend").parentElement!;
    const group = within(legend).getByRole("button", { name: /Group 1/ });
    await userEvent.click(group);
    expect(group).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(
      within(legend).getByRole("button", { name: "Show all" }),
    );
    expect(group).toHaveAttribute("aria-pressed", "false");
  });

  it("explains an empty map", async () => {
    mocked.get.mockResolvedValue({ ...graph, edges: [] });
    open();
    expect(await screen.findByText("No ties to draw yet")).toBeInTheDocument();
  });

  it("offers to try again when the map cannot load", async () => {
    mocked.get
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(graph);
    open();

    await userEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: /Map of 4 pages/ }),
      ).toBeInTheDocument(),
    );
  });

  it("says when only part of a large space is drawn", async () => {
    mocked.get.mockResolvedValue({ ...graph, total_pages: 900 });
    open();
    expect(
      await screen.findByText("Showing the 4 best-connected of 900 pages."),
    ).toBeInTheDocument();
  });

  it("switches to every space, coloured by space, with pages opening in their own space", async () => {
    const across: SpaceGraph = {
      spaces: [
        { key: "ENG", name: "Engineering", pages: 1 },
        { key: "OPS", name: "Operations", pages: 1 },
      ],
      nodes: [
        node("a", "Deploy guide", { degree: 1 }),
        node("p", "Prometheus guide", {
          degree: 1,
          space_key: "OPS",
          space_name: "Operations",
        }),
      ],
      edges: [{ source: "a", target: "p", kind: "similar", weight: 0.86 }],
      total_pages: 2,
      insights: { orphans: [], bridges: [], sparse_groups: [] },
    };
    mocked.get.mockImplementation(async (url: string) =>
      url === "/api/v1/graph" ? across : graph,
    );
    open();
    await screen.findByRole("img", { name: /Map of 4 pages/ });
    expect(
      screen.queryByRole("button", { name: "Space" }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "All spaces" }));

    expect(
      await screen.findByRole("img", { name: /Map of 2 pages/ }),
    ).toBeInTheDocument();
    expect(mocked.get).toHaveBeenLastCalledWith("/api/v1/graph");
    expect(screen.getByRole("button", { name: "Space" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const legend = screen.getByText("Legend").parentElement!;
    expect(
      within(legend).getByRole("button", { name: /Operations/ }),
    ).toBeInTheDocument();
    expect(
      within(legend).getByRole("button", { name: /Engineering/ }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByText(/Pages on the map/));
    await userEvent.click(
      within(pageList()).getByRole("button", { name: "Prometheus guide" }),
    );
    expect(screen.getByRole("link", { name: /Open page/ })).toHaveAttribute(
      "href",
      "/spaces/OPS/pages/prometheus-guide",
    );
    expect(screen.getByText(/Operations ·/)).toBeInTheDocument();

    // Searching across spaces finds pages by their space's name too.
    await userEvent.type(
      screen.getByRole("textbox", { name: "Find a page on the map" }),
      "operat",
    );
    expect(
      screen.getAllByRole("button", { name: "Prometheus guide" }).length,
    ).toBeGreaterThan(0);
  });

  it("opens on every space when no space is given", async () => {
    mocked.get.mockResolvedValue(graph);
    render(<SpaceGraphDialog open onOpenChange={() => {}} />);

    expect(await screen.findByRole("img")).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/graph");
    expect(screen.getByText("Page map - all spaces")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "This space" }),
    ).not.toBeInTheDocument();
  });
});
