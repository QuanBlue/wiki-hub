import { describe, expect, it } from "vitest";

import { SEASONAL_PRESETS } from "@/components/seasonal/seasonal-presets";
import { createWelcomeRenderer } from "@/components/users/welcome-effect-overlay";
import { MASCOTS } from "@/components/users/welcome-effects/mascots";
import { seasonalWelcomeEffect } from "@/components/users/welcome-effects/seasonal";

describe("seasonal welcome effects", () => {
  it("gives every festival preset a playable scene", () => {
    for (const preset of SEASONAL_PRESETS) {
      const effect = seasonalWelcomeEffect(preset.id);
      expect(effect, preset.id).not.toBe("");
      expect(createWelcomeRenderer(effect, 720, 352), preset.id).not.toBeNull();
      if (effect !== "memorial") expect(MASCOTS[effect], preset.id).toBeDefined();
    }
  });

  it("plays nothing without a festival", () => {
    expect(seasonalWelcomeEffect("none")).toBe("");
    expect(seasonalWelcomeEffect(undefined)).toBe("");
  });
});
