import { renderHook, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RelatedPages, usePageRelated } from "@/components/pages/related-pages";
import { api } from "@/lib/api-client";
import type { PageRelated } from "@/types/api";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn() },
}));

const related: PageRelated = {
  pages: [
    {
      id: "1",
      title: "Leave request form",
      slug: "leave-request-form",
      space_key: "HR",
      space_name: "People",
      via: ["mention", "similar"],
    },
    {
      id: "2",
      title: "Payroll",
      slug: "payroll",
      space_key: "FIN",
      space_name: "Finance",
      via: ["linked_from"],
    },
  ],
  mentions: [],
};

describe("RelatedPages", () => {
  it("groups related pages by their strongest tie, naming another space", () => {
    render(<RelatedPages related={related} spaceKey="HR" />);

    expect(
      screen.getByRole("heading", { name: "Related pages" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Named on this page")).toBeInTheDocument();
    expect(screen.getByText("Links to this page")).toBeInTheDocument();
    const form = screen.getByRole("link", { name: /Leave request form/ });
    expect(form).toHaveAttribute("href", "/spaces/HR/pages/leave-request-form");
    expect(form).toHaveAttribute(
      "title",
      "Named on this page · Similar content",
    );
    expect(form).not.toHaveTextContent("People");
    const payroll = screen.getByRole("link", { name: /Payroll/ });
    expect(payroll).toHaveTextContent("Finance");
    expect(payroll).toHaveAttribute("title", "Links to this page · in Finance");
  });

  it("shows nothing when there is nothing related, or before it loads", () => {
    const { container, rerender } = render(
      <RelatedPages related={{ pages: [], mentions: [] }} spaceKey="HR" />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<RelatedPages related={null} spaceKey="HR" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("usePageRelated", () => {
  it("ignores an answer that arrives after the page was left", async () => {
    let finish: (value: PageRelated) => void = () => undefined;
    vi.mocked(api.get).mockReturnValueOnce(
      new Promise<PageRelated>((resolve) => {
        finish = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => usePageRelated("HR", "form"));
    unmount();
    finish(related);
    await Promise.resolve();
    expect(result.current).toBeNull();

    let fail: (reason: unknown) => void = () => undefined;
    vi.mocked(api.get).mockReturnValueOnce(
      new Promise<PageRelated>((_resolve, reject) => {
        fail = reject;
      }),
    );
    const second = renderHook(() => usePageRelated("HR", "other"));
    second.unmount();
    fail(new Error("late"));
    await Promise.resolve();
    expect(second.result.current).toBeNull();
  });
});
