import { Editor } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { CellSelection } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock("next/dynamic", () => ({
  // Run the loader too, as the real one does when a result first needs the editor.
  default: (load: () => Promise<unknown>) => {
    void Promise.resolve(load()).catch(() => undefined);
    return function Preview({ content }: { content: string }) {
      return <div data-testid="result-preview">{content}</div>;
    };
  },
}));

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

beforeEach(() => {
  vi.resetModules();
});

/** A real editor; jsdom has no layout, so give the caret somewhere to be. */
function makeEditor(html: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const instance = new Editor({
    element,
    extensions: [
      StarterKit,
      Table,
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: html,
  });
  instance.view.coordsAtPos = () => ({
    left: 40,
    right: 40,
    top: 10,
    bottom: 30,
  });
  editor = instance;
  return instance;
}

async function mount(html: string, enabled = true, canConfigure = false) {
  const { WritingAssistant } =
    await import("@/components/pages/writing-assistant");
  const { api } = await import("@/lib/api-client");
  const mocked = vi.mocked(api);
  mocked.get.mockResolvedValue({ enabled, can_configure: canConfigure });
  const instance = makeEditor(html);
  render(<WritingAssistant editor={instance} spaceKey="ENG" />);
  // let the status lookup settle
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return { instance, api: mocked };
}

async function select(instance: Editor, from: number, to: number) {
  await act(async () => {
    instance.commands.setTextSelection({ from, to });
  });
}

describe("WritingAssistant", () => {
  it("shows a small AI button at the end of a selection, and not for a bare caret", async () => {
    const { instance } = await mount("<p>Me and him goes there.</p>");
    await select(instance, 3, 3);
    expect(
      screen.queryByRole("button", { name: "Writing assistant" }),
    ).toBeNull();

    await select(instance, 1, 10);

    expect(
      await screen.findByRole("button", { name: "Writing assistant" }),
    ).toBeInTheDocument();
  });

  it("stays away while the assistant is off, and from a selection across blocks", async () => {
    const off = await mount("<p>Me and him goes there.</p>", false);
    await select(off.instance, 1, 10);
    expect(
      screen.queryByRole("button", { name: "Writing assistant" }),
    ).toBeNull();
  });

  it("does not offer a selection that spans two paragraphs", async () => {
    const { instance } = await mount(
      "<p>First paragraph.</p><p>Second one.</p>",
    );
    await select(instance, 3, 25);
    expect(
      screen.queryByRole("button", { name: "Writing assistant" }),
    ).toBeNull();
  });

  it("fixes grammar only after it is accepted, replacing just the selected words", async () => {
    const { instance, api } = await mount(
      "<p>Me and him goes there. Next.</p>",
    );
    api.post.mockResolvedValue({ result: "He and I go there." });
    await select(instance, 1, 23);
    await userEvent.click(
      await screen.findByRole("button", { name: "Writing assistant" }),
    );

    await userEvent.click(screen.getByRole("button", { name: /Fix grammar/ }));

    expect(await screen.findByText("He and I go there.")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/api/v1/ai/spaces/ENG/assist", {
      action: "fix",
      text: "Me and him goes there.",
      instruction: "",
      draft: "",
      before: "",
      after: "",
    });
    expect(instance.getText()).toBe("Me and him goes there. Next."); // nothing changed yet

    await userEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(instance.getText()).toBe("He and I go there. Next.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("checks terminology against the wiki and says when nothing needs changing", async () => {
    const { instance, api } = await mount(
      "<p>Run it on the monitoring host.</p>",
    );
    api.post.mockResolvedValue({ result: "Run it on the monitoring host." });
    await select(instance, 1, 31);
    await userEvent.click(
      await screen.findByRole("button", { name: "Writing assistant" }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Consistent terms/ }),
    );

    expect(await screen.findByText(/Nothing to change/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/ai/spaces/ENG/assist",
      expect.objectContaining({ action: "terms" }),
    );
  });

  it("opens the AI prompt focused and waits for input or Continue writing from the / menu", async () => {
    const { instance, api } = await mount("<p>Restart the worker</p>");
    api.post.mockResolvedValue({ result: "when jobs stop moving." });
    await act(async () => {
      instance.commands.setTextSelection(21);
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent("wikihub:ai-assist"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const box = await screen.findByPlaceholderText("Ask AI to write anything...");
    await waitFor(() => expect(box).toHaveFocus());
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Continue writing/ }));

    expect(
      await screen.findByText("when jobs stop moving."),
    ).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/api/v1/ai/spaces/ENG/assist", {
      action: "complete",
      text: "Restart the worker",
      instruction: "",
      draft: "",
      before: "",
      after: "",
    });
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(instance.getText()).toBe(
      "Restart the worker when jobs stop moving.",
    );
  });

  it("waits for the author to submit a prompt after choosing Continue with AI from the / menu", async () => {
    const { instance, api } = await mount("<p></p>");
    api.post.mockResolvedValue({
      result: "Runbook checklist",
      html: "<p>Runbook checklist</p>",
    });
    await act(async () => {
      instance.commands.setTextSelection(1);
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent("wikihub:ai-assist"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const box = await screen.findByPlaceholderText("Ask AI to write anything...");
    await waitFor(() => expect(box).toHaveFocus());
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.type(box, "Write a short checklist{Enter}");

    expect(await screen.findByText(/Runbook checklist/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/api/v1/ai/spaces/ENG/assist", {
      action: "write",
      text: "",
      instruction: "Write a short checklist",
      draft: "",
      before: "",
      after: "",
    });
  });

  it("will not overwrite text that changed while the AI was working", async () => {
    const { instance, api } = await mount("<p>Me and him goes there.</p>");
    api.post.mockResolvedValue({ result: "He and I go there." });
    await select(instance, 1, 23);
    await userEvent.click(
      await screen.findByRole("button", { name: "Writing assistant" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Fix grammar/ }));
    await screen.findByText("He and I go there.");

    await act(async () => {
      instance.commands.insertContentAt(1, "Oh, ");
    });
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/text changed/);
    expect(instance.getText()).toBe("Oh, Me and him goes there.");
  });

  it("shows a failure inside the card", async () => {
    const { instance, api } = await mount("<p>Me and him goes there.</p>");
    api.post.mockRejectedValue(
      new ApiError(429, "rate_limited", "Too many AI requests."),
    );
    await select(instance, 1, 23);
    await userEvent.click(
      await screen.findByRole("button", { name: "Writing assistant" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Fix grammar/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many AI requests.",
    );
  });

  it("opens an Edit with AI box on Ctrl+Space, writes at an empty line and inserts below", async () => {
    const { instance, api } = await mount(
      "<p>Intro text.</p><p></p><p>Closing text.</p>",
    );
    api.post.mockResolvedValue({
      result: "## Release day\n\n- [ ] Tag the build",
      html: "<h2>Release day</h2><ul><li><p>Tag the build</p></ul>",
    });
    await act(async () => {
      instance.commands.setTextSelection(14); // inside the empty paragraph
    });

    await act(async () => {
      instance.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          ctrlKey: true,
          code: "Space",
          bubbles: true,
        }),
      );
    });
    const box = await screen.findByRole("textbox", { name: "Ask the AI" });
    expect(box).toHaveAttribute("placeholder", "Ask AI to write anything...");
    await userEvent.type(box, "A release day checklist{Enter}");

    expect(await screen.findByTestId("result-preview")).toHaveTextContent(
      "Release day",
    );
    expect(api.post).toHaveBeenCalledWith("/api/v1/ai/spaces/ENG/assist", {
      action: "write",
      text: "",
      instruction: "A release day checklist",
      draft: "",
      before: "Intro text.",
      after: "Closing text.",
    });
    expect(instance.getHTML()).not.toContain("Release day"); // nothing yet

    await userEvent.click(screen.getByRole("button", { name: "Insert below" }));

    expect(instance.getHTML()).toContain("<h2>Release day</h2>");
    expect(instance.getText()).toContain("Closing text.");
    expect(instance.getHTML()).not.toContain("<p></p>"); // the empty line was used
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks for changes to the generated content before inserting it", async () => {
    const { instance, api } = await mount("<p></p>");
    api.post
      .mockResolvedValueOnce({
        result: "Long text.",
        html: "<p>Long text.</p>",
      })
      .mockResolvedValueOnce({ result: "Short.", html: "<p>Short.</p>" });
    await act(async () => {
      instance.commands.setTextSelection(1);
      instance.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          ctrlKey: true,
          code: "Space",
          bubbles: true,
        }),
      );
    });
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Ask the AI" }),
      "About queues{Enter}",
    );
    expect(await screen.findByTestId("result-preview")).toHaveTextContent(
      "Long text.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "What should change?" }),
      "Shorter{Enter}",
    );

    await waitFor(() =>
      expect(screen.getByTestId("result-preview")).toHaveTextContent("Short."),
    );
    expect(api.post).toHaveBeenLastCalledWith(
      "/api/v1/ai/spaces/ENG/assist",
      expect.objectContaining({
        action: "write",
        instruction: "Shorter",
        draft: "Long text.",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Insert below" }));
    expect(instance.getText()).toBe("Short.");
  });

  it("rewrites the selected words as instructed", async () => {
    const { instance, api } = await mount("<p>We shall proceed. Next.</p>");
    api.post.mockResolvedValue({ result: "Let's go." });
    await select(instance, 1, 18);
    await userEvent.click(
      await screen.findByRole("button", { name: "Writing assistant" }),
    );

    const box = screen.getByRole("textbox", { name: "Ask the AI" });
    expect(box).toHaveAttribute(
      "placeholder",
      "Tell AI how to change the selection...",
    );
    await userEvent.type(box, "Make it casual{Enter}");
    await screen.findByText("Let's go.");
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(instance.getText()).toBe("Let's go. Next.");
    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/ai/spaces/ENG/assist",
      expect.objectContaining({
        action: "edit",
        text: "We shall proceed.",
        instruction: "Make it casual",
      }),
    );
  });

  it("shows a small not-set-up notice, with no settings link for an ordinary editor", async () => {
    const { instance } = await mount("<p>Restart the worker</p>", false, false);
    await act(async () => {
      instance.commands.setTextSelection(5);
      window.dispatchEvent(new CustomEvent("wikihub:ai-assist"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(
      await screen.findByText("AI assistant isn't set up yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/administrator needs to connect an AI service/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open AI settings" })).toBeNull();
    expect(screen.queryByText("What it unlocks")).toBeNull(); // compact, not the full message
  });

  it("dismisses the not-set-up notice as soon as the author carries on typing", async () => {
    const { instance } = await mount("<p>Restart the worker</p>", false, false);
    await act(async () => {
      instance.commands.setTextSelection(5);
      window.dispatchEvent(new CustomEvent("wikihub:ai-assist"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(
      await screen.findByText("AI assistant isn't set up yet"),
    ).toBeInTheDocument();

    await act(async () => {
      instance.commands.insertContent("x");
    });

    await waitFor(() =>
      expect(screen.queryByText("AI assistant isn't set up yet")).toBeNull(),
    );
  });

  it("points an administrator to the AI settings from the same small notice", async () => {
    const { instance } = await mount("<p>Restart the worker</p>", false, true);
    await act(async () => {
      instance.commands.setTextSelection(5);
      window.dispatchEvent(new CustomEvent("wikihub:ai-assist"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(
      await screen.findByRole("link", { name: "Open AI settings" }),
    ).toHaveAttribute("href", "/admin/ai");
    expect(screen.queryByText("Open Administration → AI assistant")).toBeNull();
  });

  it("keeps its own forms from submitting the page form it sits inside", async () => {
    const { WritingAssistant } =
      await import("@/components/pages/writing-assistant");
    const { api } = await import("@/lib/api-client");
    vi.mocked(api.get).mockResolvedValue({
      enabled: true,
      can_configure: false,
    });
    vi.mocked(api.post).mockResolvedValue({
      result: "Hello.",
      html: "<p>Hello.</p>",
    });
    const pageSubmit = vi.fn((event: React.FormEvent) =>
      event.preventDefault(),
    );
    const instance = makeEditor("<p></p>");
    render(
      <form onSubmit={pageSubmit}>
        <WritingAssistant editor={instance} spaceKey="ENG" />
      </form>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      instance.commands.setTextSelection(1);
      instance.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          ctrlKey: true,
          code: "Space",
          bubbles: true,
        }),
      );
    });

    await userEvent.type(
      await screen.findByRole("textbox", { name: "Ask the AI" }),
      "Say hello{Enter}",
    );
    await screen.findByTestId("result-preview");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "What should change?" }),
      "Louder{Enter}",
    );

    expect(pageSubmit).not.toHaveBeenCalled();
  });

  it("keeps the box with the line it was called from when the page scrolls", async () => {
    const { instance } = await mount("<p>First line</p><p></p>");
    await act(async () => {
      instance.commands.setTextSelection(14);
      instance.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          ctrlKey: true,
          code: "Space",
          bubbles: true,
        }),
      );
    });
    const box = await screen.findByRole("dialog");
    const startedAt = parseFloat(box.style.top);

    // The line moves up 100px on screen as the page scrolls.
    instance.view.coordsAtPos = () => ({
      left: 40,
      right: 40,
      top: -90,
      bottom: -70,
    });
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() =>
      expect(parseFloat(screen.getByRole("dialog").style.top)).toBeLessThan(
        startedAt - 90,
      ),
    );
  });

  it("lets the author step back and forward through the versions the AI gave", async () => {
    const { instance, api } = await mount("<p>Intro.</p><p></p>");
    api.post
      .mockResolvedValueOnce({
        result: "First version.",
        html: "<p>First version.</p>",
      })
      .mockResolvedValueOnce({
        result: "Second version.",
        html: "<p>Second version.</p>",
      });
    await act(async () => {
      instance.commands.setTextSelection(10);
      instance.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          ctrlKey: true,
          code: "Space",
          bubbles: true,
        }),
      );
    });
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Ask the AI" }),
      "Write something{Enter}",
    );
    expect(await screen.findByTestId("result-preview")).toHaveTextContent(
      "First version.",
    );
    expect(
      screen.queryByRole("button", { name: "Previous version" }),
    ).toBeNull(); // one version so far

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "What should change?" }),
      "Different{Enter}",
    );
    await waitFor(() =>
      expect(screen.getByTestId("result-preview")).toHaveTextContent(
        "Second version.",
      ),
    );
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next version" })).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: "Previous version" }),
    );
    expect(screen.getByTestId("result-preview")).toHaveTextContent(
      "First version.",
    );
    expect(
      screen.getByRole("button", { name: "Previous version" }),
    ).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Next version" }));
    expect(screen.getByTestId("result-preview")).toHaveTextContent(
      "Second version.",
    );

    // Going back and inserting uses the version on screen.
    await userEvent.click(
      screen.getByRole("button", { name: "Previous version" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Insert below" }));
    expect(instance.getText()).toContain("First version.");
    expect(instance.getText()).not.toContain("Second version.");
  });
});

