import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Pagination, pageWindow } from "@/components/ui/pagination";

describe("pageWindow", () => {
  it("keeps first, last and the neighbours of the current page", () => {
    expect(pageWindow(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });
});

describe("Pagination", () => {
  it("renders nothing for a single page", () => {
    const { container } = render(
      <Pagination
        page={1}
        pageCount={1}
        previousLabel="Previous"
        nextLabel="Next"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("goes to the page that is clicked and disables Previous on page 1", async () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        page={1}
        pageCount={4}
        onPageChange={onPageChange}
        previousLabel="Previous"
        nextLabel="Next"
      />,
    );
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("button", { name: "2" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
