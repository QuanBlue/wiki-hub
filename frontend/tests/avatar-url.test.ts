import { describe, expect, it } from "vitest";

import { resolveAvatarUrl } from "@/components/ui/avatar";

describe("resolveAvatarUrl", () => {
  it("routes backend avatar links through the app proxy", () => {
    expect(resolveAvatarUrl(" https://backend:8000/api/v1/users/alice/avatar ")).toBe(
      "/api/v1/users/alice/avatar",
    );
    expect(resolveAvatarUrl("  ")).toBeNull();
    expect(resolveAvatarUrl("https://cdn.example/avatar.png")).toBe(
      "https://cdn.example/avatar.png",
    );
  });
});
