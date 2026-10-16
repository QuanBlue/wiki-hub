import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HelpDetailPage } from "@/components/help/help-page";

vi.mock("@/components/help/help-content.en", () => ({
  sectionsEn: [
    {
      id: "only-guide",
      title: "The only guide",
      category: "Account",
      description: "Just one.",
      keywords: [],
      body: <p>Body</p>,
    },
  ],
}));

class QuietObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

describe("A help topic with a single guide", () => {
  it("counts it in the singular", () => {
    vi.stubGlobal("IntersectionObserver", QuietObserver);
    render(<HelpDetailPage topic="Account" />);

    expect(screen.getByText("1 guide")).toBeInTheDocument();
  });
});
