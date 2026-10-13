import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { RecentlyVisitedList } from "@/components/recent/recently-visited-list";
import { recordVisit } from "@/lib/recently-visited";

beforeEach(() => {
  window.localStorage.clear();
});

describe("RecentlyVisitedList", () => {
  it("explains when nothing has been visited", () => {
    render(<RecentlyVisitedList />);
    expect(screen.getByText("No visited pages yet")).toBeInTheDocument();
  });

  it("lists visits with a link, space and date, and follows new ones", () => {
    recordVisit({
      spaceKey: "ENG",
      spaceName: "Engineering",
      slug: "run book",
      title: "Run book",
      visitedAt: "2026-03-05T12:00:00Z",
    });
    render(<RecentlyVisitedList />);
    expect(screen.getByRole("link", { name: /Run book/ })).toHaveAttribute("href", "/spaces/ENG/pages/run%20book");
    expect(screen.getByText(/Engineering · Visited Mar 5, 2026/)).toBeInTheDocument();

    act(() => {
      recordVisit({
        spaceKey: "OPS",
        spaceName: "Operations",
        slug: "home",
        title: "Ops home",
        visitedAt: "2026-03-06T12:00:00Z",
      });
    });
    expect(screen.getByText("Ops home")).toBeInTheDocument();
  });
});
