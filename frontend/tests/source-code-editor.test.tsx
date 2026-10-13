import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SourceCodeEditor } from "@/components/pages/source-code-editor";

const m = vi.hoisted(() => ({ format: vi.fn(), toastError: vi.fn() }));
vi.mock("prettier/standalone", () => ({ format: m.format }));
vi.mock("prettier/plugins/html", () => ({ default: {} }));
vi.mock("sonner", () => ({ toast: { error: m.toastError } }));

// CodeMirror measures text with ranges, which jsdom does not implement.
beforeEach(() => {
  vi.clearAllMocks();
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  m.format.mockResolvedValue("<div>\n  formatted\n</div>\n");
});

const view = () => EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
const text = () => view().state.doc.toString();

function setDoc(value: string) {
  act(() => {
    view().dispatch({ changes: { from: 0, to: view().state.doc.length, insert: value } });
  });
}

describe("SourceCodeEditor", () => {
  it("shows the document and reports edits", () => {
    const onChange = vi.fn();
    render(<SourceCodeEditor language="html" value="<p>hi</p>" onChange={onChange} />);
    expect(text()).toBe("<p>hi</p>");
    expect(screen.getByText("HTML source")).toBeInTheDocument();
    expect(document.querySelector(".cm-content")).toHaveAttribute("aria-label", "HTML source");

    setDoc("<p>changed</p>");
    expect(onChange).toHaveBeenCalledWith("<p>changed</p>");
  });

  it("labels and offers no formatter for Markdown", () => {
    render(<SourceCodeEditor language="markdown" value="# Title" onChange={vi.fn()} />);
    expect(screen.getAllByText("Markdown source").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /prettier/i })).not.toBeInTheDocument();
  });

  it("follows value changes from outside without echoing them back", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SourceCodeEditor language="html" value="a" onChange={onChange} />);
    rerender(<SourceCodeEditor language="html" value="b" onChange={onChange} />);
    expect(text()).toBe("b");
    // Re-rendering with the same value leaves the document alone.
    rerender(<SourceCodeEditor language="html" value="b" onChange={onChange} />);
    expect(text()).toBe("b");
  });

  it("rebuilds the editor when the language changes", () => {
    const { rerender } = render(<SourceCodeEditor language="html" value="<b>x</b>" onChange={vi.fn()} />);
    rerender(<SourceCodeEditor language="markdown" value="<b>x</b>" onChange={vi.fn()} />);
    expect(document.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(document.querySelector(".cm-content")).toHaveAttribute("aria-label", "Markdown source");
  });

  it("toggles line wrapping", async () => {
    render(<SourceCodeEditor language="html" value="x" onChange={vi.fn()} />);
    const button = screen.getByRole("button", { name: /Wrap text/ });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: /Unwrap text/ })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".cm-lineWrapping")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Unwrap text/ }));
    expect(document.querySelector(".cm-lineWrapping")).toBeNull();
  });

  it("formats with Prettier and can restore the original", async () => {
    const onChange = vi.fn();
    render(<SourceCodeEditor language="html" value="<div>formatted</div>" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Prettier/ }));

    await waitFor(() => expect(text()).toBe("<div>\n  formatted\n</div>\n"));
    expect(m.format).toHaveBeenCalledWith("<div>formatted</div>", expect.objectContaining({ parser: "html" }));
    expect(onChange).toHaveBeenLastCalledWith("<div>\n  formatted\n</div>\n");

    await userEvent.click(await screen.findByRole("button", { name: /Unprettier/ }));
    expect(text()).toBe("<div>formatted</div>");
    expect(screen.getByRole("button", { name: /^Prettier/ })).toBeInTheDocument();
  });

  it("shows a progress label while formatting", async () => {
    let resolve: (value: string) => void = () => {};
    m.format.mockReturnValueOnce(new Promise<string>((r) => (resolve = r)));
    render(<SourceCodeEditor language="html" value="<p>x</p>" onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Prettier/ }));
    expect(await screen.findByRole("button", { name: /Formatting/ })).toBeDisabled();
    await act(async () => resolve("<p>x</p>\n"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Unprettier/ })).toBeEnabled());
  });

  it("reports HTML that Prettier cannot format", async () => {
    m.format.mockRejectedValueOnce(new Error("syntax"));
    render(<SourceCodeEditor language="html" value="<p" onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Prettier/ }));
    await waitFor(() => expect(m.toastError).toHaveBeenCalledWith("Prettier could not format this HTML."));
    expect(text()).toBe("<p");
    expect(screen.getByRole("button", { name: /^Prettier/ })).toBeEnabled();
  });
});
