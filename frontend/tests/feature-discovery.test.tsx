import {
  act,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeatureDiscovery } from "@/components/home/feature-discovery";
import { SEARCH_OPEN_EVENT } from "@/lib/cheat-sheet";
import { LocaleProvider } from "@/lib/i18n/context";

describe("FeatureDiscovery sliding carousel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders feature discovery component with slides and no dismiss button", () => {
    render(<FeatureDiscovery />);

    expect(
      screen.getByText(/Khám phá tính năng|Explore WikiHub Features/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Tìm mọi thứ thật nhanh|Find anything, fast/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Ctrl+K")).toBeInTheDocument();

    // Verify there is no dismiss / close button
    expect(
      screen.queryByRole("button", {
        name: /Đóng hướng dẫn|Dismiss guide/i,
      }),
    ).toBeNull();
  });

  it("navigates through slides using next and previous buttons", () => {
    render(<FeatureDiscovery />);

    // Click next button
    const nextBtn = screen.getByRole("button", {
      name: /Tính năng tiếp theo|Next feature/i,
    });
    fireEvent.click(nextBtn);

    // Indicator updates to 2/15
    expect(screen.getByText("2/15")).toBeInTheDocument();

    // Click next button again -> 3/15
    fireEvent.click(nextBtn);
    expect(screen.getByText("3/15")).toBeInTheDocument();

    // Click previous button -> back to 2/15
    const prevBtn = screen.getByRole("button", {
      name: /Tính năng trước|Previous feature/i,
    });
    fireEvent.click(prevBtn);
    expect(screen.getByText("2/15")).toBeInTheDocument();
  });

  it("auto-advances slides every 10 seconds when not paused", () => {
    vi.useFakeTimers();
    render(<FeatureDiscovery />);

    expect(screen.getByText("1/15")).toBeInTheDocument();

    // Advance timer by 10000ms
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    // Should now be on slide 2 (2/15)
    expect(screen.getByText("2/15")).toBeInTheDocument();

    // Advance another 10000ms
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    // Should now be on slide 3 (3/15)
    expect(screen.getByText("3/15")).toBeInTheDocument();
  });

  it("pauses auto-advance on mouse hover and resumes on mouse leave", () => {
    vi.useFakeTimers();
    render(<FeatureDiscovery />);

    const container = screen.getByRole("region", {
      name: /Khám phá tính năng|Explore WikiHub Features/i,
    });

    // Hover mouse over component
    fireEvent.mouseEnter(container);

    // Advance 10000ms while hovered
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    // Still on slide 1 because it's paused
    expect(screen.getByText("1/15")).toBeInTheDocument();

    // Mouse leave
    fireEvent.mouseLeave(container);

    // Advance 10000ms after mouse leave
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    // Now moved to slide 2 (2/15)
    expect(screen.getByText("2/15")).toBeInTheDocument();
  });

  it("opens a feature guide with a real screenshot and steps", () => {
    render(<FeatureDiscovery />);

    // Go to slide 3 (Search inside attached files): it has no direct action.
    const nextBtn = screen.getByRole("button", {
      name: /Tính năng tiếp theo|Next feature/i,
    });
    fireEvent.click(nextBtn);
    fireEvent.click(nextBtn);

    const learnMore = screen.getAllByRole("button", {
      name: /Xem cách dùng|See how it works/i,
    });
    fireEvent.click(learnMore[2]);

    expect(
      screen.getAllByText(/Tìm bên trong tệp đính kèm|Search inside attached files/i)
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/Hướng dẫn sử dụng|How to use/i),
    ).toBeInTheDocument();
    const shot = screen.getByRole("img");
    expect(shot.getAttribute("src")).toBe("/feature-discovery/attachment-search.png");
  });

  it("opens the guide for a feature that also has a direct action", () => {
    render(<FeatureDiscovery />);

    fireEvent.click(
      screen.getAllByRole("button", { name: /Xem cách dùng|See how it works/i })[0],
    );

    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "/feature-discovery/search.png",
    );
  });

  it("triggers search open event on clicking action button", () => {
    const searchListener = vi.fn();
    window.addEventListener(SEARCH_OPEN_EVENT, searchListener);

    render(<FeatureDiscovery />);

    const actionButton = screen.getByRole("button", {
      name: /Thử tìm kiếm \(Ctrl\+K\)|Try Search \(Ctrl\+K\)/i,
    });
    fireEvent.click(actionButton);

    expect(searchListener).toHaveBeenCalled();

    window.removeEventListener(SEARCH_OPEN_EVENT, searchListener);
  });

  it("steps between guides with the arrows inside the dialog", () => {
    render(<FeatureDiscovery />);

    fireEvent.click(
      screen.getAllByRole("button", { name: /Xem cách dùng|See how it works/i })[0],
    );
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "/feature-discovery/search.png",
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Next guide|Hướng dẫn tiếp theo/i }),
    );
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "/feature-discovery/ask-ai.png",
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Previous guide|Hướng dẫn trước/i }),
    );
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "/feature-discovery/search.png",
    );
  });

  it("steps between guides with keyboard arrows and closes on Escape", () => {
    render(<FeatureDiscovery />);
    fireEvent.click(screen.getAllByRole("button", { name: /See how it works/i })[0]);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByRole("img")).toHaveAttribute("src", "/feature-discovery/ask-ai.png");
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(screen.getByRole("img")).toHaveAttribute("src", "/feature-discovery/search.png");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("runs a guide's direct action and offers a space link", () => {
    const searchListener = vi.fn();
    window.addEventListener(SEARCH_OPEN_EVENT, searchListener);
    render(<FeatureDiscovery />);
    fireEvent.click(screen.getAllByRole("button", { name: /See how it works/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Try Search/i }));
    expect(searchListener).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /See how it works/i })[7]);
    expect(screen.getByRole("link", { name: "Browse spaces" })).toHaveAttribute("href", "/spaces");
    window.removeEventListener(SEARCH_OPEN_EVENT, searchListener);
  });

  it("uses Vietnamese guide copy and respects reduced motion", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    try {
      render(
        <LocaleProvider initialLocale="vi">
          <FeatureDiscovery />
        </LocaleProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: /Tính năng tiếp theo/i }));
      expect(screen.getByText("2/15")).toBeInTheDocument();
      fireEvent.mouseEnter(screen.getByRole("region"));
      expect(screen.getByText("Tạm dừng")).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("button", { name: /Xem cách dùng/i })[0]);
      expect(screen.getByText(/Ảnh chụp thật từ WikiHub/)).toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("moves the slides with the speed of the scroll over the carousel", () => {
    vi.useFakeTimers();
    render(<FeatureDiscovery />);
    const track = screen.getByTestId("feature-track");

    // A gentle notch is one slide.
    fireEvent.wheel(track, { deltaY: 100 });
    expect(screen.getByText("2/15")).toBeInTheDocument();

    // A fast flick runs through several.
    fireEvent.wheel(track, { deltaY: 320 });
    expect(screen.getByText("6/15")).toBeInTheDocument();

    // Scrolling back goes the other way, and wraps round the loop.
    fireEvent.wheel(track, { deltaY: -800 });
    expect(screen.getByText("1/15")).toBeInTheDocument();
    fireEvent.wheel(track, { deltaY: -100 });
    expect(screen.getByText("15/15")).toBeInTheDocument();
  });
});
