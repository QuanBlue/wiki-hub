import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { BarList } from "@/components/admin/statistics/bar-list";
import { StatisticsView } from "@/components/admin/statistics/statistics-view";
import { TopTable } from "@/components/admin/statistics/top-table";
import {
  TrendChart,
  halfDelta,
  niceMax,
} from "@/components/admin/statistics/trend-chart";
import type { StatsAi, StatsOverview, StatsTopContent } from "@/types/api";

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
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByText("Oct 14: 20")).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: "a" });
  });

  it("follows the pointer and lets go on leave and blur", () => {
    render(<TrendChart title="Views" points={points} tone="info" />);
    fireEvent.mouseEnter(screen.getAllByTestId("trend-hit")[1]);
    expect(screen.getByText("Oct 13: 10")).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByRole("group"));
    expect(screen.queryByText("Oct 13: 10")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("group"), { key: "ArrowRight" });
    fireEvent.blur(screen.getByRole("group"));
    expect(screen.queryByText("Oct 12: 0")).not.toBeInTheDocument();
  });

  it("copes with no data and a single day", () => {
    const { rerender } = render(
      <TrendChart title="Empty" points={[]} tone="success" />,
    );
    fireEvent.keyDown(screen.getByRole("group"), { key: "ArrowRight" });
    rerender(
      <TrendChart
        title="One"
        tone="warning"
        points={[{ day: days[0], value: 4 }]}
      />,
    );
    fireEvent.keyDown(screen.getByRole("group"), { key: "ArrowRight" });
    expect(screen.getByText("Oct 12: 4")).toBeInTheDocument();
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
    })),
  };
}

