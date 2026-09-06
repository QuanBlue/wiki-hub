import { describe, expect, it } from "vitest";

import { spaceTabTitle } from "@/lib/space-tab-title";

describe("spaceTabTitle", () => {
  it("returns the name unchanged when it is already plain ASCII", () => {
    expect(spaceTabTitle("Engineering", "ENG")).toBe("Engineering");
  });

  it("strips Vietnamese diacritics down to their base Latin letters", () => {
    expect(spaceTabTitle("Kỹ thuật", "KT")).toBe("Ky thuat");
  });

  it("maps đ/Đ to d/D - normalize(NFD) alone does not decompose them", () => {
    expect(spaceTabTitle("Đội ngũ", "DN")).toBe("Doi ngu");
  });

  it("trims surrounding whitespace", () => {
    expect(spaceTabTitle("  Sales  ", "SALES")).toBe("Sales");
  });

  it("falls back to the upper-cased space key when the name reduces to nothing", () => {
    expect(spaceTabTitle("   ", "eng")).toBe("ENG");
    expect(spaceTabTitle("́̀", "eng")).toBe("ENG");
  });
});
