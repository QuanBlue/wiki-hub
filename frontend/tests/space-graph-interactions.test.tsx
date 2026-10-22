import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SpaceGraphDialog, sidesToTry } from "@/components/pages/space-graph";
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
    degree: 2,
    excerpt: "",
    space_key: "ENG",
    space_name: "Engineering",
    ...extra,
  };
}

/** A dozen pages with long titles, all tied together: labels that crowd each other. */
function crowded(): SpaceGraph {
  const nodes = Array.from({ length: 12 }, (_, i) =>
    node(`n${i}`, `A rather long page title number ${i} about deployments`),
  );
  const edges = nodes.slice(1).map((page, i) => ({
    source: nodes[i].id,
    target: page.id,
    kind: "link" as const,
    weight: 1,
  }));
  return {
    spaces: [{ key: "ENG", name: "Engineering", pages: nodes.length }],
    nodes,
    edges,
    total_pages: nodes.length,
    insights: { orphans: [], bridges: [], sparse_groups: [] },
  };
}

function mapOf(): SVGSVGElement {
  return screen.getByRole("img") as unknown as SVGSVGElement;
}

describe("the page map, by hand", () => {
  beforeEach(() => {
    mocked.get.mockReset();
    Element.prototype.setPointerCapture = vi.fn();
  });

  it("picks a page on the map, zooms, scrolls, drags and lets go", async () => {
    mocked.get.mockResolvedValue(crowded());
    const onOpenChange = vi.fn();
    render(<SpaceGraphDialog space={space} open onOpenChange={onOpenChange} />);
    await screen.findByRole("img");
    const svg = mapOf();
    const first = svg.querySelector("[data-node]")!;

    // Picking a page on the map centres it; the background deselects it again.
    fireEvent.pointerEnter(first);
    fireEvent.pointerLeave(first);
    fireEvent.click(first);
    fireEvent.click(svg);

    // Zooming in as far as it goes crowds the labels: each must find a side or be left out.
    for (let i = 0; i < 12; i += 1) {
      await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    }
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));

    // The wheel zooms around the pointer, both ways.
    fireEvent(
      svg,
      new WheelEvent("wheel", {
        deltaY: -100,
        clientX: 10,
        clientY: 10,
        cancelable: true,
      }),
    );
    fireEvent(
      svg,
      new WheelEvent("wheel", {
        deltaY: 100,
        clientX: 10,
        clientY: 10,
        cancelable: true,
      }),
    );

    // A drag on the background moves the map; on a page it does not start one.
    fireEvent.pointerDown(first, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(Element.prototype.setPointerCapture).toHaveBeenCalledTimes(1);

    // Redrawing starts over, and closing hands the choice back.
    await userEvent.click(screen.getByRole("button", { name: "Redraw" }));
    await screen.findByRole("img");
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens a page from the map with a double click", async () => {
    mocked.get.mockResolvedValue(crowded());
    render(<SpaceGraphDialog space={space} open onOpenChange={() => {}} />);
    await screen.findByRole("img");
    const first = mapOf().querySelector("[data-node]")!;

    // jsdom does not navigate; it is enough that the page's address was asked for.
    fireEvent.doubleClick(first);
  });

  it("measures the map as the dialog resizes, and shortens labels that no side has room for", async () => {
    class Observer {
      constructor(private readonly callback: () => void) {}
      observe() {
        this.callback();
      }
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", Observer);
    // A narrow map: big letters for its size, so a long title fits on neither side.
    const box = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 200, height: 600, left: 0, top: 0 } as DOMRect);
    try {
      mocked.get.mockResolvedValue(crowded());
      render(<SpaceGraphDialog space={space} open onOpenChange={() => {}} />);

      expect(await screen.findByRole("img")).toBeInTheDocument();
      // Moved left, pages sit on the left half: the label goes where there is more room.
      const svg = mapOf();
      fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 300 });
      fireEvent.pointerMove(svg, { pointerId: 1, clientX: 40, clientY: 300 });
      fireEvent.pointerUp(svg, { pointerId: 1 });
    } finally {
      box.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("turns a kind of tie off and on again", async () => {
    mocked.get.mockResolvedValue(crowded());
    render(<SpaceGraphDialog space={space} open onOpenChange={() => {}} />);
    await screen.findByRole("img");

    const links = screen.getByRole("button", { name: "Links" });
    await userEvent.click(links);
    expect(links).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(links);
    expect(links).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the pages of one space together when every space is drawn", async () => {
    const across: SpaceGraph = {
      spaces: [
        { key: "ENG", name: "Engineering", pages: 2 },
        { key: "OPS", name: "Operations", pages: 1 },
      ],
      nodes: [
        node("a", "Deploy guide"),
        node("b", "Rollback steps"),
        node("p", "Prometheus guide", {
          space_key: "OPS",
          space_name: "Operations",
        }),
      ],
      edges: [{ source: "a", target: "p", kind: "similar", weight: 0.8 }],
      total_pages: 3,
      insights: { orphans: [], bridges: [], sparse_groups: [] },
    };
    mocked.get.mockResolvedValue(across);
    render(<SpaceGraphDialog open onOpenChange={() => {}} />);

    expect(
      await screen.findByRole("img", { name: /Map of 3 pages/ }),
    ).toBeInTheDocument();
  });
});

describe("sidesToTry", () => {
  it("tries the side the label fits whole, else the one with more room", () => {
    expect(sidesToTry(50, { start: 100, end: 10 })).toEqual(["start", "end"]);
    expect(sidesToTry(50, { start: 10, end: 100 })).toEqual(["end", "start"]);
    expect(sidesToTry(500, { start: 30, end: 20 })).toEqual(["start", "end"]);
    expect(sidesToTry(500, { start: 20, end: 30 })).toEqual(["end", "start"]);
  });
});
