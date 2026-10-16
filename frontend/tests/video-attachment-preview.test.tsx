import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api-client";
import { VideoAttachmentPreview } from "@/components/pages/video-attachment-preview";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));

type FakeTrack = { mode: string; label?: string; language?: string; enabled?: boolean };

/** jsdom has no media pipeline: stand in for the parts the player reads and drives. */
class FakeList extends EventTarget {
  items: FakeTrack[];
  constructor(items: FakeTrack[]) {
    super();
    this.items = items;
  }
  get length() {
    return this.items.length;
  }
}

const textTrackLists = new WeakMap<HTMLVideoElement, FakeList>();
const audioTrackLists = new WeakMap<HTMLVideoElement, FakeList | undefined>();
let pendingTextTracks = 0;
let pendingAudio: FakeTrack[] | undefined;

function textList(video: HTMLVideoElement) {
  let list = textTrackLists.get(video);
  if (!list) {
    list = new FakeList(Array.from({ length: pendingTextTracks }, () => ({ mode: "disabled" })));
    // Index access, like the real TextTrackList.
    textTrackLists.set(
      video,
      new Proxy(list, {
        get: (target, key) => (typeof key === "string" && /^\d+$/.test(key) ? target.items[Number(key)] : Reflect.get(target, key, target)),
      }) as FakeList,
    );
    list = textTrackLists.get(video)!;
  }
  return list;
}

function audioList(video: HTMLVideoElement) {
  if (!audioTrackLists.has(video)) {
    audioTrackLists.set(
      video,
      pendingAudio
        ? (new Proxy(new FakeList(pendingAudio), {
            get: (target, key) =>
              typeof key === "string" && /^\d+$/.test(key) ? target.items[Number(key)] : Reflect.get(target, key, target),
          }) as FakeList)
        : undefined,
    );
  }
  return audioTrackLists.get(video);
}

const SUBTITLE_TRACKS = [
  { id: "s1", kind: "subtitle", label: "English", language: "en", src: "/s1.vtt", is_default: true },
  { id: "s2", kind: "subtitle", label: "Vietnamese", language: "vi", src: "/s2.vtt", is_default: false },
  { id: "s3", kind: "subtitle", label: "Hidden", language: null, src: null, is_default: false },
];

function serveTracks(subtitles = SUBTITLE_TRACKS, audio: unknown[] = []) {
  vi.mocked(api.get).mockResolvedValue({ subtitles, audio });
}

beforeEach(() => {
  pendingTextTracks = 2;
  pendingAudio = undefined;
  vi.mocked(api.get).mockReset().mockResolvedValue({ subtitles: [], audio: [] });
  Object.defineProperty(HTMLVideoElement.prototype, "textTracks", {
    configurable: true,
    get(this: HTMLVideoElement) {
      return textList(this);
    },
  });
  Object.defineProperty(HTMLVideoElement.prototype, "audioTracks", {
    configurable: true,
    get(this: HTMLVideoElement) {
      return audioList(this);
    },
  });
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(async () => {});
  HTMLMediaElement.prototype.load = vi.fn();
});

