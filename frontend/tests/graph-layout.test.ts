import { describe, expect, it } from "vitest";

import { layoutGraph } from "@/lib/graph-layout";

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("layoutGraph", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const edges = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "a", target: "c" },
    { source: "d", target: "e" },
  ];

  it("places every page inside the box", () => {
    const points = layoutGraph(ids, edges, { size: 1000 });
    expect(Object.keys(points).sort()).toEqual(ids);
    for (const point of Object.values(points)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1000);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1000);
    }
  });

  it("gives the same picture every time", () => {
    expect(layoutGraph(ids, edges)).toEqual(layoutGraph(ids, edges));
  });

  it("draws tied pages closer than untied ones", () => {
    const points = layoutGraph(ids, edges);
    expect(distance(points.a, points.b)).toBeLessThan(
      distance(points.a, points.e),
    );
    expect(distance(points.d, points.e)).toBeLessThan(
      distance(points.d, points.b),
    );
  });

  it("handles no pages, one page, and ties to unknown pages", () => {
    expect(layoutGraph([], [])).toEqual({});
    expect(layoutGraph(["x"], [], { size: 100 })).toEqual({
      x: { x: 50, y: 50 },
    });
    expect(
      Object.keys(layoutGraph(["x", "y"], [{ source: "x", target: "zz" }])),
    ).toHaveLength(2);
  });
});

describe("apart", () => {
  it("measures two pages apart, and nudges two on one spot apart the same way each time", async () => {
    const { apart } = await import("@/lib/graph-layout");
    expect(apart(0, 1, 3, 4)).toEqual([3, 4, 5]);
    const [dx, dy, dist] = apart(3, 2, 0, 0);
    // (3 % 7) - 3 and (2 % 5) - 2 are 0: the nudge still has a direction.
    expect([dx, dy]).toEqual([0.01, 0.01]);
    expect(dist).toBeCloseTo(Math.hypot(0.01, 0.01));
    expect(apart(5, 4, 0.001, 0)).toEqual(apart(5, 4, 0.001, 0));
    expect(apart(5, 4, 0.001, 0)[0]).toBeCloseTo(0.02);
  });
});
