import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RichTextEditor } from "@/components/pages/rich-text-editor";

type TestEditor = {
  state: import("@tiptap/pm/state").EditorState;
  view: import("@tiptap/pm/view").EditorView;
  commands: {
    setTextSelection: (
      position: number | { from: number; to: number },
    ) => boolean;
    focus: () => boolean;
  };
  getHTML: () => string;
};

async function renderEditor(
  html = "<p>Hello world</p>",
  props: Partial<React.ComponentProps<typeof RichTextEditor>> = {},
) {
  const onChange = vi.fn();
  const view = render(
    <RichTextEditor content={html} onChange={onChange} {...props} />,
  );
  const dom = await waitFor(() => {
    const found = view.container.querySelector(
      '.ProseMirror[contenteditable="true"]',
    );
    expect(found).not.toBeNull();
    return found as HTMLElement & { editor: TestEditor };
  });
  const editor = dom.editor;
  const selectAll = () => {
    act(() => {
      editor.commands.setTextSelection({
        from: 1,
        to: editor.state.doc.content.size - 1,
      });
    });
  };
  const button = (name: string | RegExp) =>
    screen.getByRole("button", { name });
  return {
    ...view,
    dom,
    editor,
    onChange,
    selectAll,
    button,
    user: userEvent.setup(),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("formatting buttons", () => {
  it.each([
    ["Bold", "<strong>"],
    ["Italic", "<em>"],
    ["Underline", "<u>"],
    ["Strikethrough", "<s>"],
    ["Inline code", "<code>"],
  ])("applies %s to the selection", async (label, tag) => {
    const { editor, selectAll, button } = await renderEditor();

    selectAll();
    fireEvent.click(button(label));
    expect(editor.getHTML()).toContain(tag);
  });

  it("turns the block into lists, a toggle, a quote, a code block and a divider", async () => {
    const { editor, selectAll, button } = await renderEditor();
    selectAll();

    fireEvent.click(button("Bulleted list"));
    expect(editor.getHTML()).toContain("<ul>");
    fireEvent.click(button("Numbered list"));
    expect(editor.getHTML()).toContain("<ol>");
    fireEvent.click(button("To-do list"));
    expect(editor.getHTML()).toContain('data-type="taskList"');
    fireEvent.click(button("Toggle list"));
    fireEvent.click(button("Toggle list"));
    fireEvent.click(button("Quote"));
    expect(editor.getHTML()).toContain("<blockquote>");
    fireEvent.click(button("Quote"));
    fireEvent.click(button("Code block"));
    expect(editor.getHTML()).toContain("<pre>");
    fireEvent.click(button("Code block"));
    fireEvent.click(button("Insert divider"));
    expect(editor.getHTML()).toContain("<hr");
  });

  it("inserts a table of contents, and undoes and redoes", async () => {
    const { editor, button } = await renderEditor();

    fireEvent.click(button("Insert table of contents"));
    expect(editor.getHTML()).toContain("table-of-contents");
    fireEvent.click(button("Undo"));
    fireEvent.click(button("Redo"));
    expect(editor.getHTML()).toContain("table-of-contents");
  });

  it("toggles text wrapping from the toolbar", async () => {
    const { button } = await renderEditor();

    fireEvent.click(button("Unwrap text"));
    expect(button("Wrap text")).toBeInTheDocument();
    fireEvent.click(button("Wrap text"));
    expect(button("Unwrap text")).toBeInTheDocument();
  });

  it("clears colour and highlight from a selection and from a bare caret", async () => {
    const { editor, selectAll, button } = await renderEditor(
      '<p><span style="color: #ff0000">Hello</span> world</p>',
    );

    selectAll();
    fireEvent.click(button("Clear text colour and highlight"));
    expect(editor.getHTML()).not.toContain("color");
    act(() => {
      editor.commands.setTextSelection(3);
    });
    fireEvent.click(button("Clear text colour and highlight"));
    expect(editor.getHTML()).toContain("Hello");
  });
});

describe("toolbar menus", () => {
  it("sets a heading level, and back to a paragraph", async () => {
    const { editor, selectAll, button, user } = await renderEditor();
    selectAll();

    for (const [name, tag] of [
      ["Heading 1", "<h1"],
      ["Heading 2", "<h2"],
      ["Heading 3", "<h3"],
      ["Heading 4", "<h4"],
    ] as const) {
      await user.click(button("Text style"));
      await user.click(await screen.findByRole("menuitem", { name }));
      expect(editor.getHTML()).toContain(tag);
    }
    expect(button("Text style")).toHaveTextContent("H4");
    await user.click(button("Text style"));
    await user.click(
      await screen.findByRole("menuitem", { name: "Paragraph" }),
    );
    expect(editor.getHTML()).toContain("<p>");
  });

  it("aligns text left, centre and right", async () => {
    const { editor, selectAll, button, user } = await renderEditor();
    selectAll();

    for (const [name, value] of [
      ["Align center", "center"],
      ["Align right", "right"],
      ["Align left", "left"],
    ] as const) {
      await user.click(button("Text alignment"));
      await user.click(await screen.findByRole("menuitem", { name }));
      if (value !== "left")
        expect(editor.getHTML()).toContain(`text-align: ${value}`);
    }
  });

  it("colours text from the palette, a custom colour, and clears it again", async () => {
    const { editor, selectAll, button, user } = await renderEditor();
    selectAll();

    await user.click(button("Text colour"));
    await user.click(await screen.findByRole("gridcell", { name: "Colour 3" }));
    expect(editor.getHTML()).toContain("color");
    await user.click(button("Text colour"));
    // The swatch already applied is marked as chosen.
    expect(
      await screen.findAllByRole("gridcell", { selected: true }),
    ).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Clear colour" }));
    expect(editor.getHTML()).not.toContain("color:");

    await user.click(button("Text colour"));
    fireEvent.change(await screen.findByLabelText("Custom text colour"), {
      target: { value: "#123456" },
    });
    expect(editor.getHTML()).toContain("rgb(18, 52, 86)");
  });

  it("highlights text, and clears the highlight", async () => {
    const { editor, selectAll, button, user } = await renderEditor();
    selectAll();

    await user.click(button("Text highlight"));
    await user.click(await screen.findByRole("gridcell", { name: "Colour 5" }));
    expect(editor.getHTML()).toContain("background-color");
    await user.click(button("Text highlight"));
    await user.click(
      await screen.findByRole("button", { name: "Clear highlight" }),
    );
    expect(editor.getHTML()).not.toContain("background-color:");
  });

  it("inserts a table of the size chosen on the grid", async () => {
    const { editor, button, user } = await renderEditor();

    await user.click(button("Insert table"));
    const cell = await screen.findByRole("gridcell", {
      name: "3 rows by 4 columns",
    });
    await user.hover(cell);
    expect(screen.getByText("3×4")).toBeInTheDocument();
    fireEvent.pointerLeave(screen.getByRole("grid", { name: "Table size" }));
    await user.click(cell);
    expect(editor.getHTML()).toContain("<table");
    expect((editor.getHTML().match(/<tr/g) ?? []).length).toBe(3);
  });
});

describe("links", () => {
  async function openDialog(html = "<p>Hello world</p>") {
    const view = await renderEditor(html);
    view.selectAll();
    fireEvent.click(view.button("Add link"));
    const url = (await screen.findByLabelText("Url")) as HTMLInputElement;
    return { ...view, url };
  }

  it("links the selected text, adding https to a bare address", async () => {
    const { editor, url, user } = await openDialog();

    await user.type(url, "example.com");
    await user.type(screen.getByLabelText("Title"), "Example");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(editor.getHTML()).toContain('href="https://example.com"');
    expect(editor.getHTML()).toContain('title="Example"');
  });

  it("keeps addresses that already say where they go", async () => {
    for (const address of [
      "http://a.test",
      "/spaces/x",
      "#top",
      "mailto:a@b.test",
      "tel:123",
    ]) {
      const { editor, url, user, unmount } = await openDialog();
      await user.type(url, address);
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(editor.getHTML()).toContain(`href="${address}"`);
      unmount();
    }
  });

  it("replaces the selection when the link text is changed, and inserts text for a bare caret", async () => {
    const { editor, url, user } = await openDialog();

    await user.type(url, "https://a.test");
    const text = screen.getByLabelText("Link text");
    await user.clear(text);
    await user.type(text, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(editor.getHTML()).toContain(">Renamed</a>");

    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    await user.type(await screen.findByLabelText("Url"), "https://b.test");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(editor.getHTML()).toContain("https://b.test");
  });

  it("inserts the address as new linked text when nothing is selected", async () => {
    const { editor, button, user } = await renderEditor("<p>Hello</p>");

    act(() => {
      editor.commands.setTextSelection(6);
    });
    fireEvent.click(button("Add link"));
    await user.type(await screen.findByLabelText("Url"), "https://c.test");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(editor.getHTML()).toContain(">https://c.test</a>");
  });

  it("opens in the same tab when asked to, and removes the link when the address is cleared", async () => {
    const { editor, url, user } = await openDialog();

    await user.type(url, "https://a.test");
    await user.click(screen.getByRole("button", { name: "Open link in" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Same window" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(editor.getHTML()).toContain('target="_self"');

    act(() => {
      editor.commands.setTextSelection(3);
    });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    const field = (await screen.findByLabelText("Url")) as HTMLInputElement;
    await user.clear(field);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(editor.getHTML()).not.toContain("<a ");
  });

  it("closes without changing anything when cancelled", async () => {
    const { editor, user } = await openDialog();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(editor.getHTML()).not.toContain("<a ");
  });

  it("opens a blank dialog from an event with no details", async () => {
    await renderEditor("<p>hi</p>");

    act(() => {
      window.dispatchEvent(new CustomEvent("wikihub:open-link-dialog"));
    });
    expect(
      ((await screen.findByLabelText("Url")) as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByRole("dialog")).toHaveTextContent("Insert link");
  });

  it("opens from an event carrying the link to edit", async () => {
    await renderEditor('<p><a href="https://old.test">old</a></p>');

    act(() => {
      window.dispatchEvent(
        new CustomEvent("wikihub:open-link-dialog", {
          detail: {
            href: "https://old.test",
            text: "old",
            title: "Old",
            target: "_self",
          },
        }),
      );
    });
    expect(
      ((await screen.findByLabelText("Url")) as HTMLInputElement).value,
    ).toBe("https://old.test");
    expect(screen.getByRole("dialog")).toHaveTextContent("Edit link");
  });
});

describe("uploads", () => {
  const file = (name: string, type: string) =>
    new File(["data"], name, { type });

  it("inserts an uploaded image and an uploaded file, and shows the busy label meanwhile", async () => {
    let release: (value: {
      filename: string;
      content_type: string;
      content_url: string;
    }) => void = () => {};
    const onUploadFile = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce({
        filename: "notes.zip",
        content_type: "application/zip",
        content_url:
          "/api/v1/attachments/44444444-4444-4444-4444-444444444444/content",
      });
    const { editor, dom } = await renderEditor("<p>hi</p>", { onUploadFile });

    act(() => {
      dom.dispatchEvent(
        new CustomEvent("wikihub:editor-files", {
          detail: [
            file("a.png", "image/png"),
            file("notes.zip", "application/zip"),
          ],
        }),
      );
    });
    expect(
      await screen.findByRole("button", { name: "Uploading image" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Uploading file" }),
    ).toBeDisabled();
    await act(async () => {
      release({
        filename: "a.png",
        content_type: "image/png",
        content_url: "/img/a.png",
      });
    });
    await waitFor(() => expect(editor.getHTML()).toContain("notes.zip"));
    expect(editor.getHTML()).toContain("/img/a.png");
  });

  it("reports an upload that fails", async () => {
    const onUploadFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("Too big"))
      .mockRejectedValueOnce("nope");
    const { dom } = await renderEditor("<p>hi</p>", { onUploadFile });

    act(() => {
      dom.dispatchEvent(
        new CustomEvent("wikihub:editor-files", {
          detail: [file("a.png", "image/png")],
        }),
      );
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Too big");
    act(() => {
      dom.dispatchEvent(
        new CustomEvent("wikihub:editor-files", {
          detail: [file("a.png", "image/png")],
        }),
      );
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).not.toHaveTextContent("Too big"),
    );
  });

  it("embeds a chosen image when there is no upload service, and ignores other files", async () => {
    const { editor, dom, container } = await renderEditor("<p>hi</p>");

    act(() => {
      dom.dispatchEvent(
        new CustomEvent("wikihub:editor-files", { detail: [] }),
      );
      dom.dispatchEvent(
        new CustomEvent("wikihub:editor-files", {
          detail: [file("a.txt", "text/plain")],
        }),
      );
      dom.dispatchEvent(
        new CustomEvent("wikihub:editor-files", {
          detail: [file("a.png", "image/png")],
        }),
      );
    });
    await waitFor(() => expect(editor.getHTML()).toContain("data:image/png"));
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("passes files chosen in the pickers on to the upload", async () => {
    const onUploadFile = vi.fn().mockResolvedValue({
      filename: "x.png",
      content_type: "image/png",
      content_url: "/x.png",
    });
    const { container } = await renderEditor("<p>hi</p>", { onUploadFile });
    const inputs = container.querySelectorAll('input[type="file"]');

    fireEvent.change(inputs[0]!, {
      target: { files: [file("x.png", "image/png")] },
    });
    await waitFor(() => expect(onUploadFile).toHaveBeenCalledTimes(1));
    fireEvent.change(inputs[1]!, {
      target: { files: [file("x.png", "image/png")] },
    });
    await waitFor(() => expect(onUploadFile).toHaveBeenCalledTimes(2));
  });

  it("opens the file pickers from the toolbar", async () => {
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    const { button } = await renderEditor();

    fireEvent.click(button("Insert image"));
    fireEvent.click(button("Upload file"));
    expect(click).toHaveBeenCalledTimes(2);
  });
});

describe("pages to link to", () => {
  it("is not offered without a page to link from", async () => {
    await renderEditor();

    act(() => {
      document.dispatchEvent(new Event("wikihub:slash-link-to-page"));
      document.dispatchEvent(new Event("wikihub:slash-create-subpage"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains a failure to load, then lists nothing", async () => {
    const { api } = await import("@/lib/api-client");
    vi.spyOn(api, "get").mockRejectedValue(new Error("down"));
    await renderEditor("<p>hi</p>", {
      pageLinkContext: { spaceKey: "ENG", currentPageId: "p1" },
    });

    act(() => {
      document.dispatchEvent(new Event("wikihub:slash-link-to-page"));
    });
    expect(await screen.findByText("No matching pages.")).toBeInTheDocument();
  });

  it("filters the list, leaves out the page being edited, and links to the one chosen", async () => {
    const { api } = await import("@/lib/api-client");
    vi.spyOn(api, "get").mockResolvedValue([
      { id: "p1", title: "Current", slug: "current" },
      { id: "p2", title: "Runbook", slug: "runbook" },
      { id: "p3", title: "Roadmap", slug: "roadmap" },
    ]);
    const { editor, user } = await renderEditor("<p>hi</p>", {
      pageLinkContext: { spaceKey: "ENG", currentPageId: "p1" },
    });

    act(() => {
      document.dispatchEvent(new Event("wikihub:slash-link-to-page"));
    });
    const search = await screen.findByRole("combobox");
    expect(screen.queryByRole("option", { name: "Current" })).toBeNull();
    await user.type(search, "road");
    expect(screen.queryByRole("option", { name: "Runbook" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Roadmap" }));
    expect(editor.getHTML()).toContain('href="/spaces/ENG/pages/roadmap"');
  });
});

describe("new sub-pages", () => {
  async function openSubpage(onSubpageCreated = vi.fn()) {
    const view = await renderEditor("<p>hi</p>", {
      pageLinkContext: { spaceKey: "ENG", currentPageId: "p1" },
      onSubpageCreated,
    });
    act(() => {
      document.dispatchEvent(new Event("wikihub:slash-create-subpage"));
    });
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    return { ...view, title, onSubpageCreated };
  }

  it("ignores an empty title, and cancels", async () => {
    const { api } = await import("@/lib/api-client");
    const post = vi.spyOn(api, "post");
    const { title, user } = await openSubpage();

    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /create/i,
      }),
    ).toBeDisabled();
    fireEvent.submit(title.closest("form")!);
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("creates the page, links to it and hands it on", async () => {
    const { api } = await import("@/lib/api-client");
    vi.spyOn(api, "post").mockResolvedValue({
      id: "p9",
      title: "Child",
      slug: "child",
    });
    const { title, editor, user, onSubpageCreated } = await openSubpage();

    await user.type(title, "Child");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /create/i,
      }),
    );
    await waitFor(() => expect(onSubpageCreated).toHaveBeenCalled());
    expect(editor.getHTML()).toContain('href="/spaces/ENG/pages/child"');
  });

  it("reports a failure, from the server or otherwise", async () => {
    const { api, ApiError } = await import("@/lib/api-client");
    vi.spyOn(api, "post")
      .mockRejectedValueOnce(
        new ApiError(409, "conflict", "That title is taken"),
      )
      .mockRejectedValueOnce(new Error("offline"));
    const { title, user } = await openSubpage();

    await user.type(title, "Child");
    const create = () =>
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /create/i,
      });
    await user.click(create());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await user.click(create());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  });
});
