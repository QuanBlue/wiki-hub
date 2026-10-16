import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PeoplePicker } from "@/components/issues/people-picker";

const OPTIONS = [
  { value: "alice", primary: "alice", secondary: "Alice Nguyen" },
  { value: "bob", primary: "bob" },
];

function setup() {
  const onPick = vi.fn();
  render(
    <PeoplePicker
      trigger="Author"
      title="Filter by author"
      filterPlaceholder="Filter people"
      noMatch="Nobody matches"
      options={OPTIONS}
      selected={null}
      onPick={onPick}
    />,
  );
  return { onPick, user: userEvent.setup() };
}

describe("PeoplePicker", () => {
  it("closes on Escape without picking anyone", async () => {
    const { onPick, user } = setup();

    await user.click(screen.getByRole("button", { name: /Author/ }));
    await screen.findByRole("combobox", { name: "Filter by author" });
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("says when nobody matches the filter, and ignores the arrows and Enter", async () => {
    const { onPick, user } = setup();

    await user.click(screen.getByRole("button", { name: /Author/ }));
    await user.type(await screen.findByRole("combobox"), "zzz");
    expect(screen.getByText("Nobody matches")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");

    expect(onPick).not.toHaveBeenCalled();
  });

  it("picks the highlighted person with Enter, matching on the full name too", async () => {
    const { onPick, user } = setup();

    await user.click(screen.getByRole("button", { name: /Author/ }));
    await user.type(await screen.findByRole("combobox"), "nguyen");
    await user.keyboard("{Enter}");

    expect(onPick).toHaveBeenCalledWith("alice");
  });
});
