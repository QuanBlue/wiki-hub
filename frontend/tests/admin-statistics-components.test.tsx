import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { BarList } from "@/components/admin/statistics/bar-list";
import { MultiTrendChart } from "@/components/admin/statistics/multi-trend-chart";
import { StackedBarChart } from "@/components/admin/statistics/stacked-bar-chart";
import { StatisticsView } from "@/components/admin/statistics/statistics-view";
import { TopTable } from "@/components/admin/statistics/top-table";
import {
  TrendChart,
  halfDelta,
  niceMax,
} from "@/components/admin/statistics/trend-chart";
import { buildCsv, percentDelta } from "@/lib/admin-stats-client";
import type {
  StatsAi,
  StatsOverview,
  StatsTopContent,
  StatsTopContributors,
} from "@/types/api";

const days = ["2026-10-12", "2026-10-13", "2026-10-14"];

describe("niceMax", () => {
  it.each([
    [0, 1],
    [1, 1],
    [1.5, 2],
    [3, 5],
    [7, 10],
    [130, 200],
  ])("rounds %s up to %s", (value, expected) => {
    expect(niceMax(value)).toBe(expected);
  });
});

describe("percentDelta & buildCsv", () => {
  it("computes real period-over-period percentages", () => {
    expect(percentDelta(150, 100)).toBe(50);
    expect(percentDelta(50, 100)).toBe(-50);
    expect(percentDelta(100, 100)).toBe(0);
    expect(percentDelta(10, 0)).toBeNull();
    expect(percentDelta(10, undefined)).toBeNull();
  });

  it("prefixes UTF-8 BOM and escapes commas and quotes", () => {
    const csv = buildCsv(
      ["Title", "Count"],
      [
        ['Hello, "Wiki"', 42],
        ["Plain", null],
      ],
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Hello, ""Wiki""",42');
    expect(csv).toContain("Plain,");
  });
});

describe("TrendChart", () => {
  const points = days.map((day, i) => ({ day, value: i * 10 }));

  it("puts the total in the accessible name", () => {
    render(<TrendChart title="Views" points={points} />);
    expect(
      screen.getByRole("group", { name: /Views\. 30 in total/ }),
    ).toBeInTheDocument();
  });

  it("reads a day with the arrow keys and clears with Escape", () => {
    render(<TrendChart title="Views" points={points} />);
    const chart = screen.getByRole("group");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByText("Oct 12: 0")).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByText("Oct 14: 20")).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByText("Oct 13: 10")).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByText("Oct 13: 10")).not.toBeInTheDocument();
  });

  it("follows the pointer and lets go on leave and blur", () => {
    render(<TrendChart title="Views" points={points} tone="info" />);
    fireEvent.mouseEnter(screen.getAllByTestId("trend-hit")[1]);
    expect(screen.getByText("Oct 13: 10")).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByRole("group"));
    expect(screen.queryByText("Oct 13: 10")).not.toBeInTheDocument();
  });
});

describe("MultiTrendChart", () => {
  it("toggles series and keeps at least one active", async () => {
    const user = userEvent.setup();
    render(
      <MultiTrendChart
        title="Activity"
        initialActiveKeys={["views"]}
        series={[
          {
            key: "views",
            label: "Views",
            tone: "primary",
            points: days.map((day, i) => ({ day, value: (i + 1) * 5 })),
          },
          {
            key: "edits",
            label: "Edits",
            tone: "warning",
            points: days.map((day, i) => ({ day, value: i + 1 })),
          },
        ]}
      />,
    );
    const viewsBtn = screen.getByRole("button", { name: "Views" });
    const editsBtn = screen.getByRole("button", { name: "Edits" });
    expect(viewsBtn).toHaveAttribute("aria-pressed", "true");
    expect(editsBtn).toHaveAttribute("aria-pressed", "false");

    // Cannot deselect the last active series
    await user.click(viewsBtn);
    expect(viewsBtn).toHaveAttribute("aria-pressed", "true");

    // Enable Edits, then hover to see both values in tooltip
    await user.click(editsBtn);
    expect(editsBtn).toHaveAttribute("aria-pressed", "true");
    fireEvent.mouseEnter(screen.getAllByTestId("multi-trend-hit")[1]);
    expect(screen.getByRole("status")).toHaveTextContent("Oct 13");
  });
});

describe("StackedBarChart", () => {
  it("renders prompt and completion totals and responds to keyboard", () => {
    render(
      <StackedBarChart
        title="Tokens per day"
        primaryLabel="Prompt tokens"
        secondaryLabel="Completion tokens"
        points={[
          { day: "2026-10-12", primary: 80, secondary: 20 },
          { day: "2026-10-13", primary: 120, secondary: 30 },
        ]}
      />,
    );
    expect(
      screen.getByRole("group", { name: /Tokens per day\. 250 in total/ }),
    ).toBeInTheDocument();
    const chart = screen.getByRole("group");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent("Oct 12");
    expect(screen.getByRole("status")).toHaveTextContent("80");
    expect(screen.getByRole("status")).toHaveTextContent("20");
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("BarList", () => {
  it("shows the empty text without rows", () => {
    render(
      <BarList title="T" rows={[]} format={String} emptyLabel="nothing" />,
    );
    expect(screen.getByText("nothing")).toBeInTheDocument();
  });

  it("prints every value next to its bar", () => {
    render(
      <BarList
        title="T"
        tone="info"
        format={(v) => `${v} tok`}
        emptyLabel="nothing"
        rows={[
          {
            key: "a",
            label: "Ann",
            hint: "@ann",
            value: 100,
            detail: "· 2 req",
          },
          { key: "b", label: "Bob", value: 0 },
        ]}
      />,
    );
    expect(screen.getByText("100 tok")).toBeInTheDocument();
    expect(screen.getByText("@ann")).toBeInTheDocument();
    expect(screen.getByText("· 2 req")).toBeInTheDocument();
    expect(screen.getByText("0 tok")).toBeInTheDocument();
  });
});

function top(
  sort: string,
  titles: string[],
  saves: number | null = 1,
): StatsTopContent {
  return {
    range_days: 30,
    sort,
    items: titles.map((title, i) => ({
      id: `${sort}-${i}`,
      title,
      slug: title.toLowerCase(),
      space_key: "ENG",
      space_name: "Engineering",
      views: 10 - i,
      stars: 3,
      saves,
      page_count: saves === null ? 12 : null,
    })),
  };
}

describe("TopTable", () => {
  it("links pages, filters by search, and switches ranking without reloading", async () => {
    const user = userEvent.setup();
    render(
      <TopTable
        kind="page"
        searchable
        rankings={{
          views: top("views", ["Alpha", "Gamma"]),
          stars: top("stars", ["Beta"]),
          saves: top("saves", [], 0),
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute(
      "href",
      "/spaces/ENG/pages/alpha",
    );
    await user.type(screen.getByRole("searchbox"), "gam");
    expect(screen.queryByRole("link", { name: "Alpha" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gamma" })).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox"));

    await user.click(screen.getByRole("button", { name: "Stars" }));
    expect(screen.getByRole("link", { name: "Beta" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Saves" }));
    expect(
      screen.getByText("Nothing to show for this period."),
    ).toBeInTheDocument();
  });

  it("omits page-only columns for spaces and shows page_count", () => {
    render(
      <TopTable
        kind="space"
        rankings={{ views: top("views", ["Core"], null) }}
      />,
    );
    expect(screen.getByRole("link", { name: "Core" })).toHaveAttribute(
      "href",
      "/spaces/ENG",
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Saves" }),
    ).not.toBeInTheDocument();
  });
});

const overview: StatsOverview = {
  range_days: 3,
  start_date: "2026-10-12",
  end_date: "2026-10-14",
  totals: {
    users: 5,
    new_users: 1,
    active_users: 2,
    spaces: 3,
    new_spaces: 1,
    pages: 9,
    new_pages: 4,
    edits: 4,
    views: 7,
    daily_active_users: 1.7,
    active_seconds: 754,
  },
  previous: {
    new_users: 1,
    active_users: 1,
    new_spaces: 0,
    new_pages: 2,
    edits: 2,
    views: 7,
    daily_active_users: 1.0,
    active_seconds: 600,
  },
  daily: days.map((day, i) => ({
    day,
    edits: i,
    views: i * 2,
    new_users: 0,
    active_users: i,
    active_seconds: [0, 30, 4500][i],
  })),
  recent_activity: [
    {
      id: "1",
      created_at: "2026-10-14T09:00:00Z",
      actor_username: "ann",
      action: "page_created",
      entity_type: "page",
      entity_label: "Roadmap",
    },
    {
      id: "2",
      created_at: "2026-10-14T10:00:00Z",
      actor_username: "bob",
      action: "space_created",
      entity_type: "space",
      entity_label: "Design",
    },
  ],
  views_tracked_since: "2026-10-10",
  activity_tracked_since: "2026-10-12",
};

const ai: StatsAi = {
  range_days: 3,
  start_date: "2026-10-12",
  end_date: "2026-10-14",
  totals: {
    tokens: 150,
    prompt_tokens: 120,
    completion_tokens: 30,
    calls: 2,
    users: 1,
  },
  previous: {
    tokens: 100,
    prompt_tokens: 80,
    completion_tokens: 20,
    calls: 2,
    users: 1,
  },
  daily: days.map((day) => ({
    day,
    tokens: 50,
    prompt_tokens: 40,
    completion_tokens: 10,
    calls: 1,
  })),
  by_user: [
    {
      user_id: "u1",
      username: "ann",
      full_name: "Ann Lee",
      tokens: 150,
      calls: 2,
    },
    { user_id: null, username: "", full_name: null, tokens: 5, calls: 1 },
  ],
  by_feature: [
    { feature: "summarize", tokens: 100, calls: 1 },
    { feature: "mystery", tokens: 50, calls: 1 },
  ],
  by_model: [{ model: "gpt-4o-mini", tokens: 150, calls: 2 }],
  tracked_since: "2026-10-10T00:00:00Z",
};

const contributors: StatsTopContributors = {
  range_days: 3,
  items: [
    {
      user_id: "u1",
      username: "ann",
      full_name: "Ann Lee",
      edits: 6,
      pages_created: 2,
    },
  ],
};

function view(
  over: Partial<{
    overview: StatsOverview;
    ai: StatsAi;
    contributors: StatsTopContributors;
  }> = {},
) {
  return (
    <StatisticsView
      range="30d"
      overview={over.overview ?? overview}
      ai={over.ai ?? ai}
      pages={{ views: top("views", ["Alpha"]) }}
      spaces={{ views: top("views", ["Core"], null) }}
      contributors={over.contributors ?? contributors}
    />
  );
}

describe("StatisticsView", () => {
  it("shows hero KPIs, activity filter, and tracking note on Overview", async () => {
    const user = userEvent.setup();
    render(view());
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText(/counted from Oct 10, 2026/)).toBeInTheDocument();
    expect(
      screen.getByText(/active time are counted from Oct 12, 2026/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Filter recent activity by action
    await user.click(screen.getByRole("button", { name: "page created" }));
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(screen.queryByText("Design")).not.toBeInTheDocument();
  });

  it("opens the consolidated Content tab with pages, spaces, and contributors", async () => {
    const user = userEvent.setup();
    render(view());
    await user.click(screen.getByRole("tab", { name: "Content" }));
    expect(screen.getByRole("link", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Core" })).toBeInTheDocument();
    expect(screen.getByText("Ann Lee")).toBeInTheDocument();
    expect(screen.getByText("6 edits")).toBeInTheDocument();
  });

  it("breaks AI usage down by person, feature, and model", async () => {
    const user = userEvent.setup();
    render(view());
    await user.click(screen.getByRole("tab", { name: "AI usage" }));
    expect(screen.getByText("Ann Lee")).toBeInTheDocument();
    expect(screen.getByText("@ann")).toBeInTheDocument();
    expect(screen.getByText("Page summary (TL;DR)")).toBeInTheDocument();
    expect(screen.getByText("mystery")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.getByText(/Token usage is counted from Oct 10, 2026/),
    ).toBeInTheDocument();
  });

  it("explains empty states", () => {
    render(
      view({
        overview: {
          ...overview,
          recent_activity: [],
          views_tracked_since: null,
          activity_tracked_since: null,
        },
      }),
    );
    expect(screen.getByText("No activity recorded yet.")).toBeInTheDocument();
    expect(
      screen.getByText(/No activity has been recorded yet\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No page views have been recorded yet\./),
    ).toBeInTheDocument();
  });

  it("reads durations under a minute, whole hours, and zero", () => {
    const { rerender } = render(
      view({
        overview: {
          ...overview,
          totals: { ...overview.totals, active_seconds: 20 },
        },
      }),
    );
    expect(screen.getAllByText("< 1 min").length).toBeGreaterThan(0);
    rerender(
      view({
        overview: {
          ...overview,
          totals: { ...overview.totals, active_seconds: 7200 },
        },
      }),
    );
    expect(screen.getAllByText("2 h").length).toBeGreaterThan(0);
    rerender(
      view({
        overview: {
          ...overview,
          totals: { ...overview.totals, active_seconds: 0 },
        },
      }),
    );
    expect(screen.getAllByText("0 min").length).toBeGreaterThan(0);
  });
});

describe("halfDelta", () => {
  it.each([
    [[1, 1, 2, 2], 100],
    [[4, 4, 2, 2], -50],
    [[3, 3, 3, 3], 0],
    [[0, 0, 5, 5], null],
    [[7], null],
  ])("reads %j as %s", (values, expected) => {
    expect(halfDelta(values)).toBe(expected);
  });
});
