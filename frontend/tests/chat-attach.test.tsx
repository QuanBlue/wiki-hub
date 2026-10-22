import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatTopBarButton } from "@/components/chat/chat-top-bar-button";
import { ChatWidget } from "@/components/chat/chat-widget";
import type { AnswerResult } from "@/lib/ai-answer";
import { ChatStreamError } from "@/lib/ai-chat";
import { resetAiStatus } from "@/lib/ai-summary";
import { api, ApiError } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
const streamChat = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-chat")>()),
  streamChat,
}));
const downloadMarkdown = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat-export")>()),
  downloadMarkdown,
}));

const FROM_FILE: AnswerResult = {
  found: true,
  answer: "The meeting is on Friday [f1].",
  reason: "",
  sources: [],
  related: [],
  cached: false,
  basis: "wiki",
  file_sources: [
    { n: 1, filename: "notes.txt", excerpt: "The meeting is on Friday." },
  ],
};

async function open() {
  vi.mocked(api.get).mockResolvedValue({ enabled: true, can_configure: false });
  const actor = userEvent.setup();
  render(
    <>
      <ChatTopBarButton />
      <ChatWidget userId="u1" />
    </>,
  );
  await actor.click(
    await screen.findByRole("button", { name: "Chat with AI" }),
  );
  const box = (await screen.findByPlaceholderText(
    "Ask a question…",
  )) as HTMLTextAreaElement;
  return { actor, box };
}

