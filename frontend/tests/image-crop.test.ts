import { describe, expect, it } from "vitest";

import { cropGeometry } from "@/lib/image-crop";

describe("cropGeometry", () => {
  it("centers and crops a wide image into a square avatar", () => {
    const crop = cropGeometry(
      { width: 1200, height: 600 },
      { width: 240, height: 240 },
      1,
      { x: 0, y: 0 },
    );
    expect(crop.sourceX).toBe(300);
    expect(crop.sourceY).toBe(0);
    expect(crop.sourceWidth).toBe(600);
    expect(crop.sourceHeight).toBe(600);
  });

  it("keeps a dragged, zoomed cover inside the source image", () => {
    const crop = cropGeometry(
      { width: 1000, height: 500 },
      { width: 400, height: 100 },
      2,
      { x: 999, y: -999 },
    );
    expect(crop.sourceX).toBe(0);
    expect(crop.sourceY).toBe(375);
    expect(crop.sourceWidth).toBe(500);
    expect(crop.sourceHeight).toBe(125);
  });
});
