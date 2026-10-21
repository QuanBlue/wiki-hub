import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PageMapButton } from "@/components/admin/page-map-button";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe("PageMapButton", () => {
  it("opens the map of every space", async () => {
    vi.mocked(api.get).mockResolvedValue({
      spaces: [],
      nodes: [],
      edges: [],
      total_pages: 0,
      insights: { orphans: [], bridges: [], sparse_groups: [] },
    });
    render(<PageMapButton />);

    await userEvent.click(screen.getByRole("button", { name: "Page map" }));

    expect(await screen.findByText("Page map - all spaces")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/api/v1/graph");
  });
});
