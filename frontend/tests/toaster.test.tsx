import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/toaster";

// React only renders between act() calls, so step through time the way a real
// clock would: each tick lets state changes (leaving, removal) take effect.
function advance(ms: number) {
  for (let left = ms; left > 0; left -= 100) {
    act(() => {
      vi.advanceTimersByTime(Math.min(100, left));
    });
  }
}

describe("Toaster", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "Date", "requestAnimationFrame", "cancelAnimationFrame"],
    });
  });
  afterEach(() => {
    act(() => {
      toast.dismiss();
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it("pauses only the hovered toast and resumes it with its remaining time", () => {
    render(<Toaster />);
    act(() => {
      toast.info("First toast", { duration: 4000 });
      toast.success("Second toast", { duration: 4000 });
    });
    advance(10);
    const first = screen.getByText("First toast").closest("li")!;
    const second = screen.getByText("Second toast").closest("li")!;

    advance(2000);
    fireEvent.mouseEnter(first);
    expect(first.dataset.paused).toBe("true");
    expect(second.dataset.paused).toBe("false");

    // Well past both original deadlines: the untouched one is gone, the
    // hovered one is still there.
    advance(3000);
    expect(screen.queryByText("Second toast")).toBeNull();
    expect(screen.getByText("First toast")).toBeTruthy();

    // Leaving resumes with the ~2s that were left, not a fresh 4s.
    fireEvent.mouseLeave(first);
    advance(1500);
    expect(screen.getByText("First toast")).toBeTruthy();
    advance(1000);
    expect(screen.queryByText("First toast")).toBeNull();
  });

  it("lays the stack out in a column while hovered and stacks it at rest", () => {
    render(<Toaster />);
    act(() => {
      toast("One");
      toast("Two");
    });
    advance(10);
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region.dataset.expanded).toBe("false");
    fireEvent.mouseEnter(region);
    expect(region.dataset.expanded).toBe("true");
    fireEvent.mouseLeave(region);
    expect(region.dataset.expanded).toBe("false");
  });

  it("keeps a plain toast at normal weight, and only emphasises **bold**, `code` and *italic* markers", () => {
    render(<Toaster />);
    act(() => {
      toast.success("Changes saved for **ada**.");
      toast.success("New password emailed to `ada@example.test`.");
    });
    advance(10);

    const titles = [...document.querySelectorAll(".wh-toast-title")];
    const bolded = titles.find((el) => el.querySelector("strong"));
    const coded = titles.find((el) => el.querySelector("code"));
    expect(bolded?.querySelector("strong")).toHaveTextContent("ada");
    expect(coded?.querySelector("code")).toHaveTextContent("ada@example.test");
    // Applied per marker, not to the whole message.
    expect(bolded?.tagName).not.toBe("STRONG");
  });
});
