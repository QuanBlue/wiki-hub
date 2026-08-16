import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HelpDetailPage, HelpPage } from "@/components/help/help-page";

class IntersectionObserverMock {
  constructor(_callback: IntersectionObserverCallback) {}

  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = "";
  thresholds: readonly number[] = [];
}

describe("Help pages", () => {
  it("renders only topic links and filters them", () => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    render(<HelpPage />);

    expect(
      screen.getByRole("heading", { name: "How can we help?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Help topics" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Workspace/ })).toHaveAttribute(
      "href",
      "/help/workspace",
    );
    expect(
      screen.queryByText(/Confluence Data Center XML export/i),
    ).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search Help topics" }),
      {
        target: { value: "backup" },
      },
    );
    expect(
      screen.getByRole("link", { name: /^Administration/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^Writing/ }),
    ).not.toBeInTheDocument();
  });

  it("renders only the selected topic in the detail guide", () => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    render(<HelpDetailPage topic="Account" />);

    expect(
      screen.getByRole("navigation", { name: "Breadcrumb" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Help" })).toHaveAttribute(
      "href",
      "/help",
    );
    expect(
      screen.getByRole("navigation", { name: "Guide navigation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/sign out all other sessions/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Confluence Data Center XML export/i),
    ).not.toBeInTheDocument();
  });
});
