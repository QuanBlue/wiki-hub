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

    // Applied in another tab; 2 s throttle has to pass first.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      meta.preset = "christmas";
      await act(async () => {
        vi.advanceTimersByTime(2500);
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => expect(screen.getByTestId("preset")).toHaveTextContent("christmas"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not hit the server twice within two seconds", async () => {
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
});
