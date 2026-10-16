import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RichTextEditor } from "@/components/pages/rich-text-editor";

// The heavy previews are loaded on demand; stand-ins keep these tests on the modal itself.
vi.mock("@/components/pages/office-attachment-preview", () => ({
  OfficeAttachmentPreview: ({
    filename,
    expanded,
    onExpandedChange,
  }: {
    filename: string;
    expanded: boolean;
    onExpandedChange: (value: boolean) => void;
  }) => (
    <button type="button" onClick={() => onExpandedChange(!expanded)}>
      office preview {filename} {expanded ? "expanded" : "collapsed"}
    </button>
  ),
}));
vi.mock("@/components/pages/pdf-attachment-preview", () => ({
  PdfAttachmentPreview: ({
    filename,
    expanded,
    onExpandedChange,
  }: {
    filename: string;
    expanded: boolean;
    onExpandedChange: (value: boolean) => void;
  }) => (
    <button type="button" onClick={() => onExpandedChange(!expanded)}>
      pdf preview {filename} {expanded ? "expanded" : "collapsed"}
    </button>
  ),
}));
vi.mock("@/components/pages/video-attachment-preview", () => ({
  VideoAttachmentPreview: ({
    filename,
    contentType,
    onEnterPictureInPicture,
  }: {
    filename: string;
    contentType?: string;
    onEnterPictureInPicture: () => void;
  }) => (
    <button type="button" onClick={onEnterPictureInPicture}>
      video preview {filename} {contentType ?? "unknown type"}
    </button>
  ),
}));
vi.mock("@/components/pages/office-attachment-editor", () => ({
  OfficeAttachmentEditor: ({ filename }: { filename: string }) => (
    <div>office editor {filename}</div>
  ),
}));

const ID = "11111111-1111-1111-1111-111111111111";

Element.prototype.scrollIntoView ??= () => {};

type Meta = {
  filename: string;
  content_type: string;
  size_bytes?: number;
  created_at?: string;
};

/** Answers the details request, and the content request when the file is text. */
function stubAttachment(meta: Meta, content = "", contentOk = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/content")) {
        if (!contentOk) throw new Error("content failed");
        return new Response(content);
      }
      return new Response(
        JSON.stringify({
          id: ID,
          page_id: "page-1",
          size_bytes: 2048,
          created_at: "2026-10-14T08:00:00Z",
          ...meta,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }),
  );
}

function open() {
  const view = render(
    <RichTextEditor content="<p>hi</p>" onChange={vi.fn()} />,
  );
  act(() => {
    document.dispatchEvent(
      new CustomEvent("wikihub:view-file-details", { detail: ID }),
    );
  });
  return view;
}

afterEach(() => vi.unstubAllGlobals());

