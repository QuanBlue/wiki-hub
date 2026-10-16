import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContributionChart } from "@/components/users/contribution-chart";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn() },
}));

// A Wednesday to a Thursday, crossing from September into October.
const RECENT = {
  year: 2026,
  start: "2026-09-30",
  end: "2026-10-08",
  total: 7,
  years: [2026, 2025],
  hours: [],
  days: [
    { date: "2026-09-30", count: 1 },
    { date: "2026-10-01", count: 4 },
    { date: "2026-10-05", count: 2 },
  ],
};

beforeEach(() => vi.mocked(api.get).mockReset().mockResolvedValue(RECENT));

const cells = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-level]"));

async function choose(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Time range" }));
  await user.click(await screen.findByRole("menuitemradio", { name }));
}

describe("ContributionChart", () => {
  it("counts the contributions and draws a square for every day, darker when busier", async () => {
    render(<ContributionChart username="ada" />);

    expect(await screen.findByText("7 contributions")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(
      "/api/v1/users/ada/contributions?days=365",
    );
    expect(cells()).toHaveLength(9);
    expect(cells().map((cell) => cell.dataset.level)).toEqual(
      expect.arrayContaining(["0", "1", "2", "4"]),
    );
    expect(
      screen.getByRole("img", { name: "Contribution activity, 7 in total" }),
    ).toBeInTheDocument();
  });

  it("describes each day and labels the months", async () => {
    render(<ContributionChart username="ada" />);
    await screen.findByText("7 contributions");

    expect(
      screen.getByTitle(/^4 contributions on .*Oct 1, 2026/),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle(/^1 contribution on .*Sep 30, 2026/),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle(/^No contributions on .*Oct 2, 2026/),
    ).toBeInTheDocument();
    expect(screen.getByText("Sep")).toBeInTheDocument();
    // Monday, Wednesday and Friday label their rows.
    expect(
      ["Mon", "Wed", "Fri"].map((day) => screen.getByText(day)),
    ).toHaveLength(3);
    expect(screen.queryByText("Tue")).toBeNull();
    expect(screen.getByText("Oct")).toBeInTheDocument();
  });

  it("offers each year the person was active, and goes back to the last year", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path.includes("year=2025")
        ? {
            ...RECENT,
            year: 2025,
            start: "2025-01-01",
            end: "2025-12-31",
            total: 0,
            days: [],
            hours: [],
          }
        : RECENT,
    );
    render(<ContributionChart username="ada" />);
    await screen.findByText("7 contributions");

    await choose(user, "2025");
    expect(await screen.findByText("0 contributions")).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith(
      "/api/v1/users/ada/contributions?year=2025",
    );
    expect(cells()).toHaveLength(365);

    await choose(user, "Last 12 months");
    expect(await screen.findByText("7 contributions")).toBeInTheDocument();
  });

  it("says when the chart cannot be loaded", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("down"));
    render(<ContributionChart username="ada" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the contribution chart.",
    );
  });

  it("treats an empty answer as a failed load", async () => {
    vi.mocked(api.get).mockResolvedValue(undefined);
    render(<ContributionChart username="ada" />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("ignores an answer that arrives after the person was left", async () => {
    let finish: (value: typeof RECENT) => void = () => {};
    vi.mocked(api.get).mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    const { unmount } = render(<ContributionChart username="ada" />);
    unmount();
    finish(RECENT);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  });
});