function pick(...names: string[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  fireEvent.change(input, {
    target: { files: names.map((name) => new File(["words"], name)) },
  });
}

describe("files attached in the chat", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetAiStatus();
    vi.mocked(api.post).mockReset();
    streamChat.mockReset();
  });

  it("are read, sent with the question, and shown as sources of the answer", async () => {
    vi.mocked(api.post).mockResolvedValue({
      id: "file-1",
      filename: "notes.txt",
      chars: 25,
    });
    streamChat.mockResolvedValue(FROM_FILE);
    const { actor, box } = await open();

    pick("notes.txt");
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    const [path, , options] = vi.mocked(api.post).mock.calls[0];
    expect(path).toBe("/api/v1/ai/chat/files");
    expect(
      (options as { rawBody: FormData }).rawBody.get("file"),
    ).toBeInstanceOf(File);
    await waitFor(() =>
      expect(screen.queryByText("Reading…")).not.toBeInTheDocument(),
    );

    await actor.type(box, "which day?{Enter}");

    await waitFor(() => expect(streamChat).toHaveBeenCalled());
    expect(streamChat.mock.calls[0][1].fileIds).toEqual(["file-1"]);
    const section = await screen.findByRole("region", {
      name: "From attached files",
    });
    // The [f1] mark opens what was read from the file.
    await actor.click(screen.getByRole("button", { name: "f1" }));
    expect(section).toHaveTextContent("The meeting is on Friday.");
    // The file moved from the box onto the question it was sent with.
    const sent = screen.getByRole("list", { name: "Attached files" });
    expect(sent).toHaveTextContent("notes.txt");
    expect(sent).toHaveTextContent("TXT");
    expect(
      screen.queryByRole("button", { name: "Remove notes.txt" }),
    ).toBeNull();
    expect(window.localStorage.getItem("wikihub:chat:v1:files:u1")).toBeNull();
  });

  it("sent earlier are read again by the next question, and count towards the three", async () => {
    vi.mocked(api.post).mockResolvedValue({
      id: "file-1",
      filename: "notes.txt",
      chars: 25,
    });
    streamChat.mockResolvedValue(FROM_FILE);
    const { actor, box } = await open();
    pick("notes.txt");
    await waitFor(() =>
      expect(screen.queryByText("Reading…")).not.toBeInTheDocument(),
    );
    await actor.type(box, "which day?{Enter}");
    await screen.findByRole("region", { name: "From attached files" });

    await actor.type(box, "and the time?{Enter}");

    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2));
    expect(streamChat.mock.calls[1][1].fileIds).toEqual(["file-1"]);
    // Only the question it was sent with shows it.
    expect(
      screen.getAllByRole("list", { name: "Attached files" }),
    ).toHaveLength(1);

    vi.mocked(api.post).mockImplementation(async () => ({
      id: `id-${Math.random()}`,
      filename: "more.txt",
      chars: 1,
    }));
    pick("b.txt", "c.txt", "d.txt");
    // One was sent already: two more fit.
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
  });

  it("go with a question that is edited", async () => {
    vi.mocked(api.post).mockResolvedValue({
      id: "file-1",
      filename: "notes.txt",
      chars: 25,
    });
    streamChat.mockResolvedValue(FROM_FILE);
    const { actor, box } = await open();
    pick("notes.txt");
    await waitFor(() =>
      expect(screen.queryByText("Reading…")).not.toBeInTheDocument(),
    );
    await actor.type(box, "which day?{Enter}");
    await screen.findByRole("region", { name: "From attached files" });

    await actor.click(screen.getByRole("button", { name: "Edit message" }));
    const editor = screen.getByRole("textbox", { name: "Edit message" });
    await actor.clear(editor);
    await actor.type(editor, "which weekday?{Enter}");

    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2));
    expect(streamChat.mock.calls[1][1].fileIds).toEqual(["file-1"]);
    expect(
      screen.getByRole("list", { name: "Attached files" }),
    ).toHaveTextContent("notes.txt");
  });

  it("wait to be read before a question can be sent", async () => {
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(api.post).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { actor, box } = await open();

    pick("big.pdf");
    expect(await screen.findByText("Reading…")).toBeInTheDocument();
    await actor.type(box, "summarise it{Enter}");
    expect(streamChat).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Wait until the files are read" }),
    ).toBeDisabled();

    finish({ id: "file-2", filename: "big.pdf", chars: 10 });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
    );
  });

  it("say why a file could not be read, and can be removed", async () => {
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(400, "chat_file_scanned", "scanned"),
    );
    const { actor } = await open();

    pick("scan.pdf");

    expect(
      await screen.findAllByText(
        "This PDF is scanned images: it has no text to read.",
      ),
    ).not.toHaveLength(0);
    await actor.click(screen.getByRole("button", { name: "Remove scan.pdf" }));
    expect(screen.queryByText("scan.pdf")).not.toBeInTheDocument();
  });

  it("are three at most", async () => {
    vi.mocked(api.post).mockImplementation(async () => ({
      id: `id-${Math.random()}`,
      filename: "a.txt",
      chars: 1,
    }));
    await open();

    pick("a.txt", "b.txt", "c.txt", "d.txt");

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
    expect(
      screen.getByRole("button", { name: "At most 3 files per conversation" }),
    ).toBeDisabled();
  });

  it("that expired show so on their question, are not sent again, and free their place", async () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:files:u1",
      JSON.stringify([
        { id: "old", filename: "old.txt" },
        { id: "new", filename: "new.txt" },
      ]),
    );
    streamChat.mockRejectedValueOnce(
      new ChatStreamError("file_expired", "old"),
    );
    const { actor, box } = await open();
    expect(screen.getByText("old.txt")).toBeInTheDocument();

    await actor.type(box, "what was in it?{Enter}");

    expect(
      await screen.findByText(/The attached files have expired/),
    ).toBeInTheDocument();
    const sent = screen.getByRole("list", { name: "Attached files" });
    expect(sent).toHaveTextContent("Expired - attach it again");
    expect(within(sent).getByText("old.txt")).toHaveClass("line-through");
    expect(within(sent).getByText("new.txt")).not.toHaveClass("line-through");

    streamChat.mockResolvedValue(FROM_FILE);
    await actor.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2));
    expect(streamChat.mock.calls[1][1].fileIds).toEqual(["new"]);
  });

  it("show their kind by extension, or as a file without one", async () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:files:u1",
      JSON.stringify([
        { id: "1", filename: "Bang tham so.xlsx" },
        { id: "2", filename: "README" },
      ]),
    );
    streamChat.mockResolvedValue(FROM_FILE);
    const { actor, box } = await open();

    await actor.type(box, "what is in them?{Enter}");

    const sent = await screen.findByRole("list", { name: "Attached files" });
    expect(sent).toHaveTextContent("XLSX");
    expect(sent).toHaveTextContent("READMEFile");
  });

  it("that the server cannot name are all shown as expired", async () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:files:u1",
      JSON.stringify([{ id: "old", filename: "old.txt" }]),
    );
    streamChat.mockRejectedValue(new ChatStreamError("file_expired"));
    const { actor, box } = await open();

    await actor.type(box, "what was in it?{Enter}");

    expect(
      await screen.findByText("Expired - attach it again"),
    ).toBeInTheDocument();
  });
});

