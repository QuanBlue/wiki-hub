import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

describe("Help pages search and navigation", () => {
  let observed: IntersectionObserverCallback | null = null;

  class CapturingObserver extends IntersectionObserverMock {
    constructor(callback: IntersectionObserverCallback) {
      super(callback);
      observed = callback;
    }
  }

  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  it("says so when no help topic matches the search", () => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    render(<HelpPage />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search Help topics" }), {
      target: { value: "zzzzqqqq" },
    });

    expect(screen.getByRole("status")).toHaveTextContent('No help topic matches "zzzzqqqq".');
  });

  it("counts and filters the guides of a topic as you search, and says when none match", () => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    render(<HelpDetailPage topic="Account" />);
    const search = screen.getAllByRole("searchbox")[0]!;

    fireEvent.change(search, { target: { value: "sessions" } });
    expect(screen.getAllByRole("status").some((el) => /result/.test(el.textContent ?? ""))).toBe(
      true,
    );

    fireEvent.change(search, { target: { value: "zzzzqqqq" } });
    expect(screen.getByText('No guides found for "zzzzqqqq"')).toBeInTheDocument();
  });

  it("uses the singular for exactly one match", () => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    render(<HelpDetailPage topic="Account" />);
    const search = screen.getAllByRole("searchbox")[0]!;
    const first = document.querySelectorAll("section[id]")[0]?.querySelector("h2, h3")?.textContent;

    fireEvent.change(search, { target: { value: first ?? "" } });

    expect(screen.getAllByRole("status")[0]).toHaveTextContent(/\d+ results?/);
  });

  it("moves focus to a guide's heading when its link is followed", async () => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    render(<HelpDetailPage topic="Account" />);
    const link = within(screen.getByRole("navigation", { name: "Guide navigation" })).getAllByRole(
      "link",
    )[1]!;
    const id = link.getAttribute("href")!.slice(1);
    const heading = document.getElementById(`${id}-heading`);
    expect(heading).not.toBeNull();
    const focus = vi.spyOn(heading!, "focus");

    fireEvent.click(link);
    await frame();

    expect(focus).toHaveBeenCalled();
  });

  it("follows the guide that scrolls into view, the topmost one", () => {
    vi.stubGlobal("IntersectionObserver", CapturingObserver);
    render(<HelpDetailPage topic="Account" />);
    const links = within(screen.getByRole("navigation", { name: "Guide navigation" })).getAllByRole(
      "link",
    );
    const ids = links.map((link) => link.getAttribute("href")!.slice(1));

    act(() => {
      observed!(
        [
          { isIntersecting: true, boundingClientRect: { top: 300 }, target: { id: ids[0] } },
          { isIntersecting: true, boundingClientRect: { top: 20 }, target: { id: ids[1] } },
          { isIntersecting: false, boundingClientRect: { top: 0 }, target: { id: ids[2] } },
        ] as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    });
    expect(links[1]).toHaveAttribute("aria-current", "location");

    act(() => {
      observed!([], {} as IntersectionObserver);
    });
    expect(links[1]).toHaveAttribute("aria-current", "location");
  });
});
