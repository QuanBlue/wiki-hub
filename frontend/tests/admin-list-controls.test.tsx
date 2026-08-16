import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ListFilters, PaginationControls } from "@/components/admin/list-controls";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/users",
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams("q=existing&offset=10"),
}));

describe("admin list controls", () => {
  it("updates a search through the URL and resets pagination", async () => {
    const actor = userEvent.setup();
    render(<ListFilters searchValue="existing" searchPlaceholder="Search users" />);

    const search = screen.getByRole("textbox", { name: "Search users" });
    await actor.clear(search);
    await actor.type(search, "alice");
    await actor.click(screen.getByRole("button", { name: "Search" }));

    expect(navigation.push).toHaveBeenCalledWith("/admin/users?q=alice");
  });

  it("moves to the next server page while keeping active filters", async () => {
    const actor = userEvent.setup();
    render(<PaginationControls total={35} limit={10} offset={10} pageSizes={[10, 25, 50, 100]} />);

    expect(screen.getByText("Showing 11–20 of 35")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Next page" }));

    expect(navigation.push).toHaveBeenCalledWith("/admin/users?q=existing&offset=20");
  });
});