describe("the length of a question", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetAiStatus();
  });

  it("is counted near the limit of 4,000 characters", async () => {
    await open();
    const box = screen.getByPlaceholderText("Ask a question…");

    fireEvent.change(box, { target: { value: "x".repeat(100) } });
    expect(screen.queryByText(/characters$/)).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: "x".repeat(3700) } });

    expect(screen.getByText("3,700 / 4,000 characters")).toBeInTheDocument();
    expect(box).toHaveAttribute("maxLength", "4000");
  });
});

describe("a mark to an attached file", () => {
  it("becomes a cite link and calls back as a file mark", async () => {
    const { IssueMarkdown } =
      await import("@/components/issues/issue-markdown");
    const { citeLinks } = await import("@/lib/ai-answer");
    expect(citeLinks("a [1] b [w2] c [f3]")).toBe(
      "a [1](cite:1) b [w2](cite:w2) c [f3](cite:f3)",
    );
    const onCite = vi.fn();
    render(<IssueMarkdown source={citeLinks("Read [f3].")} onCite={onCite} />);

    await userEvent.click(screen.getByRole("button", { name: "f3" }));

    expect(onCite).toHaveBeenCalledWith(3, false, true);
  });

  it("is named, never linked, in the saved conversation", async () => {
    const { chatToMarkdown } = await import("@/lib/chat-export");
    const markdown = chatToMarkdown(
      [
        { id: "q", role: "user", content: "which day?" },
        {
          id: "a",
          role: "assistant",
          content: "Friday [f1].",
          status: "done",
          found: true,
          fileSources: FROM_FILE.file_sources,
        },
      ],
      {
        title: "Chat",
        exportedAt: "Saved",
        question: "Question",
        answer: "Answer",
        sources: "Sources",
        alsoRead: "Also read",
        web: "Web",
        files: "Files",
        attached: "From attached files",
        notFound: "Not found",
        failed: "Failed",
        stopped: "Stopped",
        basis: (basis) => basis,
      },
    );

    expect(markdown).toContain("**From attached files**\n\n[f1] notes.txt");
  });
});

