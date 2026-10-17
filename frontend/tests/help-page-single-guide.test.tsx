import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/ai-summary", () => ({
  aiStatus: () => Promise.resolve({ enabled: false, can_configure: false }),
}));

import { HelpDetailPage, HelpPage } from "@/components/help/help-page";

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

describe("A help topic with a single guide", () => {
  it("counts it in the singular, and has nowhere else to go", async () => {
    render(<HelpDetailPage topic="Account" />);
    await act(async () => {});

    expect(screen.getByText("1 guide")).toBeInTheDocument();
    expect(screen.getByText("guide 1 of 1", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Previous|Next/ })).not.toBeInTheDocument();
  });

  it("lists a topic of few guides without a link to all of them", async () => {
    render(<HelpPage />);
    await act(async () => {});

    expect(screen.queryByRole("link", { name: /All \d+ guides/ })).not.toBeInTheDocument();
  });
});