describe("attachment details modal states", () => {
  it("shows a message and closes when the attachment is gone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    open();

    expect(
      await screen.findByText("This attachment no longer exists."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    await waitFor(() =>
      expect(
        screen.queryByText("This attachment no longer exists."),
      ).toBeNull(),
    );
  });

  it("uses the message from the API envelope when there is one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { message: "No access to this file." } }),
            { status: 403 },
          ),
      ),
    );
    open();

    expect(
      await screen.findByText("No access to this file."),
    ).toBeInTheDocument();
  });

  it("reports the status when a failure carries no message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    open();

    expect(await screen.findByText(/500/)).toBeInTheDocument();
  });

  it("says so when the request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "offline";
      }),
    );
    open();

    expect(await screen.findByText("An error occurred.")).toBeInTheDocument();
  });

  it("names the file in the info tooltip, with its size and type", async () => {
    stubAttachment({
      filename: "report.bin",
      content_type: "application/octet-stream",
      size_bytes: 0,
    });
    open();

    expect(
      await screen.findByText("No preview available for this file type."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tooltip")[0]).toHaveTextContent("0 Bytes");
    expect(screen.getAllByRole("tooltip")[0]).toHaveTextContent("report.bin");
  });

  it("shows an image in place", async () => {
    stubAttachment({
      filename: "chart.png",
      content_type: "image/png",
      size_bytes: 5 * 1024 * 1024,
    });
    open();

    const image = await screen.findByRole("img", { name: "chart.png" });
    expect(image).toHaveAttribute("src", `/api/v1/attachments/${ID}/content`);
    expect(screen.getAllByRole("tooltip")[0]).toHaveTextContent("5 MB");
  });

  it("hands a video its content type, and closes when it goes picture-in-picture", async () => {
    stubAttachment({ filename: "clip.mp4", content_type: "video/mp4" });
    open();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "video preview clip.mp4 video/mp4",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /video preview/ }),
      ).toBeNull(),
    );
  });

  it("leaves a video's type out when the server only knows it as a byte stream", async () => {
    stubAttachment({
      filename: "clip.mov",
      content_type: "application/octet-stream",
    });
    open();

    expect(
      await screen.findByRole("button", {
        name: "video preview clip.mov unknown type",
      }),
    ).toBeInTheDocument();
  });

  it("opens a PDF preview that can expand", async () => {
    stubAttachment({ filename: "spec.pdf", content_type: "application/pdf" });
    open();

    const preview = await screen.findByRole("button", {
      name: "pdf preview spec.pdf collapsed",
    });
    fireEvent.click(preview);
    expect(
      await screen.findByRole("button", {
        name: "pdf preview spec.pdf expanded",
      }),
    ).toBeInTheDocument();
  });

  it("opens an office preview that can expand", async () => {
    stubAttachment({
      filename: "plan.xlsx",
      content_type: "application/vnd.ms-excel",
    });
    open();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "office preview plan.xlsx collapsed",
      }),
    );
    expect(
      await screen.findByRole("button", {
        name: "office preview plan.xlsx expanded",
      }),
    ).toBeInTheDocument();
  });

  it("lets someone with permission switch an office file between editing and preview", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubAttachment({
        filename: "plan.docx",
        content_type: "application/msword",
      });
      open();

      fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
      expect(
        await screen.findByText("office editor plan.docx"),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Back to preview" }));
      expect(
        await screen.findByRole("button", { name: /office preview plan.docx/ }),
      ).toBeInTheDocument();
      // The preview is reloaded after the editor's save has had time to land.
      await act(async () => {
        vi.advanceTimersByTime(1600);
      });
      expect(
        document.querySelector('a[download="plan.docx"]')?.getAttribute("href"),
      ).toContain("?v=1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("copes with a text file whose content cannot be read", async () => {
    stubAttachment(
      { filename: "notes.txt", content_type: "text/plain" },
      "",
      false,
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    open();

    expect(
      await screen.findByText("No preview available for this file type."),
    ).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("copes with a text file whose content request is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/content")
          ? new Response("", { status: 500 })
          : new Response(
              JSON.stringify({
                id: ID,
                page_id: "p",
                filename: "a.txt",
                content_type: "text/plain",
                size_bytes: 1,
                created_at: "2026-10-14T08:00:00Z",
              }),
            ),
      ),
    );
    open();

    expect(
      await screen.findByText("No preview available for this file type."),
    ).toBeInTheDocument();
  });
});

