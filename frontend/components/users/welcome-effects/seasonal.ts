import type { PlayableWelcomeEffect, SeasonalEffectPresetId } from "@/types/api";

/** Every festival preset has a matching welcome scene, played on Home during the festival. */
export const SEASONAL_WELCOME: Partial<
  Record<SeasonalEffectPresetId, Exclude<PlayableWelcomeEffect, "">>
> = {
  new_year: "fireworks",
  lunar_new_year: "tet",
  mid_autumn: "midautumn",
  halloween: "halloween",
  christmas: "christmas",
  valentine: "valentine",
  floral_pink: "floral",
  teachers_day: "teachers",
  blue_neon: "mensday",
  national_red_gold: "national",
  heritage_gold: "heritage",
  lotus_gold: "lotus",
  kids_party: "kids",
  easter: "easter",
  spring_green: "spring",
  autumn_harvest: "harvest",
  memorial_candle: "memorial",
};

export function seasonalWelcomeEffect(
  preset: SeasonalEffectPresetId | undefined,
): PlayableWelcomeEffect {
  return (preset && SEASONAL_WELCOME[preset]) || "";
}