describe("WritingAssistant edge cases", () => {
  const ctrlSpace = () =>
    new KeyboardEvent("keydown", { ctrlKey: true, code: "Space", bubbles: true });

  it("falls back to a general message for a failure that carries none", async () => {
    const { instance, api } = await mount("<p>Me and him goes there.</p>");
    api.post.mockRejectedValue(new Error("offline"));
    await select(instance, 1, 23);
    await userEvent.click(await screen.findByRole("button", { name: "Writing assistant" }));
    await userEvent.click(screen.getByRole("button", { name: /Fix grammar/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not answer/i);
  });

  it("offers nothing when the editor cannot say where the selection is", async () => {
    const { instance } = await mount("<p>Me and him goes there.</p>");
    instance.view.coordsAtPos = () => {
      throw new Error("no layout");
    };
    await select(instance, 1, 10);

    expect(screen.queryByRole("button", { name: "Writing assistant" })).toBeNull();
  });

  it("stays put on scroll when the editor cannot say where the line is any more", async () => {
    const { instance } = await mount("<p>First line</p><p></p>");
    await act(async () => {
      instance.commands.setTextSelection(14);
      instance.view.dom.dispatchEvent(ctrlSpace());
    });
    const box = await screen.findByRole("dialog");
    const startedAt = box.style.top;
    instance.view.coordsAtPos = () => {
      throw new Error("no layout");
    };
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByRole("dialog").style.top).toBe(startedAt);
  });

  it("does not offer Continue writing when the text before the caret is too short", async () => {
    const { instance, api } = await mount("<p>Hi</p>");
    await act(async () => {
      instance.commands.setTextSelection(3);
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("wikihub:ai-assist"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const box = await screen.findByPlaceholderText("Ask AI to write anything...");
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.queryByRole("button", { name: /Continue writing/ })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("closes the box on Escape and gives the editor its focus back", async () => {
    const { instance } = await mount("<p>First line</p><p></p>");
    await act(async () => {
      instance.commands.setTextSelection(14);
      instance.view.dom.dispatchEvent(ctrlSpace());
    });
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("revises a rewrite of the selection, and still replaces the same words", async () => {
    const { instance, api } = await mount("<p>We shall proceed. Next.</p>");
    api.post
      .mockResolvedValueOnce({ result: "Let's go." })
      .mockResolvedValueOnce({ result: "Go." });
    await select(instance, 1, 18);
    await userEvent.click(await screen.findByRole("button", { name: "Writing assistant" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Ask the AI" }), "Casual{Enter}");
    await screen.findByText("Let's go.");

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "What should change?" }),
      "Shorter{Enter}",
    );
    await screen.findByText("Go.");
    expect(api.post).toHaveBeenLastCalledWith(
      "/api/v1/ai/spaces/ENG/assist",
      expect.objectContaining({ action: "edit", text: "Let's go.", instruction: "Shorter" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(instance.getText()).toBe("Go. Next.");
  });

  it("inserts generated content below a line that already has text", async () => {
    const { instance, api } = await mount("<p>First line</p>");
    api.post.mockResolvedValue({ result: "More.", html: "<p>More.</p>" });
    await act(async () => {
      instance.commands.setTextSelection(11);
      instance.view.dom.dispatchEvent(ctrlSpace());
    });
    await userEvent.type(await screen.findByRole("textbox", { name: "Ask the AI" }), "More{Enter}");
    await screen.findByTestId("result-preview");
    await userEvent.click(screen.getByRole("button", { name: "Insert below" }));

    expect(instance.getText({ blockSeparator: "|" })).toBe("First line|More.");
  });

  it("opens above the line when there is no room below it", async () => {
    const original = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 40 });
    try {
      const { instance, api } = await mount("<p>First line</p><p></p>");
      api.post.mockResolvedValue({ result: "More.", html: "<p>More.</p>" });
      await act(async () => {
        instance.commands.setTextSelection(14);
        instance.view.dom.dispatchEvent(ctrlSpace());
      });
      const box = await screen.findByRole("dialog");

      expect(box.style.bottom).not.toBe("");
      expect(box.style.top).toBe("");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: original });
    }
  });

  it("leaves the box alone on scroll when the line has not moved", async () => {
    const { instance } = await mount("<p>First line</p><p></p>");
    await act(async () => {
      instance.commands.setTextSelection(14);
      instance.view.dom.dispatchEvent(ctrlSpace());
    });
    const box = await screen.findByRole("dialog");
    const startedAt = box.style.top;
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByRole("dialog").style.top).toBe(startedAt);
  });

  it("keeps the suggestion and explains when a requested change fails", async () => {
    const { instance, api } = await mount("<p>Intro.</p><p></p>");
    api.post
      .mockResolvedValueOnce({ result: "First.", html: "<p>First.</p>" })
      .mockRejectedValueOnce(new ApiError(429, "rate_limited", "Too many AI requests."));
    await act(async () => {
      instance.commands.setTextSelection(10);
      instance.view.dom.dispatchEvent(ctrlSpace());
    });
    await userEvent.type(await screen.findByRole("textbox", { name: "Ask the AI" }), "Write{Enter}");
    await screen.findByTestId("result-preview");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "What should change?" }),
      "Different{Enter}",
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many AI requests.");
    expect(screen.getByTestId("result-preview")).toHaveTextContent("First.");
  });
});

describe("WritingAssistant dismissal", () => {
  it("closes when something outside the box is pressed, but not when the box itself is", async () => {
    const { instance } = await mount("<p>First line</p><p></p>");
    await act(async () => {
      instance.commands.setTextSelection(14);
      instance.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { ctrlKey: true, code: "Space", bubbles: true }),
      );
    });
    const box = await screen.findByRole("dialog");

    fireEvent.pointerDown(box);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("minimizes to a Generating pill while a request is in flight and restores the dialog when clicked", async () => {
    let resolvePost!: (value: { result: string; html?: string }) => void;
    const { instance, api } = await mount("<p>Me and him goes there.</p>");
    api.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    await select(instance, 1, 23);
    await userEvent.click(
      await screen.findByRole("button", { name: "Writing assistant" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Fix grammar/ }));

    expect(screen.getByText("Working...")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);

    const pill = await screen.findByTestId("writing-assistant-minimized");
    expect(pill).toHaveTextContent("Generating…");
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      resolvePost({ result: "He and I go there." });
    });
    expect(await screen.findByText("AI draft ready")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "AI draft ready" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "He and I go there.",
    );
  });

  it("continues writing from the preceding paragraph when /Continue writing is run on an empty line", async () => {
    const { instance, api } = await mount("<p>Restart the worker</p><p></p>");
    api.post.mockResolvedValue({ result: "when jobs stop moving." });
    await act(async () => {
      instance.commands.setTextSelection(21); // inside the empty second paragraph
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent("wikihub:ai-assist"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const box = await screen.findByPlaceholderText("Ask AI to write anything...");
    await waitFor(() => expect(box).toHaveFocus());
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Continue writing/ }));

    expect(
      await screen.findByText("when jobs stop moving."),
    ).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/ai/spaces/ENG/assist",
      expect.objectContaining({
        action: "complete",
        text: "Restart the worker",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(instance.getText()).toContain("when jobs stop moving.");
  });

  it("uploads reference files and sends attachment_ids when asking the AI", async () => {
    const { instance, api } = await mount("<p></p>");
    api.post
      .mockResolvedValueOnce({ id: "file-uuid-1", filename: "notes.md", chars: 42 })
      .mockResolvedValueOnce({ result: "Summary.", html: "<p>Summary.</p>" });
    await act(async () => {
      instance.commands.setTextSelection(1);
      instance.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { ctrlKey: true, code: "Space", bubbles: true }),
      );
    });

    const input = screen.getByTestId("writing-assistant-file-input") as HTMLInputElement;
    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    await userEvent.upload(input, file);
    expect(await screen.findByText("notes.md")).toBeInTheDocument();

    await userEvent.type(
      screen.getByRole("textbox", { name: "Ask the AI" }),
      "Summarize the attached notes{Enter}",
    );

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/ai/spaces/ENG/assist",
        expect.objectContaining({
          action: "write",
          instruction: "Summarize the attached notes",
          attachment_ids: ["file-uuid-1"],
        }),
      ),
    );
  });

  it("supports multi-cell table CellSelection and passes table header context", async () => {
    const { instance, api } = await mount(
      "<table><tbody><tr><th>Name</th><th>Role</th></tr><tr><td>Ada</td><td>Eng</td></tr></tbody></table>",
    );
    api.post.mockResolvedValue({ result: "Reviewed table rows." });

    const cells: number[] = [];
    instance.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
    });
    expect(cells.length).toBe(2);

    await act(async () => {
      const tr = instance.state.tr.setSelection(
        CellSelection.create(instance.state.doc, cells[0]!, cells[1]!),
      );
      instance.view.dispatch(tr);
    });

    const trigger = await screen.findByRole("button", { name: "Writing assistant" });
    await userEvent.click(trigger);
    await userEvent.type(
      screen.getByRole("textbox", { name: "Ask the AI" }),
      "Check rows{Enter}",
    );

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/ai/spaces/ENG/assist",
        expect.objectContaining({
          action: "edit",
          text: "| Ada | Eng |",
          before: "| Name | Role |",
        }),
      ),
    );
  });

  it("discards a generated suggestion when the Discard button is clicked", async () => {
    const { instance, api } = await mount("<p></p>");
    api.post.mockResolvedValue({
      result: "Draft text",
      html: "<p>Draft text</p>",
    });
    await act(async () => {
      instance.commands.setTextSelection(1);
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("wikihub:ai-assist"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const box = await screen.findByPlaceholderText("Ask AI to write anything...");
    await userEvent.type(box, "Write something{Enter}");
    expect(await screen.findByText(/Draft text/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(instance.getText()).toBe("");
  });

  it("attaches a file dropped onto the Continue with AI dialog", async () => {
    const { instance, api } = await mount("<p></p>");
    api.post.mockResolvedValueOnce({
      id: "dropped-file-1",
      filename: "spec.md",
      chars: 25,
    });
    await act(async () => {
      instance.commands.setTextSelection(1);
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("wikihub:ai-assist"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const dialog = await screen.findByRole("dialog");
    const file = new File(["# Spec"], "spec.md", { type: "text/markdown" });
    const dataTransfer = {
      types: ["Files"],
      files: [file],
      items: [{ kind: "file", getAsFile: () => file }],
      dropEffect: "none",
    };

    fireEvent.dragEnter(dialog, { dataTransfer });
    fireEvent.dragOver(dialog, { dataTransfer });
    fireEvent.drop(dialog, { dataTransfer });

    expect(await screen.findByText("spec.md")).toBeInTheDocument();
  });
});
