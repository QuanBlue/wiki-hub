import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function Preview({ content }: { content: string }) {
      return <div data-testid="result-preview">{content}</div>;
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
    extensions: [StarterKit],
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

  it("continues a sentence at the caret from the / menu and inserts it after the text", async () => {
    const { instance, api } = await mount("<p>Restart the worker</p>");
    api.post.mockResolvedValue({ result: "when jobs stop moving." });
    await act(async () => {
      instance.commands.setTextSelection(21);
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent("wikihub:ai-assist"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

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
