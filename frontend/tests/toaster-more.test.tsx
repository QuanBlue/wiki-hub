import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/toaster";

function advance(ms: number) {
  for (let left = ms; left > 0; left -= 100) {
    act(() => {
      vi.advanceTimersByTime(Math.min(100, left));
    });
  }
}

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

describe("Toaster behaviours", () => {
  it("renders nothing without toasts", () => {
    const { container } = render(<Toaster />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows loading, error and plain toasts with the right roles", () => {
    render(<Toaster />);
    act(() => {
      toast.loading("Working");
      toast.error("Broke");
      toast("Plain");
    });
    advance(10);
    expect(screen.getByText("Working").closest("li")).toHaveAttribute("role", "status");
    expect(screen.getByText("Broke").closest("li")).toHaveAttribute("role", "alert");
    expect(screen.getByText("Plain").closest("li")).toHaveAttribute("data-type", "default");
    // A loading toast has no countdown, so it never closes by itself.
    advance(30_000);
    expect(screen.getByText("Working")).toBeTruthy();
  });

  it("renders a description, a custom icon and rich text", () => {
    render(<Toaster />);
    act(() => {
      toast("Saved **now**", { description: () => "Details", icon: <span>★</span> });
    });
    advance(10);
    expect(screen.getByText("now").tagName).toBe("STRONG");
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("★")).toBeTruthy();
  });

  it("renders custom JSX bodies and leaves ready-made elements alone", () => {
    render(<Toaster />);
    act(() => {
      toast.custom(() => <b>custom body</b>);
      toast(<i>element title</i>);
    });
    advance(10);
    expect(screen.getByText("custom body")).toBeTruthy();
    expect(screen.getByText("element title")).toBeTruthy();
  });

  it("runs action and cancel buttons, closing unless prevented", () => {
    const onAction = vi.fn();
    const onCancel = vi.fn();
    const onDismiss = vi.fn();
    render(<Toaster />);
    act(() => {
      toast("With buttons", {
        action: { label: "Undo", onClick: onAction },
        cancel: { label: "Nope", onClick: onCancel },
        onDismiss,
      });
    });
    advance(10);

    fireEvent.click(screen.getByText("Nope"));
    expect(onCancel).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    advance(300);
    expect(screen.queryByText("With buttons")).toBeNull();

    act(() => {
      toast("Keep me", {
        action: {
          label: "Hold",
          onClick: (event) => event.preventDefault(),
        },
      });
    });
    advance(10);
    fireEvent.click(screen.getByText("Hold"));
    advance(300);
    expect(screen.getByText("Keep me")).toBeTruthy();
  });

  it("keeps a prevented cancel open", () => {
    render(<Toaster />);
    act(() => {
      toast("Stay", {
        cancel: { label: "Cancel it", onClick: (event) => event.preventDefault() },
      });
    });
    advance(10);
    fireEvent.click(screen.getByText("Cancel it"));
    advance(300);
    expect(screen.getByText("Stay")).toBeTruthy();
  });

  it("accepts a ready-made action node", () => {
    render(<Toaster />);
    act(() => {
      toast("Node action", { action: <a href="/x">Open</a> });
    });
    advance(10);
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
  });

  it("calls onAutoClose when the countdown ends", () => {
    const onAutoClose = vi.fn();
    render(<Toaster />);
    act(() => {
      toast("Timed", { duration: 1000, onAutoClose });
    });
    advance(1200);
    expect(onAutoClose).toHaveBeenCalled();
  });

  it("hides the close button when a toast is not dismissible", () => {
    render(<Toaster />);
    act(() => {
      toast("Sticky", { dismissible: false });
      toast("Closable");
    });
    advance(10);
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
  });

  it("closes from its close button", () => {
    render(<Toaster />);
    act(() => {
      toast("Bye");
    });
    advance(10);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    advance(300);
    expect(screen.queryByText("Bye")).toBeNull();
  });

  it("pauses while the tab is hidden and resumes when it returns", () => {
    render(<Toaster />);
    act(() => {
      toast("Tab toast", { duration: 2000 });
    });
    advance(10);
    const li = screen.getByText("Tab toast").closest("li")!;

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(li.dataset.paused).toBe("true");
    advance(5000);
    expect(screen.getByText("Tab toast")).toBeTruthy();

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    advance(2500);
    expect(screen.queryByText("Tab toast")).toBeNull();
  });

  it("pauses on keyboard focus and expands the stack while focused", () => {
    render(<Toaster />);
    act(() => {
      toast("Focus me", { duration: 2000, action: { label: "Act", onClick: () => {} } });
      toast("Another");
    });
    advance(10);
    const region = screen.getByRole("region", { name: "Notifications" });
    const li = screen.getByText("Focus me").closest("li")!;
    const button = screen.getByText("Act");

    act(() => button.focus());
    expect(li.dataset.paused).toBe("true");
    expect(region.dataset.expanded).toBe("true");
    advance(5000);
    expect(screen.getByText("Focus me")).toBeTruthy();

    // Moving focus inside the same toast keeps it paused; leaving unpauses.
    fireEvent.blur(button, { relatedTarget: li });
    expect(li.dataset.paused).toBe("true");
    fireEvent.blur(button, { relatedTarget: document.body });
    expect(li.dataset.paused).toBe("false");
    expect(region.dataset.expanded).toBe("false");
  });

  it("restarts the countdown when a toast is updated", () => {
    render(<Toaster />);
    let id: string | number = "";
    act(() => {
      id = toast("Original", { duration: 2000 });
    });
    advance(1500);
    act(() => {
      toast.success("Updated", { id, duration: 4000 });
    });
    advance(2500);
    expect(screen.getByText("Updated")).toBeTruthy();
    advance(2500);
    expect(screen.queryByText("Updated")).toBeNull();
  });

  it("hides toasts deep in the stack unless expanded", () => {
    render(<Toaster />);
    act(() => {
      for (let i = 0; i < 6; i += 1) toast(`T${i}`, { duration: 60_000 });
    });
    advance(10);
    const region = screen.getByRole("region", { name: "Notifications" });
    const items = Array.from(region.querySelectorAll("li"));
    expect(items.length).toBeGreaterThan(4);
    expect(items.some((li) => li.dataset.hidden === "true")).toBe(true);
    expect(items[0].dataset.hidden).toBe("false");

    fireEvent.mouseEnter(region);
    expect(items.every((li) => li.dataset.hidden === "false")).toBe(true);
    fireEvent.mouseLeave(region);
  });

  it("copes without ResizeObserver", () => {
    const original = window.ResizeObserver;
    // @ts-expect-error simulate an old browser
    delete window.ResizeObserver;
    try {
      render(<Toaster />);
      act(() => {
        toast("No observer");
      });
      advance(10);
      expect(screen.getByText("No observer")).toBeTruthy();
    } finally {
      window.ResizeObserver = original;
    }
  });
});
