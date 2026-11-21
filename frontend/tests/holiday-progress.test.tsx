import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavigationProgressProvider } from "@/components/layout/navigation-progress";
import { NavigationLoading } from "@/components/navigation-loading";
import { LocaleProvider } from "@/lib/i18n/context";
import type { SeasonalEffectPresetId } from "@/types/api";

const seasonal = vi.hoisted(() => ({ preset: "none" as SeasonalEffectPresetId }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/theme-color-provider", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/components/theme-color-provider")>();
  return {
    ...mod,
    useThemeSettings: () => ({
      ...mod.useThemeSettings(),
      effectiveSeasonalPreset: seasonal.preset,
    }),
  };
});

beforeEach(() => {
  seasonal.preset = "none";
});

describe("page-loading bar during a holiday", () => {
  it("keeps the plain bar under the top bar outside a holiday", () => {
    render(<NavigationProgressProvider>x</NavigationProgressProvider>);
    const bar = screen.getByRole("progressbar", { hidden: true });
    expect(bar).not.toHaveAttribute("data-holiday-progress");
    expect(bar.querySelector("[data-greeting-doodle]")).toBeNull();
  });

  it("runs the holiday doodle over the header in holiday colours", () => {
    seasonal.preset = "lunar_new_year";
    render(<NavigationProgressProvider>x</NavigationProgressProvider>);
    const bar = screen.getByRole("progressbar", { hidden: true });
    expect(bar).toHaveAttribute("data-holiday-progress");
    expect(bar.className).toContain("top-0");
    expect(bar.className).toContain("h-(--wh-topbar-height)");
    expect(bar.querySelector("[data-greeting-doodle]")).not.toBeNull();
    const wash = bar.querySelector<HTMLElement>(".nav-progress-bar > div")!;
    expect(wash.style.backgroundImage).toContain("linear-gradient");
  });

  it("leaves no bar under the header: link clicks use the holiday loader too", async () => {
    seasonal.preset = "lunar_new_year";
    render(<NavigationLoading />, { wrapper: LocaleProvider });
    const a = document.createElement("a");
    a.href = "/spaces";
    document.body.appendChild(a);
    fireEvent.click(a);
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("data-holiday-progress");
    // The plain strip under the header (fixed top-14) must not be drawn.
    expect(document.querySelector(".top-14")).toBeNull();
    a.remove();
  });
});