describe("text preview search and wrapping", () => {
  const body = "alpha beta\nBeta gamma\nnothing here\nbeta";

  beforeEach(() =>
    stubAttachment({ filename: "notes.txt", content_type: "text/plain" }, body),
  );

  it("steps through matches with the arrows and with Enter, wrapping at both ends", async () => {
    const user = userEvent.setup();
    open();
    const search = await screen.findByPlaceholderText("Search content...");

    await user.type(search, "beta");
    expect(screen.getByText("1/3")).toBeInTheDocument();

    await user.click(screen.getByTitle("Next match"));
    expect(screen.getByText("2/3")).toBeInTheDocument();
    await user.click(screen.getByTitle("Next match"));
    await user.click(screen.getByTitle("Next match"));
    expect(screen.getByText("1/3")).toBeInTheDocument();
    await user.click(screen.getByTitle("Previous match"));
    expect(screen.getByText("3/3")).toBeInTheDocument();

    await user.type(search, "{Enter}");
    expect(screen.getByText("1/3")).toBeInTheDocument();
    await user.type(search, "{Shift>}{Enter}{/Shift}");
    expect(screen.getByText("3/3")).toBeInTheDocument();
  });

  it("ignores Enter when nothing matches, and other keys always", async () => {
    const user = userEvent.setup();
    open();
    const search = await screen.findByPlaceholderText("Search content...");

    await user.type(search, "zzz{Enter}");
    expect(screen.queryByText(/\d+\/\d+/)).toBeNull();
    await user.type(search, "q");
    expect(search).toHaveValue("zzzq");
  });

  it("toggles line wrapping", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByPlaceholderText("Search content...");

    await user.click(screen.getByTitle("Enable line wrapping"));
    expect(screen.getByTitle("Disable line wrapping")).toBeInTheDocument();
    await user.click(screen.getByTitle("Disable line wrapping"));
    expect(screen.getByTitle("Enable line wrapping")).toBeInTheDocument();
  });

  it("focuses the search box with the find shortcut", async () => {
    open();
    const search = await screen.findByPlaceholderText("Search content...");

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(search).toHaveFocus();
    fireEvent.keyDown(window, { key: "x" });
  });
});

describe("audio preview", () => {
  const frames: FrameRequestCallback[] = [];

  class FakeContext {
    destination = {};
    resume = vi.fn(async () => {});
    close = vi.fn(async () => {});
    createAnalyser() {
      return {
        fftSize: 0,
        smoothingTimeConstant: 0,
        frequencyBinCount: 64,
        getByteFrequencyData: (data: Uint8Array) => data.fill(180),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }
    createMediaElementSource() {
      return { connect: vi.fn(), disconnect: vi.fn() };
    }
  }

  beforeEach(() => {
    frames.length = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    stubAttachment({ filename: "song.mp3", content_type: "audio/mpeg" });
  });

  async function audioElement() {
    await screen.findByRole("img", { name: "Animated audio waveform" });
    return document.querySelector("audio") as HTMLAudioElement;
  }

  const bars = () => document.querySelectorAll('[role="img"] > span');

  it("animates the waveform while playing and settles when paused or finished", async () => {
    vi.stubGlobal("AudioContext", FakeContext);
    open();
    const audio = await audioElement();
    expect(audio).toHaveAttribute("aria-label", "Preview audio: song.mp3");

    fireEvent.play(audio);
    await waitFor(() => expect(frames.length).toBe(1));
    await act(async () => {
      frames.shift()!(100);
    });
    // A second frame inside the same 42ms slot only schedules the next one.
    await act(async () => {
      frames.shift()!(110);
    });
    expect(bars()[0]).toHaveClass("bg-primary/80");
    expect(bars().length).toBeGreaterThan(50);

    // Playing again reuses the audio context.
    fireEvent.play(audio);
    fireEvent.pause(audio);
    expect(bars()[0]).toHaveClass("bg-muted-foreground/30");
    fireEvent.play(audio);
    fireEvent.ended(audio);
    expect(bars()[0]).toHaveClass("bg-muted-foreground/30");
  });

  it("falls back to the prefixed audio context", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", FakeContext);
    open();

    fireEvent.play(await audioElement());
    await waitFor(() => expect(frames.length).toBe(1));
  });

  it("keeps the native controls when the browser has no Web Audio", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    open();

    fireEvent.play(await audioElement());
    expect(frames.length).toBe(0);
  });

  it("still marks playback when Web Audio refuses to start", async () => {
    vi.stubGlobal(
      "AudioContext",
      class extends FakeContext {
        resume = vi.fn(async () => {
          throw new Error("blocked");
        });
      },
    );
    open();

    fireEvent.play(await audioElement());
    await waitFor(() => expect(bars()[0]).toHaveClass("bg-primary/80"));
  });

  it("stops the animation and closes the context when the modal goes away", async () => {
    const close = vi.fn(async () => {});
    vi.stubGlobal(
      "AudioContext",
      class extends FakeContext {
        close = close;
      },
    );
    const { unmount } = open();

    fireEvent.play(await audioElement());
    await waitFor(() => expect(frames.length).toBe(1));
    unmount();
    expect(close).toHaveBeenCalled();
  });
});