describe("attaching by dropping or pasting", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetAiStatus();
    vi.mocked(api.post).mockReset();
    streamChat.mockReset();
  });

  it("a file dragged onto the panel shows where to drop it, and is attached", async () => {
    vi.mocked(api.post).mockResolvedValue({
      id: "d",
      filename: "drop.txt",
      chars: 1,
    });
    const { box } = await open();
    // The whole panel takes the drop, not only the box.
    const panel = box.closest("form")!.parentElement!.parentElement!;
    const title = "Drop files here to read them with the wiki";

    fireEvent.dragOver(panel, {
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    fireEvent.dragOver(panel, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    // Leaving the panel takes the drop area away.
    fireEvent.dragLeave(panel);
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    fireEvent.drop(panel, { dataTransfer: { types: ["Files"], files: [] } });
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.dragOver(panel, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    fireEvent.drop(panel, {
      dataTransfer: { types: ["Files"], files: [new File(["w"], "drop.txt")] },
    });

    expect(await screen.findByText("drop.txt")).toBeInTheDocument();
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("with three files attached, the drop area says there is no room", async () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:files:u1",
      JSON.stringify([
        { id: "1", filename: "a.txt" },
        { id: "2", filename: "b.txt" },
        { id: "3", filename: "c.txt" },
      ]),
    );
    const { box } = await open();
    const panel = box.closest("form")!.parentElement!.parentElement!;

    fireEvent.dragOver(panel, {
      dataTransfer: { types: ["Files"], files: [] },
    });

    expect(
      screen.getByText("3 files are already attached"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Remove one to attach another."),
    ).toBeInTheDocument();
  });

  it("a pasted file is attached, a few pasted words stay words", async () => {
    vi.mocked(api.post).mockResolvedValue({
      id: "p",
      filename: "paste.csv",
      chars: 1,
    });
    const { box } = await open();

    fireEvent.paste(box, {
      clipboardData: { files: [], getData: () => "a few words" },
    });
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.paste(box, {
      clipboardData: {
        files: [new File(["a,b"], "paste.csv")],
        getData: () => "",
      },
    });

    expect(await screen.findByText("paste.csv")).toBeInTheDocument();
  });

  it("words too many for the box are attached as a text file instead", async () => {
    vi.mocked(api.post).mockImplementation(async (_path, _body, options) => {
      const sent = (options as { rawBody: FormData }).rawBody.get(
        "file",
      ) as File;
      return { id: "t", filename: sent.name, chars: sent.size };
    });
    const { box } = await open();
    const long = "x".repeat(4500);

    fireEvent.paste(box, {
      clipboardData: { files: [], getData: () => long },
    });

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const sent = (
      vi.mocked(api.post).mock.calls[0][2] as { rawBody: FormData }
    ).rawBody.get("file") as File;
    expect(sent.name).toMatch(/^pasted-text-\d{4}\.txt$/);
    expect(sent.type).toBe("text/plain");
    expect(sent.size).toBe(long.length);
    expect(await screen.findByText(sent.name)).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("with no room for another file, long words are pasted as they are", async () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:files:u1",
      JSON.stringify([
        { id: "1", filename: "a.txt" },
        { id: "2", filename: "b.txt" },
        { id: "3", filename: "c.txt" },
      ]),
    );
    const { box } = await open();

    fireEvent.paste(box, {
      clipboardData: { files: [], getData: () => "y".repeat(4500) },
    });

    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("the answer's attached files", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetAiStatus();
    vi.mocked(api.post).mockReset();
    streamChat.mockReset();
    downloadMarkdown.mockReset();
  });

  it("open and close to show what was read, and go into the saved conversation", async () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:files:u1",
      JSON.stringify([{ id: "file-1", filename: "notes.txt" }]),
    );
    streamChat.mockResolvedValue({
      ...FROM_FILE,
      answer: "Friday [f1], not [f7].",
    });
    const { actor, box } = await open();
    await actor.type(box, "which day?{Enter}");
    const section = await screen.findByRole("region", {
      name: "From attached files",
    });

    // A mark to a file that was not offered opens nothing.
    await actor.click(screen.getByRole("button", { name: "f7" }));
    expect(section).not.toHaveTextContent("The meeting is on Friday.");
    const row = within(section).getByRole("button", { name: /notes\.txt/ });
    await actor.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(section).toHaveTextContent("The meeting is on Friday.");
    // The mark of a file already open leaves it open.
    await actor.click(screen.getByRole("button", { name: "f1" }));
    expect(row).toHaveAttribute("aria-expanded", "true");
    await actor.click(row);
    expect(row).toHaveAttribute("aria-expanded", "false");

    await actor.click(
      screen.getByRole("button", { name: "Export this chat to a file" }),
    );
    expect(downloadMarkdown.mock.calls[0][0]).toContain(
      "**From attached files**\n\n[f1] notes.txt",
    );
  });

  it("one file refused leaves the other one ready", async () => {
    vi.mocked(api.post).mockImplementation(async (_path, _body, options) => {
      const sent = (options as { rawBody: FormData }).rawBody.get(
        "file",
      ) as File;
      if (sent.name === "bad.txt") {
        throw new ApiError(400, "chat_file_empty", "empty");
      }
      return { id: "good", filename: "good.txt", chars: 1 };
    });
    await open();

    pick("good.txt", "bad.txt");

    expect(
      await screen.findAllByText("No text was found in this file."),
    ).not.toHaveLength(0);
    await waitFor(() =>
      expect(
        JSON.parse(
          window.localStorage.getItem("wikihub:chat:v1:files:u1") ?? "[]",
        ),
      ).toEqual([{ id: "good", filename: "good.txt" }]),
    );
  });

  it("an unknown refusal has the general words", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("boom"));
    await open();

    pick("odd.txt");

    expect(
      await screen.findAllByText("The file could not be read."),
    ).not.toHaveLength(0);
  });

  it("the count turns red at the limit", async () => {
    await open();
    const box = screen.getByPlaceholderText("Ask a question…");

    fireEvent.change(box, { target: { value: "x".repeat(4000) } });

    expect(screen.getByText("4,000 / 4,000 characters")).toHaveClass(
      "text-danger",
    );
  });
});
