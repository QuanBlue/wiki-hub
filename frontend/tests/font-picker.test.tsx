import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FontPicker } from "@/components/admin/font-picker";
import { FONT_CATEGORIES, FONT_PRESETS } from "@/lib/font-presets";

/** A viewport of the given width: the picker reads it to know how many cards share a row. */
function viewport(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: Number(/min-width:\s*(\d+)px/u.exec(query)?.[1] ?? 0) <= width,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => vi.unstubAllGlobals());

const cards = () =>
  screen
    .getAllByRole("button", { pressed: false })
    .concat(screen.queryAllByRole("button", { pressed: true }))
    .filter(
      (el) => el.getAttribute("role") === "button" && el.tagName === "DIV",
    );

function render3Wide(value = "inter") {
  viewport(1400);
  return render(
    <FontPicker value={value} onChange={vi.fn()} onInspect={vi.fn()} />,
  );
}

describe("FONT_PRESETS ordering", () => {
  it("keeps fonts of one type together, in the filter's order, with the default first", () => {
    const order = FONT_PRESETS.map((preset) =>
      FONT_CATEGORIES.indexOf(preset.category),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(FONT_PRESETS[0].id).toBe("inter");
  });
});

describe("FontPicker", () => {
  it("shows three rows of cards, then the rest on Show more", async () => {
    const user = userEvent.setup();
    render3Wide();

    expect(cards()).toHaveLength(9); // 3 rows x 3 columns
    const more = screen.getByRole("button", {
      name: `Show ${FONT_PRESETS.length - 9} more`,
    });
    await user.click(more);

    expect(cards()).toHaveLength(FONT_PRESETS.length);
    await user.click(screen.getByRole("button", { name: "Show less" }));
    expect(cards()).toHaveLength(9);
  });

  it("shows fewer cards on a narrower screen, so it is still three rows", () => {
    viewport(800); // two per row
    render(<FontPicker value="inter" onChange={vi.fn()} onInspect={vi.fn()} />);

    expect(cards()).toHaveLength(6);
  });

  it("filters by type, with counts, and has no Show more when a type fits in three rows", async () => {
    const user = userEvent.setup();
    render3Wide();
    const serifCount = FONT_PRESETS.filter(
      (preset) => preset.category === "Serif",
    ).length;

    const filter = within(
      screen.getByRole("group", { name: "Filter fonts by type" }),
    );
    await user.click(
      filter.getByRole("button", {
        name: new RegExp(`^Serif ${serifCount}$`, "u"),
      }),
    );

    expect(cards()).toHaveLength(serifCount);
    expect(screen.queryByRole("button", { name: /Show .* more/u })).toBeNull();
    for (const card of cards()) {
      expect(within(card).getByText("Serif")).toBeInTheDocument();
    }
  });

  it("starts from the short list again after changing the filter", async () => {
    const user = userEvent.setup();
    render3Wide();

    await user.click(screen.getByRole("button", { name: /^Show \d+ more$/u }));
    expect(cards()).toHaveLength(FONT_PRESETS.length);
    const filter = within(
      screen.getByRole("group", { name: "Filter fonts by type" }),
    );
    await user.click(filter.getByRole("button", { name: /^All /u }));

    expect(cards()).toHaveLength(9);
  });

  it("picks a font on click and opens the specimen without picking it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onInspect = vi.fn();
    viewport(1400);
    render(
      <FontPicker value="inter" onChange={onChange} onInspect={onInspect} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Inspect Roboto font specimen" }),
    );
    expect(onInspect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "roboto" }),
    );
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByText("Open Sans"));
    expect(onChange).toHaveBeenCalledWith("open-sans");
  });
});
