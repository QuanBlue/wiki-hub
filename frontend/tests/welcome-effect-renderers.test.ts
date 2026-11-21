import { describe, expect, it } from "vitest";

import { drawScene, DURATION_MS, mascotLayout } from "@/components/users/welcome-effects/engine";
import { MASCOTS } from "@/components/users/welcome-effects/mascots";
import {
  createCandyRenderer,
  createCyberpunkRenderer,
  createKawaiiRenderer,
  createSteampunkRenderer,
} from "@/components/users/welcome-effects/themes-style";
import {
  createJungleRenderer,
  createNinjaRenderer,
  createPirateRenderer,
  createRocketRenderer,
} from "@/components/users/welcome-effects/themes-adventure";
import {
  createChristmasRenderer,
  createHalloweenRenderer,
  createMidautumnRenderer,
  createTetRenderer,
} from "@/components/users/welcome-effects/themes-festival";
import {
  createEasterRenderer,
  createFloralRenderer,
  createHarvestRenderer,
  createKidsRenderer,
  createMensdayRenderer,
  createSpringRenderer,
  createTeachersRenderer,
  createValentineRenderer,
} from "@/components/users/welcome-effects/themes-holiday";
import {
  createHeritageRenderer,
  createLotusRenderer,
  createMemorialRenderer,
  createNationalRenderer,
} from "@/components/users/welcome-effects/themes-holiday-national";
import {
  createBlockcraftRenderer,
  createPlatformerRenderer,
  createRacingRenderer,
} from "@/components/users/welcome-effects/themes-game";

/** A 2D context stub: every method is a no-op, gradients accept colour stops. */
function fakeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(obj, prop: string) {
      if (prop in obj) return obj[prop];
      if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => gradient;
      if (prop === "measureText") return (text: string) => ({ width: text.length * 8 });
      return () => undefined;
    },
    set(obj, prop: string, value) {
      obj[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const THEMES = {
  blockcraft: createBlockcraftRenderer,
  platformer: createPlatformerRenderer,
  racing: createRacingRenderer,
  tet: createTetRenderer,
  halloween: createHalloweenRenderer,
  christmas: createChristmasRenderer,
  midautumn: createMidautumnRenderer,
  pirate: createPirateRenderer,
  ninja: createNinjaRenderer,
  rocket: createRocketRenderer,
  jungle: createJungleRenderer,
  cyberpunk: createCyberpunkRenderer,
  steampunk: createSteampunkRenderer,
  candy: createCandyRenderer,
  kawaii: createKawaiiRenderer,
  valentine: createValentineRenderer,
  floral: createFloralRenderer,
  teachers: createTeachersRenderer,
  mensday: createMensdayRenderer,
  kids: createKidsRenderer,
  easter: createEasterRenderer,
  spring: createSpringRenderer,
  harvest: createHarvestRenderer,
  national: createNationalRenderer,
  heritage: createHeritageRenderer,
  lotus: createLotusRenderer,
  memorial: createMemorialRenderer,
};

describe("welcome effect renderers", () => {
  for (const [id, create] of Object.entries(THEMES)) {
    it(`${id} draws every phase (with and without an avatar) and has a mascot costume`, () => {
      const ctx = fakeContext();
      const render = create();
      const focus = { x: 120, y: 90, r: 40 };
      for (let ms = 0; ms <= DURATION_MS; ms += 100) {
        render(ctx, 720, 352, ms, focus);
        render(ctx, 360, 640, ms);
        if (id !== "memorial") drawScene(ctx, 720, 352, ms, focus, MASCOTS[id]);
      }
      if (id !== "memorial") expect(MASCOTS[id]).toBeDefined();
    });
  }

  it("puts the mascot in the middle, facing the avatar", () => {
    const l = mascotLayout({ x: 60, y: 90, r: 40 }, 720, 400);
    expect(l.x).toBe(360);
    expect(l.facing).toBe(-1);
    const r = mascotLayout({ x: 660, y: 90, r: 40 }, 720, 400);
    expect(r.facing).toBe(1);
  });

  it("steps aside when the avatar is in the middle", () => {
    const l = mascotLayout({ x: 360, y: 220, r: 40 }, 720, 400);
    expect(Math.abs(l.x - 360)).toBeGreaterThan(40 * 1.75);
  });
});
