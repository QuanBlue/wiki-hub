import { describe, expect, it } from "vitest";

import {
  NAMED_SLICES,
  assignSlots,
  buildUsage,
  ringArc,
} from "@/lib/monitor-usage";

const labels = {
  systemLabel: "System",
  freeLabel: "Free",
  othersLabel: (count: number) => `${count} others`,
};

const item = (name: string, value: number) => ({
  key: name,
  label: name,
  value,
});

describe("buildUsage", () => {
  it("adds up to the whole: containers, the system's own use, and what is free", () => {
    const chart = buildUsage({
      items: [item("db", 400), item("api", 100)],
      total: 1000,
      hostUsed: 700,
      ...labels,
    });

    expect(chart.slices.map((s) => [s.label, s.value, s.kind])).toEqual([
      ["db", 400, "container"],
      ["api", 100, "container"],
      ["System", 200, "system"],
      ["Free", 300, "free"],
    ]);
    expect(chart.slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
    expect(chart.used).toBe(500);
    expect(chart.total).toBe(1000);
  });

  it("has no system slice without a host figure: the rest is free", () => {
    const chart = buildUsage({
      items: [item("api", 150)],
      total: 1200,
      ...labels,
    });
    expect(chart.slices.map((s) => s.kind)).toEqual(["container", "free"]);
    expect(chart.slices[1].value).toBe(1050);
  });

  it("folds everything past the biggest few into one slice", () => {
    const many = Array.from({ length: NAMED_SLICES + 3 }, (_, i) =>
      item(`c${i}`, 100 - i),
    );
    const chart = buildUsage({ items: many, total: 2000, ...labels });

    const named = chart.slices.filter((s) => s.kind === "container");
    expect(named).toHaveLength(NAMED_SLICES);
    const others = chart.slices.find((s) => s.kind === "others")!;
    expect(others.label).toBe("3 others");
    expect(others.count).toBe(3);
    expect(others.slot).toBeNull();
    // The biggest are the named ones.
    expect(named.map((s) => s.label)).toEqual([
      "c0",
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
    ]);
  });

  it("leaves out containers that use nothing, or report nothing", () => {
    const chart = buildUsage({
      items: [item("idle", 0), item("api", 10), item("odd", Number.NaN)],
      total: 100,
      ...labels,
    });
    expect(chart.slices.filter((s) => s.kind === "container")).toHaveLength(1);
  });

  it("stays within its whole when the containers add up to more than the host says", () => {
    const chart = buildUsage({
      items: [item("a", 700), item("b", 600)],
      total: 1000,
      hostUsed: 900,
      ...labels,
    });
    expect(chart.total).toBe(1300);
    expect(chart.slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
    expect(chart.slices.some((s) => s.kind === "free")).toBe(false);
  });

  it("copes with nothing running", () => {
    const chart = buildUsage({ items: [], total: 1000, ...labels });
    expect(chart.slices.map((s) => s.kind)).toEqual(["free"]);
  });
});

describe("assignSlots", () => {
  it("colours by alphabetical place, so a container keeps its colour as it overtakes others", () => {
    const first = assignSlots([
      { key: "1", label: "worker" },
      { key: "2", label: "backend" },
      { key: "3", label: "redis" },
    ]);
    // Order of arrival, or of size, changes nothing.
    const again = assignSlots([
      { key: "3", label: "redis" },
      { key: "2", label: "backend" },
      { key: "1", label: "worker" },
    ]);
    expect(first).toEqual({ "2": 0, "3": 1, "1": 2 });
    expect(again).toEqual(first);
  });

  it("gives the chart's named slices distinct slots", () => {
    const chart = buildUsage({
      items: Array.from({ length: 6 }, (_, i) => item(`c${i}`, 10 + i)),
      total: 100,
      ...labels,
    });
    const slots = chart.slices
      .filter((s) => s.kind === "container")
      .map((s) => s.slot);
    expect(new Set(slots).size).toBe(6);
  });
});

describe("ringArc", () => {
  it("starts at 12 o'clock and runs clockwise", () => {
    expect(ringArc(10, 0, 0.25, 50)).toBe(
      "M 50.000 40.000 A 10 10 0 0 1 60.000 50.000",
    );
  });

  it("marks an arc of more than half a turn as large", () => {
    expect(ringArc(10, 0, 0.75, 50)).toContain("A 10 10 0 1 1");
  });
});
