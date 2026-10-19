import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ActivityHeartbeat,
  HEARTBEAT_MS,
} from "@/components/layout/activity-heartbeat";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ api: { post } }));

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("ActivityHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    post.mockReset().mockResolvedValue(undefined);
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("beats on open, then only for minutes the visible tab was used", () => {
    const { unmount } = render(<ActivityHeartbeat />);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/api/v1/users/me/activity");

    // An untouched minute sends nothing.
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS));
    expect(post).toHaveBeenCalledTimes(1);

    // Scrolling while reading counts.
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS));
    expect(post).toHaveBeenCalledTimes(2);

    // A hidden tab counts nothing, even if it saw input.
    window.dispatchEvent(new KeyboardEvent("keydown"));
    setVisibility("hidden");
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS));
    expect(post).toHaveBeenCalledTimes(2);

    unmount();
    setVisibility("visible");
    window.dispatchEvent(new Event("pointerdown"));
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS));
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("ignores a failed beat", async () => {
    post.mockRejectedValue(new Error("offline"));
    render(<ActivityHeartbeat />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
