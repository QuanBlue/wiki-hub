import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ListFilters, PaginationControls } from "@/components/admin/list-controls";
import { SearchableSelect } from "@/components/ui/searchable-select";

const nav = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/users",
  useRouter: () => ({ push: nav.push }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = "";
});

describe("ListFilters", () => {
  it("searches by typing, after a short pause", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const view = render(<ListFilters searchValue="" searchPlaceholder="Search" />);
      const box = screen.getByRole("textbox", { name: "Search" });
      fireEvent.change(box, { target: { value: "  ann " } });
      expect(nav.push).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(nav.push).toHaveBeenCalledWith("/admin/users?q=ann");

      // Changing it again restarts the wait instead of firing twice.
      nav.push.mockClear();
      fireEvent.change(box, { target: { value: "ann1" } });
      fireEvent.change(box, { target: { value: "ann12" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(nav.push).toHaveBeenCalledTimes(1);

      // Emptying the box clears the filter.
      view.rerender(<ListFilters searchValue="ann12" searchPlaceholder="Search" />);
      nav.push.mockClear();
      fireEvent.change(box, { target: { value: "   " } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(nav.push).toHaveBeenCalledWith("/admin/users");
    } finally {
      vi.useRealTimers();
    }
  });

  it("submits at once and cancels the pending pause", async () => {
    const actor = userEvent.setup();
    render(<ListFilters searchValue="" />);
    await actor.type(screen.getByRole("textbox"), "bob");
    await actor.click(screen.getByRole("button", { name: "Search" }));
    expect(nav.push).toHaveBeenCalledWith("/admin/users?q=bob");
  });

  it("follows the URL when it changes from elsewhere", () => {
    const { rerender } = render(<ListFilters searchValue="one" />);
    expect(screen.getByRole("textbox")).toHaveValue("one");
    rerender(<ListFilters searchValue="two" />);
    expect(screen.getByRole("textbox")).toHaveValue("two");
  });

  it("writes a chosen filter and removes it when set back to all", async () => {
    const actor = userEvent.setup();
    const filters = [
      {
        name: "status",
        label: "Status",
        value: "",
        options: [
          { value: "active", label: "Active" },
          { value: "disabled", label: "Disabled" },
        ],
      },
    ];
    const { rerender } = render(<ListFilters searchValue="" filters={filters} />);
    expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent("Status: all");
    await actor.click(screen.getByRole("button", { name: "Status" }));
    await actor.click(await screen.findByRole("menuitemradio", { name: "Active" }));
    expect(nav.push).toHaveBeenCalledWith("/admin/users?status=active");

    nav.search = "status=active&offset=20";
    rerender(<ListFilters searchValue="" filters={[{ ...filters[0], value: "active" }]} />);
    expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent("Active");
    await actor.click(screen.getByRole("button", { name: "Status" }));
    await actor.click(await screen.findByRole("menuitemradio", { name: "Status: all" }));
    expect(nav.push).toHaveBeenLastCalledWith("/admin/users");
  });

  it("shows an unknown filter value as it is", () => {
    render(
      <ListFilters
        searchValue=""
        filters={[{ name: "role", label: "Role", value: "mystery", options: [] }]}
      />,
    );
    expect(screen.getByRole("button", { name: "Role" })).toHaveTextContent("mystery");
  });
});

describe("PaginationControls", () => {
  it("handles an empty result", () => {
    render(<PaginationControls total={0} limit={10} offset={0} />);
    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.queryByText("Rows per page")).not.toBeInTheDocument();
  });

  it("goes back a page and changes the page size", async () => {
    const actor = userEvent.setup();
    render(<PaginationControls total={95} limit={10} offset={20} pageSizes={[10, 25]} />);
    expect(screen.getByText("Page 3 of 10")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Previous page" }));
    expect(nav.push).toHaveBeenCalledWith("/admin/users?offset=10");

    await actor.click(screen.getByRole("button", { name: "Rows per page" }));
    await actor.click(await screen.findByRole("menuitemradio", { name: "25" }));
    expect(nav.push).toHaveBeenLastCalledWith("/admin/users?limit=25");
  });

  it("never goes below the first page", async () => {
    render(<PaginationControls total={30} limit={25} offset={10} />);
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(nav.push).toHaveBeenCalledWith("/admin/users?offset=0");
  });
});

describe("SearchableSelect", () => {
  const items = [
    { value: "a", label: "Alpha", searchText: "Alpha first" },
    { value: "b", label: "Beta", disabled: true, badge: <i>badge</i> },
    { value: "c", label: "Gamma" },
    { value: "d", label: "Delta" },
  ];

  function renderSelect(props: Partial<React.ComponentProps<typeof SearchableSelect>> = {}) {
    const onValueChange = vi.fn();
    render(
      <SearchableSelect id="pick" items={items} value="" onValueChange={onValueChange} {...props} />,
    );
    return onValueChange;
  }

  const open = async (actor: ReturnType<typeof userEvent.setup>) => {
    await actor.click(document.getElementById("pick")!);
    return screen.findByRole("searchbox");
  };

  it("shows the placeholder or the selected label", () => {
    renderSelect({ placeholder: "Choose…" });
    expect(screen.getByRole("button")).toHaveTextContent("Choose…");
  });

  it("shows the label of the chosen value", () => {
    renderSelect({ value: "c" });
    expect(screen.getByRole("button")).toHaveTextContent("Gamma");
  });

  it("picks an item with the mouse", async () => {
    const actor = userEvent.setup();
    const onValueChange = renderSelect();
    await open(actor);
    expect(screen.getByText("badge")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Gamma" }));
    expect(onValueChange).toHaveBeenCalledWith("c");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("filters on search text and shows the empty message", async () => {
    const actor = userEvent.setup();
    renderSelect({ emptyMessage: "Nothing here" });
    const search = await open(actor);
    await actor.type(search, "first");
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gamma" })).not.toBeInTheDocument();
    await actor.clear(search);
    await actor.type(search, "zzz");
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
  });

  it("navigates with the arrows, skipping disabled rows, and picks with Enter", async () => {
    const actor = userEvent.setup();
    const onValueChange = renderSelect();
    const search = await open(actor);
    fireEvent.keyDown(search, { key: "ArrowDown" }); // skips disabled Beta
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("c");
  });

  it("wraps upwards and ignores Enter on a disabled row", async () => {
    const actor = userEvent.setup();
    const onValueChange = renderSelect();
    const search = await open(actor);
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("d");

    onValueChange.mockClear();
    const second = await open(actor);
    await actor.type(second, "bet");
    fireEvent.keyDown(second, { key: "Enter" });
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.keyDown(second, { key: "x" });
  });

  it("closes on Escape and can be disabled", async () => {
    const actor = userEvent.setup();
    renderSelect();
    const search = await open(actor);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("does not open when disabled", () => {
    renderSelect({ disabled: true, triggerClassName: "x" });
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
