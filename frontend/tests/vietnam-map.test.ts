import { describe, expect, it } from "vitest";

import {
  HOANG_SA,
  MAP_LAT0,
  MAP_LAT_SPAN,
  MAP_LON0,
  MAP_LON_SPAN,
  TRUONG_SA,
  VN_COASTAL_ISLANDS,
  VN_OUTLINE,
} from "@/components/users/welcome-effects/themes-holiday-national";

const inBox = ([lon, lat]: readonly [number, number, ...number[]]) =>
  lon >= MAP_LON0 &&
  lon <= MAP_LON0 + MAP_LON_SPAN &&
  lat <= MAP_LAT0 &&
  lat >= MAP_LAT0 - MAP_LAT_SPAN;

describe("Vietnam map geography", () => {
  it("fits the mainland, coastal islands and both archipelagos in the drawing box", () => {
    for (const p of [...VN_OUTLINE, ...VN_COASTAL_ISLANDS, ...HOANG_SA, ...TRUONG_SA]) {
      expect(inBox(p), `${p}`).toBe(true);
    }
  });

  it("places Hoàng Sa east of Huế–Đà Nẵng and Trường Sa south-east, off Khánh Hòa", () => {
    for (const [lon, lat] of HOANG_SA) {
      expect(lon).toBeGreaterThan(111);
      expect(lon).toBeLessThan(113);
      expect(lat).toBeGreaterThan(15.5);
      expect(lat).toBeLessThan(17.2);
    }
    for (const [lon, lat] of TRUONG_SA) {
      expect(lon).toBeGreaterThan(111.5);
      expect(lon).toBeLessThan(117);
      expect(lat).toBeGreaterThan(7.5);
      expect(lat).toBeLessThan(11.6);
    }
    // the archipelagos lie offshore: east of the easternmost mainland point (Mũi Đôi)
    const easternmost = Math.max(...VN_OUTLINE.map(([lon]) => lon));
    expect(easternmost).toBeCloseTo(109.45, 1);
    for (const [lon] of [...HOANG_SA, ...TRUONG_SA]) expect(lon).toBeGreaterThan(easternmost + 1.5);
  });
});
