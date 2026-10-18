import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ViewMutationRecord } from "@tiptap/pm/view";

import {
  ignoreNodeViewChrome,
  RichTextContent,
  RichTextEditor,
} from "@/components/pages/rich-text-editor";

async function openCodeBlockDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "Code block options" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: /edit/i }));
}

describe("imported styles round-trip through the document", () => {
  const html =
    '<table><tbody><tr><td style="background-color: #ffeecc; text-align: center; color: #336699; font-size: 20px; width: 40%"><p>cell</p></td>' +
    '<td><p><span style="background-color: #eeeeee; font-size: 18px; font-family: Courier New; color: #cc0000">styled</span></p></td></tr>' +
    '<tr style="height: 80px"><td><p>row</p></td><td><p><span style="font-family: monospace">mono</span></p></td></tr></tbody></table>';

  it("keeps cell and text styling in the reader", async () => {
    const { container } = render(<RichTextContent content={html} />);

    const cell = (await screen.findByText("cell")).closest("td") as HTMLElement;
    expect(cell.style.backgroundColor).not.toBe("");
    expect(cell.style.textAlign).toBe("center");
    expect(cell.style.fontSize).toBe("20px");
    expect(cell.style.width).toBe("40%");
    const styled = (await screen.findByText("styled")) as HTMLElement;
    expect(styled.style.backgroundColor).not.toBe("");
    expect(styled.style.fontSize).toBe("18px");
    expect(styled.style.fontFamily).toContain("Courier New");
    expect(container.querySelectorAll("tr")[1]).toHaveStyle({ height: "80px" });
  });

  it("writes the same styling back when the editor saves", async () => {
    const onChange = vi.fn();
    const view = render(<RichTextEditor content={html} onChange={onChange} />);

    const { container } = view;
    await screen.findByText("mono");
    fireEvent.input(container.querySelector(".ProseMirror") as HTMLElement, {
      target: { innerHTML: `${html}<p>edited</p>` },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = onChange.mock.calls.at(-1)![0] as string;
    expect(saved).toContain("background-color");
    expect(saved).toContain("font-family");
    expect(saved).toContain("width: 40%");
  });
});

describe("code block details", () => {
  it("previews a title with no language, and a blank line in the snippet", async () => {
    const user = userEvent.setup();
    render(
      <RichTextEditor
        content="<pre><code>one\n\nthree</code></pre>"
        onChange={vi.fn()}
      />,
    );

    await openCodeBlockDetails(user);
    await user.type(await screen.findByLabelText("Title"), "notes");
    expect(screen.getAllByText("notes").length).toBeGreaterThan(0);
  });

  it("copes with a snippet that ends in a line break", async () => {
    const { container } = render(
      <RichTextEditor
        content="<pre><code>one\n</code></pre>"
        onChange={vi.fn()}
      />,
    );

    await screen.findByRole("button", { name: "Code block options" });
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("opens the language list from the keyboard and closes it on Enter", async () => {
    const user = userEvent.setup();
    render(
      <RichTextEditor
        content='<pre><code class="language-bash">echo hi</code></pre>'
        onChange={vi.fn()}
      />,
    );

    await openCodeBlockDetails(user);
    const trigger = await screen.findByRole("button", {
      name: "Code language",
    });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    const filter = await screen.findByRole("combobox");
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(trigger).toHaveFocus();

    // Other keys on the trigger leave the list shut.
    await user.keyboard("a");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(filter).not.toBeInTheDocument();
  });

  it("starts from either end of the list when the filter hides the current language", async () => {
    const user = userEvent.setup();
    render(
      <RichTextEditor
        content='<pre><code class="language-bash">echo hi</code></pre>'
        onChange={vi.fn()}
      />,
    );

    await openCodeBlockDetails(user);
    await user.click(
      await screen.findByRole("button", { name: "Code language" }),
    );
    const filter = await screen.findByRole("combobox");

    // A filter nothing matches has nothing to move through.
    await user.type(filter, "zzzz");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByText("No matching language")).toBeInTheDocument();

    await user.clear(filter);
    await user.type(filter, "script");
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    const chosen = () =>
      screen
        .getAllByRole("option")
        .findIndex((o) => o.getAttribute("aria-selected") === "true");
    // The filter has already moved the choice to the top match; step off it and back to wrap around.
    await user.keyboard("{ArrowUp}");
    expect(chosen()).toBe(screen.getAllByRole("option").length - 1);
    await user.keyboard("{ArrowDown}");
    expect(chosen()).toBe(0);
  });
});

describe("table row preview", () => {
  it("keeps a dragged row's height through the editor's own redraw", async () => {
    const { container } = render(
      <RichTextEditor
        content="<table><tbody><tr><td>First</td><td>Value</td></tr><tr><td>Second</td><td>Value</td></tr></tbody></table>"
        onChange={vi.fn()}
      />,
    );
    const row = (await waitFor(() => {
      const found = container.querySelector("tr");
      expect(found).not.toBeNull();
      return found;
    })) as HTMLTableRowElement;

    row.style.height = "90px";
    // The editor watches the DOM; its own row height change is not an edit to undo.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(row.style.height).toBe("90px");
    fireEvent.mouseUp(window);
  });
});

describe("list and header styles", () => {
  it("keeps a list item's alignment, and a header's width", async () => {
    const { container } = render(
      <RichTextContent
        content={
          '<ul><li style="text-align: center"><p>centred</p></li><li><p>plain</p></li></ul>' +
          '<table><tbody><tr><th style="width: 30%"><p>head</p></th><th><p>other</p></th></tr></tbody></table>'
        }
      />,
    );

    await screen.findByText("centred");
    const items = container.querySelectorAll("li");
    expect((items[0] as HTMLElement).style.textAlign).toBe("center");
    expect((items[1] as HTMLElement).style.textAlign).toBe("");
    expect((container.querySelector("th") as HTMLElement).style.width).toBe(
      "30%",
    );
  });
});

describe("callouts", () => {
  it.each([
    [
      "info",
      '<div data-type="callout" data-callout-type="info"><p>c</p></div>',
    ],
    [
      "warning",
      '<div data-type="callout" data-callout-type="warning"><p>c</p></div>',
    ],
    ["info", '<div class="callout"><p>c</p></div>'],
    ["note", '<div class="callout note"><p>c</p></div>'],
    ["tip", '<div class="callout tip"><p>c</p></div>'],
    ["panel", '<div class="callout panel"><p>c</p></div>'],
    [
      "warning",
      '<div class="confluence-information-macro warning"><p>c</p></div>',
    ],
  ])("renders a %s callout around its content", async (type, html) => {
    const { container } = render(<RichTextContent content={html} />);

    await screen.findByText("c");
    // The node view puts an icon beside the content, which a plain div would not have.
    expect(
      container.querySelector("[data-node-view-wrapper] svg"),
    ).not.toBeNull();
    expect(type).toBeTruthy();
  });
});

describe("ignoreNodeViewChrome", () => {
  /**
   * A node view the way Tiptap builds one: its root (`react-renderer`) holds React's frame,
   * and inside that the editable content element it moves in.
   */
  function nodeView() {
    document.body.innerHTML = `
      <div class="react-renderer node-callout" id="view">
        <div data-node-view-wrapper id="frame">
          <span id="icon"></span>
          <div data-node-view-content id="slot">
            <div data-node-view-content-react data-node-view-wrapper id="content"><p id="text">Hi</p></div>
          </div>
        </div>
      </div>`;
    const el = (id: string) => document.getElementById(id)!;
    return { el };
  }
  const change = (
    over: Partial<{ type: string; target: Node; addedNodes: Node[]; removedNodes: Node[] }>,
  ) =>
    ({
      type: "childList",
      target: document.body,
      addedNodes: [],
      removedNodes: [],
      ...over,
    }) as unknown as ViewMutationRecord;

  it("lets ProseMirror see selection changes", () => {
    nodeView();
    expect(ignoreNodeViewChrome({ mutation: { type: "selection", target: document.body } as ViewMutationRecord })).toBe(false);
  });

  it("ignores React drawing the frame, which Android would read as an Enter", () => {
    const { el } = nodeView();
    expect(ignoreNodeViewChrome({ mutation: change({ target: el("view"), addedNodes: [el("frame")] }) })).toBe(true);
    expect(ignoreNodeViewChrome({ mutation: change({ target: el("frame"), addedNodes: [el("icon")] }) })).toBe(true);
  });

  it("ignores Tiptap moving the content element into the frame", () => {
    const { el } = nodeView();
    expect(ignoreNodeViewChrome({ mutation: change({ target: el("slot"), addedNodes: [el("content")] }) })).toBe(true);
    expect(ignoreNodeViewChrome({ mutation: change({ target: el("slot"), removedNodes: [el("content")] }) })).toBe(true);
  });

  it("leaves everything inside the editable content to ProseMirror", () => {
    const { el } = nodeView();
    const typed = document.createTextNode("x");
    expect(ignoreNodeViewChrome({ mutation: change({ target: el("content"), addedNodes: [typed] }) })).toBe(false);
    expect(ignoreNodeViewChrome({ mutation: change({ target: el("text").firstChild!, type: "characterData" }) })).toBe(false);
    expect(ignoreNodeViewChrome({ mutation: change({ target: el("content"), addedNodes: [el("icon")] }) })).toBe(false);
  });

  it("keeps a node view inside another one apart from its parent's content", () => {
    document.body.innerHTML = `
      <div class="react-renderer" id="outer">
        <div data-node-view-content data-node-view-wrapper>
          <div data-node-view-content-react id="outer-content">
            <div class="react-renderer" id="inner"><div id="inner-frame"></div></div>
          </div>
        </div>
      </div>`;
    const inner = document.getElementById("inner")!;
    // The inner callout's frame sits inside the outer one's content, but is the inner's own chrome.
    expect(
      ignoreNodeViewChrome({
        mutation: change({ target: inner, addedNodes: [document.getElementById("inner-frame")!] }),
      }),
    ).toBe(true);
  });

  it("ignores a change with no element to place", () => {
    expect(ignoreNodeViewChrome({ mutation: change({ target: document.createTextNode("") }) })).toBe(true);
  });
});