afterEach(() => {
  // Unmount first: the player removes its listeners from the very lists deleted below.
  cleanup();
  delete (HTMLVideoElement.prototype as unknown as { textTracks?: unknown }).textTracks;
  delete (HTMLVideoElement.prototype as unknown as { audioTracks?: unknown }).audioTracks;
  delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
  delete (document as unknown as { pictureInPictureElement?: unknown }).pictureInPictureElement;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const video = () => document.querySelector("video") as HTMLVideoElement;
const mount = (props: Partial<React.ComponentProps<typeof VideoAttachmentPreview>> = {}) =>
  render(
    <VideoAttachmentPreview
      attachmentId="att-1"
      contentUrl="/v.mp4"
      contentType="video/mp4"
      filename="demo.mp4"
      {...props}
    />,
  );

describe("VideoAttachmentPreview", () => {
  it("plays the file, and offers speeds even when it has no tracks", async () => {
    const user = userEvent.setup();
    mount();

    expect(screen.getByLabelText("Preview video: demo.mp4")).toBeInTheDocument();
    expect(video().querySelector("source")).toHaveAttribute("src", "/v.mp4");
    expect(screen.queryByTitle("Subtitles")).toBeNull();
    expect(screen.queryByTitle("Audio track")).toBeNull();
    expect(screen.queryByTitle("Picture in picture")).toBeNull();

    await user.click(screen.getByTitle("Playback speed"));
    await user.click(await screen.findByRole("menuitem", { name: "1.5x" }));
    expect(video().playbackRate).toBe(1.5);
    expect(screen.getByTitle("Playback speed")).toHaveTextContent("1.5x");

    await user.click(screen.getByTitle("Playback speed"));
    await user.click(await screen.findByRole("menuitem", { name: "Normal" }));
    expect(screen.getByTitle("Playback speed")).toHaveTextContent("1x");
  });

  it("follows a speed changed from the video's own menu", async () => {
    mount();
    await act(async () => {
      video().playbackRate = 2;
      video().dispatchEvent(new Event("ratechange"));
    });

    expect(screen.getByTitle("Playback speed")).toHaveTextContent("2x");
  });

  it("lists the subtitles that have a file, and switches between them", async () => {
    serveTracks();
    const user = userEvent.setup();
    mount();

    const button = await screen.findByTitle("Subtitles");
    expect(button).toHaveTextContent("Subtitles off");
    expect(video().querySelectorAll("track")).toHaveLength(2);

    await user.click(button);
    await user.click(await screen.findByRole("menuitem", { name: "Vietnamese" }));
    expect(textList(video()).items.map((track) => track.mode)).toEqual(["disabled", "showing"]);
    expect(screen.getByTitle("Subtitles")).toHaveTextContent("Vietnamese");

    await user.click(screen.getByTitle("Subtitles"));
    await user.click(await screen.findByRole("menuitem", { name: "Off" }));
    expect(textList(video()).items.map((track) => track.mode)).toEqual(["disabled", "disabled"]);
  });

  it("shows a subtitle the browser turned on by itself", async () => {
    serveTracks();
    mount();
    await screen.findByTitle("Subtitles");

    await act(async () => {
      textList(video()).items[0]!.mode = "showing";
      textList(video()).dispatchEvent(new Event("change"));
    });

    expect(screen.getByTitle("Subtitles")).toHaveTextContent("English");
  });

  it("keeps working when the tracks cannot be loaded", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("down"));
    mount();

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByTitle("Playback speed")).toBeInTheDocument();
  });

  it("offers audio tracks the browser can switch between", async () => {
    pendingAudio = [
      { mode: "", label: "  ", language: "en", enabled: true },
      { mode: "", label: "Commentary", enabled: false },
      { mode: "", enabled: false },
    ];
    serveTracks([], [{ id: "a3", kind: "audio", label: "Third from server", language: null, src: null, is_default: false }]);
    const user = userEvent.setup();
    mount();

    await act(async () => {
      video().dispatchEvent(new Event("loadedmetadata"));
    });
    const button = await screen.findByTitle("Audio track");
    expect(button).toHaveTextContent("Third from server");

    await user.click(button);
    expect(await screen.findByRole("menuitem", { name: "Commentary" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Audio 3" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Commentary" }));

    expect(audioList(video())!.items.map((track) => track.enabled)).toEqual([false, true, false]);
    expect(screen.getByTitle("Audio track")).toHaveTextContent("Commentary");
  });

  it("does not offer an audio choice when there is only one track", async () => {
    pendingAudio = [{ mode: "", label: "Only", enabled: true }];
    mount();
    await act(async () => {
      video().dispatchEvent(new Event("loadedmetadata"));
    });

    expect(screen.queryByTitle("Audio track")).toBeNull();
  });

  it("puts the track controls in the header when asked", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mount({ toolbarContainer: host });

    expect(within(host).getByTitle("Playback speed")).toBeInTheDocument();
    expect(document.querySelector(".flex.shrink-0.flex-wrap")).toBeNull();
    host.remove();
  });

  it("toggles playback with Space anywhere in the preview, but not from a button or the video", async () => {
    mount();
    const space = (target: Element) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true }));

    Object.defineProperty(video(), "paused", { configurable: true, value: true });
    space(document.body);
    expect(video().play).toHaveBeenCalled();

    Object.defineProperty(video(), "paused", { configurable: true, value: false });
    space(document.body);
    expect(video().pause).toHaveBeenCalled();

    const calls = vi.mocked(video().pause).mock.calls.length + vi.mocked(video().play).mock.calls.length;
    space(video());
    space(screen.getByTitle("Playback speed"));
    const input = document.body.appendChild(document.createElement("input"));
    space(input);
    const editable = document.body.appendChild(document.createElement("div"));
    Object.defineProperty(editable, "isContentEditable", { value: true });
    space(editable);
    fireEvent.keyDown(document.body, { key: "a" });
    expect(vi.mocked(video().pause).mock.calls.length + vi.mocked(video().play).mock.calls.length).toBe(calls);
  });

  it("stops playback for good when it is removed", () => {
    const { unmount } = mount();
    const element = video();

    unmount();

    expect(element.pause).toHaveBeenCalled();
    expect(element.load).toHaveBeenCalled();
  });

  it("leaves playback running when the video is floating in Picture-in-Picture", () => {
    const { unmount } = mount();
    const element = video();
    Object.defineProperty(document, "pictureInPictureElement", { configurable: true, value: element });
    vi.mocked(element.pause).mockClear();

    unmount();

    expect(element.pause).not.toHaveBeenCalled();
  });
});

