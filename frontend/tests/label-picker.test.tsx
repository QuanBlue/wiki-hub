import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { LabelPicker } from "@/components/issues/label-picker";

function Harness({
  initial = [],
  ...props
}: { initial?: string[] } & Partial<React.ComponentProps<typeof LabelPicker>>) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <>
      <span data-testid="selected">{selected.join(",")}</span>
      <LabelPicker selected={selected} onChange={setSelected} title="Labels" {...props} />
    </>
  );
}

const selected = () => screen.getByTestId("selected").textContent;
const open = async (actor: ReturnType<typeof userEvent.setup>) => {
  await actor.click(screen.getByRole("button", { name: /Labels/ }));
  return screen.findByRole("listbox");
};

describe("LabelPicker", () => {
  it("lists every label, ticks several in a row and counts them", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    await open(actor);
    expect(screen.getAllByRole("option")).toHaveLength(6);
    await actor.click(screen.getByRole("option", { name: /bug/ }));
    await actor.click(screen.getByRole("option", { name: /documentation/ }));
    expect(selected()).toBe("bug,documentation");
    expect(screen.getByRole("button", { name: /Labels/ })).toHaveTextContent("2");
    await actor.click(screen.getByRole("option", { name: /bug/ }));
    expect(selected()).toBe("documentation");
  });

  it("offers a No labels row that excludes every real label, and vice versa", async () => {
    const actor = userEvent.setup();
    render(<Harness allowNone initial={["bug"]} />);
    await open(actor);
    expect(screen.getAllByRole("option")).toHaveLength(7);

    await actor.click(screen.getAllByRole("option")[0]);
    expect(selected()).toBe("none");
    await actor.click(screen.getByRole("option", { name: /question/ }));
    expect(selected()).toBe("question");
    await actor.click(screen.getAllByRole("option")[0]);
    await actor.click(screen.getAllByRole("option")[0]);
    expect(selected()).toBe("");
  });

  it("filters by name or description and shows an empty state", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    await open(actor);
    const search = screen.getByRole("combobox");
    await actor.type(search, "bug");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await actor.clear(search);
    await actor.type(search, "improvements");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    await actor.clear(search);
    await actor.type(search, "zzzz");
    expect(screen.getByText("No labels match.")).toBeInTheDocument();
    // Arrow keys and Enter do nothing with an empty list.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(selected()).toBe("");
  });

  it("works from the keyboard: arrows wrap, Enter toggles, Escape closes", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    await open(actor);
    const search = screen.getByRole("combobox");
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(selected()).toBe("question");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(selected()).toBe("question,bug");
    fireEvent.keyDown(search, { key: "a" });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("highlights the row under the pointer, and resets when reopened", async () => {
    const actor = userEvent.setup();
    render(<Harness />);
    await open(actor);
    const rows = screen.getAllByRole("option");
    await actor.hover(rows[3]);
    expect(rows[3]).toHaveClass("bg-surface-hover");
    await actor.type(screen.getByRole("combobox"), "q");
    await actor.keyboard("{Escape}");
    await open(actor);
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("supports a custom trigger, and can be disabled", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <LabelPicker selected={[]} onChange={onChange} title="Labels" trigger={<b>Pick</b>} triggerClassName="x" align="end" />,
    );
    expect(screen.getByText("Pick")).toBeInTheDocument();
    rerender(<LabelPicker selected={[]} onChange={onChange} title="Labels" disabled />);
    expect(screen.getByRole("button", { name: /Labels/ })).toBeDisabled();
  });
});
