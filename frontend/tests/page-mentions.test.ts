import { describe, expect, it } from "vitest";

import { fold, pageHref } from "@/lib/page-mentions";

describe("fold", () => {
  it("folds like the backend: no accents, lower case, đ to d, breaks to spaces", () => {
    expect(fold("Đơn_vị Hỗ-TRỢ")).toBe("don vi ho tro");
    expect(fold("Đơn_vị Hỗ-TRỢ")).toHaveLength("Đơn_vị Hỗ-TRỢ".length);
  });
});

describe("pageHref", () => {
  it("builds the address of a page, escaping the key and slug", () => {
    expect(pageHref("HR", "mau-don")).toBe("/spaces/HR/pages/mau-don");
    expect(pageHref("A B", "x/y")).toBe("/spaces/A%20B/pages/x%2Fy");
  });
});
