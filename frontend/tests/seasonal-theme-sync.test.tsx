import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeColorProvider, useThemeSettings } from "@/components/theme-color-provider";

const meta = vi.hoisted(() => ({ preset: "none" as string }));

function theme(preset: string) {
  return {
    preset,
    event_id: null,
    event_name_en: null,
    event_name_vi: null,
    source: "manual",
  };
}

function Probe() {
  const { effectiveSeasonalPreset, refreshSeasonalTheme, setSeasonalTheme } = useThemeSettings();
  return (
    <>
      <span data-testid="preset">{effectiveSeasonalPreset}</span>
      <button onClick={refreshSeasonalTheme}>refresh</button>
      <button onClick={() => setSeasonalTheme(theme("easter") as never)}>apply</button>
    </>
  );
}

beforeEach(() => {
  meta.preset = "none";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ seasonal_theme: theme(meta.preset) }),
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("active holiday stays in sync while the app is open", () => {
  it("picks up a holiday applied elsewhere when the window regains focus", async () => {
    render(
      <ThemeColorProvider>
        <Probe />
      </ThemeColorProvider>,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("preset")).toHaveTextContent("none");

    // Applied in another tab; the 30 s throttle has to pass first.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      meta.preset = "christmas";
      await act(async () => {
        vi.advanceTimersByTime(31_000);
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => expect(screen.getByTestId("preset")).toHaveTextContent("christmas"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not hit the server again within 30 seconds", async () => {
    render(
      <ThemeColorProvider>
        <Probe />
      </ThemeColorProvider>,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("applies a holiday locally and broadcasts it", async () => {
    const postMessage = vi.fn();
    class FakeChannel {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      postMessage = postMessage;
      close = vi.fn();
    }
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    render(
      <ThemeColorProvider>
        <Probe />
      </ThemeColorProvider>,
    );
    act(() => {
      screen.getByText("apply").click();
    });
    expect(screen.getByTestId("preset")).toHaveTextContent("easter");
    expect(postMessage).toHaveBeenCalledWith("changed");
  });

  it("refreshes on broadcast channel message and visibilitychange", async () => {
    let channelInstance: { onmessage: ((ev: unknown) => void) | null } | null = null;
    class FakeChannel {
      onmessage: ((ev: unknown) => void) | null = null;
      postMessage = vi.fn();
      close = vi.fn();
      constructor() {
        channelInstance = this;
      }
    }
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    render(
      <ThemeColorProvider>
        <Probe />
      </ThemeColorProvider>,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    meta.preset = "tet";
    await act(async () => {
      channelInstance?.onmessage?.({ data: "changed" });
    });
    await waitFor(() => expect(screen.getByTestId("preset")).toHaveTextContent("tet"));

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  });

  it("handles broadcast channel postMessage failure gracefully", async () => {
    class ThrowingChannel {
      onmessage = null;
      postMessage = vi.fn(() => {
        throw new Error("channel dead");
      });
      close = vi.fn();
    }
    vi.stubGlobal("BroadcastChannel", ThrowingChannel);
    render(
      <ThemeColorProvider>
        <Probe />
      </ThemeColorProvider>,
    );
    act(() => {
      screen.getByText("apply").click();
    });
    expect(screen.getByTestId("preset")).toHaveTextContent("easter");
  });
});
