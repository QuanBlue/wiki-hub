import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SeasonalSidebarOverlay } from "@/components/seasonal/seasonal-sidebar-overlay";
import {
  SeasonalTopBarGreeting,
  SeasonalTopBarOverlay,
} from "@/components/seasonal/seasonal-topbar-overlay";
import { LocaleProvider } from "@/lib/i18n/context";
import type { SeasonalEffectPresetId } from "@/types/api";

const PRESETS: Exclude<SeasonalEffectPresetId, "none">[] = [
  "christmas", "lunar_new_year", "new_year", "national_red_gold", "heritage_gold", "lotus_gold",
  "floral_pink", "mid_autumn", "halloween", "blue_neon", "memorial_candle", "valentine",
  "spring_green", "easter", "kids_party", "teachers_day", "autumn_harvest",
];

describe("holiday chrome", () => {
  it("keeps the sidebar plain: only the selected-row style, no watermark or scenery", () => {
    const { container } = render(
      <nav className="relative">
        <SeasonalSidebarOverlay preset="lunar_new_year" />
      </nav>,
    );
    const rail = container.querySelector("[data-wh-rail]")!;
    expect(rail.querySelector("style")?.textContent).toContain('[aria-current="page"]');
    expect(rail.querySelector("svg")).toBeNull();
  });

  it("puts the sunken watermark on the top bar", () => {
    const { container } = render(<SeasonalTopBarOverlay preset="lunar_new_year" />, {
      wrapper: LocaleProvider,
    });
    expect(container.querySelector("[data-topbar-watermark] [data-scatter-pattern] pattern")).not.toBeNull();
  });

  it.each(PRESETS)("dresses the %s greeting with doodles", (preset) => {
    const { container } = render(<SeasonalTopBarGreeting preset={preset} alwaysVisible />, {
      wrapper: LocaleProvider,
    });
    const greeting = container.querySelector("[data-seasonal-greeting]")!;
    expect(greeting.textContent).not.toBe("");
    const doodles = greeting.querySelectorAll("[data-greeting-doodle]");
    expect(doodles.length).toBe(preset === "memorial_candle" ? 1 : 2);
  });

  it("keeps the remembrance doodle still", () => {
    const { container } = render(
      <SeasonalTopBarGreeting preset="memorial_candle" alwaysVisible />,
      { wrapper: LocaleProvider },
    );
    const g = container.querySelector("[data-greeting-doodle] > g")!;
    expect(g.getAttribute("class") ?? "").not.toMatch(/wh-seasonal-(bob|leaf|pulse|spin)/);
  });
});