type PipWindow = ReturnType<typeof fakePipWindow>;

function fakePipWindow() {
  const doc = document.implementation.createHTMLDocument("pip");
  const listeners = new Map<string, ((event: Event) => void)[]>();
  return {
    document: doc,
    innerWidth: 240,
    innerHeight: 100,
    resizeTo: vi.fn(),
    addEventListener: vi.fn((type: string, fn: (event: Event) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    }),
    fire(type: string) {
      for (const fn of listeners.get(type) ?? []) fn(new Event(type));
      listeners.delete(type);
    },
    fireKeep(type: string) {
      for (const fn of listeners.get(type) ?? []) fn(new Event(type));
    },
  };
}

function installDocumentPip(pipWindow: PipWindow | Error) {
  const requestWindow = vi.fn(async () => {
    if (pipWindow instanceof Error) throw pipWindow;
    return pipWindow as unknown as Window;
  });
  (window as unknown as { documentPictureInPicture: unknown }).documentPictureInPicture = { requestWindow };
  return requestWindow;
}

describe("VideoAttachmentPreview in Picture-in-Picture", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("moves the video into a floating window, closes the modal, and hands the playback back on back-to-tab", async () => {
    const pip = fakePipWindow();
    const requestWindow = installDocumentPip(pip);
    const entered = vi.fn();
    const reopened = vi.fn();
    window.addEventListener("wikihub:open-attachment-modal", reopened);
    serveTracks();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = mount({ onEnterPictureInPicture: entered });
    await screen.findByTitle("Subtitles");
    expect(video()).toHaveAttribute("disablepictureinpicture");
    const element = video();
    Object.defineProperty(element, "videoWidth", { configurable: true, value: 1920 });
    Object.defineProperty(element, "videoHeight", { configurable: true, value: 1080 });
    element.currentTime = 12;
    element.playbackRate = 1.25;
    element.muted = true;
    Object.defineProperty(element, "paused", { configurable: true, value: false });
    textList(element).items[1]!.mode = "showing";
    // One stylesheet that can be read, one that cannot (with and without an address).
    Object.defineProperty(document, "styleSheets", {
      configurable: true,
      value: [
        { cssRules: [{ cssText: "a { color: red }" }] },
        {
          get cssRules(): never {
            throw new Error("cross-origin");
          },
          href: "https://cdn.example.test/x.css",
        },
        {
          get cssRules(): never {
            throw new Error("cross-origin");
          },
          href: null,
        },
      ],
    });

    await user.click(screen.getByTitle("Picture in picture"));

    await waitFor(() => expect(entered).toHaveBeenCalled());
    expect(requestWindow).toHaveBeenCalledWith({ width: 240, height: 135 });
    expect(pip.document.body.contains(element)).toBe(true);
    expect(pip.document.head.querySelectorAll("style")).toHaveLength(1);
    // The window has its own document, so jest-dom's element check does not apply to it.
    expect(pip.document.head.querySelector('link[rel="stylesheet"]')?.getAttribute("href")).toBe(
      "https://cdn.example.test/x.css",
    );
    expect(pip.resizeTo).toHaveBeenCalled();

    // The window is resized by hand; the user clicks into it; resizing is refused once.
    pip.innerWidth = 480;
    pip.innerHeight = 270;
    pip.fireKeep("resize");
    expect(element.style.width).toBe("480px");
    pip.resizeTo.mockImplementationOnce(() => {
      throw new Error("needs a gesture");
    });
    pip.fire("click");

    // The modal is unmounted by the caller; the floating video must keep going.
    first.unmount();
    expect(element.pause).not.toHaveBeenCalled();

    // Back to tab: the page never regains focus.
    pip.fire("pagehide");
    await act(async () => {
      vi.advanceTimersByTime(301);
    });
    expect(reopened).toHaveBeenCalled();
    expect(element.pause).toHaveBeenCalled();
    expect(element.load).toHaveBeenCalled();

    // The reopened preview resumes exactly where the floating video was.
    mount();
    Object.defineProperty(video(), "readyState", { configurable: true, value: 1 });
    await act(async () => {
      vi.advanceTimersByTime(5);
    });
    await waitFor(() => expect(video().play).toHaveBeenCalled());
    expect(video().currentTime).toBe(12);
    expect(video().playbackRate).toBe(1.25);
    expect(video().muted).toBe(true);
    window.removeEventListener("wikihub:open-attachment-modal", reopened);
    Reflect.deleteProperty(document, "styleSheets");
  });

  it("does not resume after the floating window's own close button", async () => {
    const pip = fakePipWindow();
    installDocumentPip(pip);
    const reopened = vi.fn();
    window.addEventListener("wikihub:open-attachment-modal", reopened);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = mount();
    await user.click(screen.getByTitle("Picture in picture"));
    await waitFor(() => expect(pip.addEventListener).toHaveBeenCalled());
    first.unmount();

    // The window's own close hands this page its focus back.
    pip.fire("pagehide");
    window.dispatchEvent(new Event("focus"));
    await act(async () => {
      vi.advanceTimersByTime(301);
    });

    expect(reopened).not.toHaveBeenCalled();
    window.removeEventListener("wikihub:open-attachment-modal", reopened);
  });

  it("waits for metadata before resuming a video that has not loaded yet", async () => {
    const pip = fakePipWindow();
    installDocumentPip(pip);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = mount();
    await user.click(screen.getByTitle("Picture in picture"));
    await waitFor(() => expect(pip.addEventListener).toHaveBeenCalled());
    first.unmount();
    pip.fire("pagehide");
    await act(async () => {
      vi.advanceTimersByTime(301);
    });

    mount();
    await act(async () => {
      vi.advanceTimersByTime(5);
    });
    expect(video().play).not.toHaveBeenCalled();
    await act(async () => {
      video().dispatchEvent(new Event("loadedmetadata"));
    });
    expect(video().currentTime).toBe(0);
  });

  it("restores the video when the floating window cannot be opened", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    installDocumentPip(new Error("denied"));
    const entered = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = mount({ onEnterPictureInPicture: entered });
    const element = video();
    element.style.cssText = "color: red;";

    await user.click(screen.getByTitle("Picture in picture"));

    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(element.style.cssText).toBe("color: red;");
    expect(entered).not.toHaveBeenCalled();
    unmount();
    expect(element.pause).toHaveBeenCalled();
  });

  it("does nothing when the page has lost its floating-window support", async () => {
    const pip = fakePipWindow();
    installDocumentPip(pip);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mount();
    const button = screen.getByTitle("Picture in picture");
    delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;

    await user.click(button);

    expect(pip.addEventListener).not.toHaveBeenCalled();
  });

  it("uses the browser's own Picture-in-Picture where the floating window is not available", async () => {
    const reopened = vi.fn();
    window.addEventListener("wikihub:open-attachment-modal", reopened);
    const entered = vi.fn();
    mount({ onEnterPictureInPicture: entered });
    expect(video()).not.toHaveAttribute("disablepictureinpicture");
    expect(screen.queryByTitle("Picture in picture")).toBeNull();

    await act(async () => {
      video().dispatchEvent(new Event("enterpictureinpicture"));
    });
    expect(entered).toHaveBeenCalled();
    await act(async () => {
      video().dispatchEvent(new Event("leavepictureinpicture"));
      vi.advanceTimersByTime(301);
    });

    expect(reopened).toHaveBeenCalled();
    expect(video().pause).toHaveBeenCalled();
    window.removeEventListener("wikihub:open-attachment-modal", reopened);
  });

  it("does not bring the preview back when leaving the browser's Picture-in-Picture returns focus here", async () => {
    const reopened = vi.fn();
    window.addEventListener("wikihub:open-attachment-modal", reopened);
    mount();

    await act(async () => {
      video().dispatchEvent(new Event("enterpictureinpicture"));
    });
    await act(async () => {
      video().dispatchEvent(new Event("leavepictureinpicture"));
      window.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(301);
    });

    expect(reopened).not.toHaveBeenCalled();
    expect(video().pause).toHaveBeenCalled();
    window.removeEventListener("wikihub:open-attachment-modal", reopened);
  });
});