describe("TopTable", () => {
  it("links pages and switches ranking without reloading", async () => {
    const user = userEvent.setup();
    render(
      <TopTable
        kind="page"
        rankings={{
          views: top("views", ["Alpha"]),
          stars: top("stars", ["Beta"]),
          saves: top("saves", [], 0),
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute(
      "href",
      "/spaces/ENG/pages/alpha",
    );
    await user.click(screen.getByRole("button", { name: "Stars" }));
    expect(screen.getByRole("link", { name: "Beta" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Saves" }));
    expect(
      screen.getByText("Nothing to show for this period."),
    ).toBeInTheDocument();
  });

  it("omits page-only columns for spaces", () => {
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
    expect(
      screen.queryByRole("columnheader", { name: "Saves" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Saves" }),
    ).not.toBeInTheDocument();
  });

  it("counts a missing save total as zero", () => {
    render(
      <TopTable
        kind="page"
        rankings={{ views: top("views", ["Gamma"], null) }}
      />,
    );
    expect(
      screen.getByText("0", { selector: "td:last-child" }),
    ).toBeInTheDocument();
  });
});

const overview: StatsOverview = {
  range_days: 3,
  totals: {
    users: 5,
    new_users: 1,
    active_users: 2,
    spaces: 3,
    pages: 9,
    edits: 4,
    views: 7,
    daily_active_users: 1.7,
    active_seconds: 754,
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
  ],
  views_tracked_since: "2026-10-10",
  activity_tracked_since: "2026-10-12",
};
const ai: StatsAi = {
  range_days: 3,
  totals: {
    tokens: 150,
    prompt_tokens: 120,
    completion_tokens: 30,
    calls: 2,
    users: 1,
  },
  daily: days.map((day) => ({ day, tokens: 50, calls: 1 })),
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
  tracked_since: "2026-10-10T00:00:00Z",
};

function view(over: Partial<{ overview: StatsOverview; ai: StatsAi }> = {}) {
  return (
    <StatisticsView
      range="30d"
      overview={over.overview ?? overview}
      ai={over.ai ?? ai}
      pages={{ views: top("views", ["Alpha"]) }}
      spaces={{ views: top("views", ["Core"], null) }}
    />
  );
}

describe("StatisticsView", () => {
  it("shows headline numbers, activity and the tracking note", () => {
    render(view());
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByText("page created")).toBeInTheDocument();
    expect(screen.getByText(/counted from Oct 10, 2026/)).toBeInTheDocument();
    expect(
      screen.getByText(/active time are counted from Oct 12, 2026/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "30 days" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: "7 days" })).toHaveAttribute(
      "href",
      "/admin/statistics?range=7d",
    );
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

  it("breaks AI usage down by person and feature", async () => {
    const user = userEvent.setup();
    render(view());
    await user.click(screen.getByRole("tab", { name: "AI usage" }));
    expect(screen.getByText("Ann Lee")).toBeInTheDocument();
    expect(screen.getByText("@ann")).toBeInTheDocument();
    expect(screen.getByText("Page summary (TL;DR)")).toBeInTheDocument();
    expect(screen.getByText("mystery")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.getByText(/Token usage is counted from Oct 10, 2026/),
    ).toBeInTheDocument();
  });

  it("says so when no AI was used", async () => {
    const user = userEvent.setup();
    render(
      view({
        ai: {
          ...ai,
          totals: { ...ai.totals, calls: 0, tokens: 0 },
          by_user: [],
          by_feature: [],
          tracked_since: null,
        },
      }),
    );
    await user.click(screen.getByRole("tab", { name: "AI usage" }));
    expect(
      screen.getAllByText("No AI usage has been recorded in this period.")
        .length,
    ).toBeGreaterThan(0);
  });

  it("opens the pages and spaces rankings", async () => {
    const user = userEvent.setup();
    render(view());
    await user.click(screen.getByRole("tab", { name: "Pages" }));
    expect(screen.getByRole("link", { name: "Alpha" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Spaces" }));
    expect(screen.getByRole("link", { name: "Core" })).toBeInTheDocument();
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

describe("TrendChart summary", () => {
  it("shows the change against the first half, the daily average and the peak", () => {
    const rising = [1, 1, 4, 4].map((value, i) => ({
      day: `2026-10-1${i}`,
      value,
    }));
    const { rerender } = render(<TrendChart title="Views" points={rising} />);
    expect(screen.getByText(/▲ 300%/)).toBeInTheDocument();
    expect(screen.getByText("Average 3 per day")).toBeInTheDocument();
    expect(screen.getByText("Peak 4 on Oct 12")).toBeInTheDocument();

    rerender(
      <TrendChart
        title="Views"
        points={[4, 4, 1, 1].map((value, i) => ({
          day: `2026-10-1${i}`,
          value,
        }))}
      />,
    );
    expect(screen.getByText(/▼ 75%/)).toBeInTheDocument();
    rerender(
      <TrendChart
        title="Views"
        points={[2, 2, 2, 2].map((value, i) => ({
          day: `2026-10-1${i}`,
          value,
        }))}
      />,
    );
    expect(screen.getByText(/– 0%/)).toBeInTheDocument();
    rerender(<TrendChart title="Views" points={[]} />);
    expect(screen.queryByText(/Peak/)).not.toBeInTheDocument();
  });
});

describe("StatisticsView derived figures", () => {
  it("adds averages and shares under the headline numbers", async () => {
    render(view());
    expect(screen.getAllByText(/per day/).length).toBeGreaterThan(2);
    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: "AI usage" }));
    expect(screen.getByText("80% of all tokens")).toBeInTheDocument();
    expect(screen.getByText("20% of all tokens")).toBeInTheDocument();
  });

  it("copes with a workspace that has nothing yet", () => {
    render(
      view({
        overview: {
          ...overview,
          totals: {
            ...overview.totals,
            users: 0,
            spaces: 0,
            pages: 0,
            active_users: 0,
          },
        },
        ai: {
          ...ai,
          totals: {
            tokens: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            calls: 0,
            users: 0,
          },
        },
      }),
    );
    expect(screen.getAllByText("0% of all people").length).toBeGreaterThan(0);
  });
});

describe("TrendChart units", () => {
  it("names what is counted, in the total and in the tooltip", () => {
    const unit = (count: number) => (count === 1 ? "view" : "views");
    render(
      <TrendChart
        title="Views"
        unit={unit}
        points={[
          { day: "2026-10-12", value: 1 },
          { day: "2026-10-13", value: 3 },
        ]}
      />,
    );
    expect(screen.getByText("views")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("group"), { key: "ArrowLeft" });
    expect(screen.getByText("Oct 13: 3 views")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("group"), { key: "ArrowLeft" });
    expect(screen.getByText("Oct 12: 1 view")).toBeInTheDocument();
  });
});

describe("StatisticsView activity", () => {
  it("shows active people and time as daily averages", () => {
    render(view());
    // 754 s rounds to 13 minutes; 1.7 people a day.
    expect(screen.getAllByText("13 min").length).toBeGreaterThan(0);
    expect(screen.getByText("1.7 active per day")).toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: /Active people per day\. 1\.7 on average/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: /Active time per person per day\. 13 min on average/,
      }),
    ).toBeInTheDocument();
    // The busiest day: 4500 s is an hour and a quarter.
    expect(screen.getByText("Peak 1 h 15 min on Oct 14")).toBeInTheDocument();
  });

  it("reads durations under a minute and whole hours", () => {
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
