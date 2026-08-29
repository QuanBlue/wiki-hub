"use client";

import { Captions, CaptionsOff, Check, Gauge, PictureInPicture2, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";

type MediaTrack = {
  id: string;
  kind: "subtitle" | "audio";
  label: string;
  language: string | null;
  src: string | null;
  is_default: boolean;
};

type MediaTracks = { subtitles: MediaTrack[]; audio: MediaTrack[] };

/** An audio track the *browser* is willing to switch between. */
type SwitchableAudioTrack = { index: number; label: string; enabled: boolean };

const SUBTITLES_OFF = "off";
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
/** Cap on the floating Picture-in-Picture window's width, in CSS pixels -
 *  without it, requesting a window sized to the video's native resolution
 *  produces a "floating" window that fills half the screen. */
const PIP_MAX_WIDTH = 360;

// The Document Picture-in-Picture API isn't part of TypeScript's DOM lib yet,
// so its shape is declared by hand rather than relying on `lib.dom.d.ts`.
type DocumentPipWindow = Window & { document: Document };
type DocumentPictureInPicture = {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<DocumentPipWindow>;
};

function documentPip(): DocumentPictureInPicture | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture })
      .documentPictureInPicture ?? null
  );
}

/**
 * Picture-in-Picture exists to keep a video going while you do something
 * else, so leaving this modal open behind it (or worse, killing playback
 * outright) misses the point. Once PiP starts, the modal closes itself; once
 * the viewer leaves PiP - "back to tab", or just closing the floating window
 * - a fresh preview reopens through the same modal-open event the rest of
 * the app already uses, picking up right where the floating video left off.
 * Keyed by attachment id rather than React state: the preview that reopens
 * is a brand new component instance with no memory of the one that was
 * floating in PiP, so the handoff has to live outside any one instance.
 */
const pipResumeState = new Map<
  string,
  { time: number; playing: boolean; playbackRate: number; subtitleId: string }
>();

/** Reads which subtitle (if any) is actually showing directly off the live
 *  TextTrack objects, so a handoff always captures the truth regardless of
 *  whether it was chosen through this app's own dropdown or a native control. */
function currentSubtitleId(video: HTMLVideoElement, subtitleList: MediaTrack[]): string {
  const textTracks = video.textTracks;
  for (let index = 0; index < textTracks.length; index += 1) {
    if (textTracks[index].mode === "showing") return subtitleList[index]?.id ?? SUBTITLES_OFF;
  }
  return SUBTITLES_OFF;
}

function captureResumeState(
  video: HTMLVideoElement,
  attachmentId: string,
  subtitleList: MediaTrack[],
) {
  pipResumeState.set(attachmentId, {
    time: video.currentTime,
    playing: !video.paused,
    playbackRate: video.playbackRate,
    subtitleId: currentSubtitleId(video, subtitleList),
  });
}

function reopenPreview(attachmentId: string) {
  window.dispatchEvent(
    new CustomEvent("wikihub:open-attachment-modal", { detail: { attachmentId } }),
  );
}

/**
 * A browser exposes an audio track list only in some engines, and never for
 * plain progressive MP4 in Chromium. Read it defensively rather than assuming
 * a shape that may not exist at all.
 */
function readAudioTracks(
  video: HTMLVideoElement,
  labels: MediaTrack[],
): SwitchableAudioTrack[] {
  const list = (video as HTMLVideoElement & { audioTracks?: unknown }).audioTracks as
    | (ArrayLike<{ label?: string; language?: string; enabled?: boolean }> & {
        addEventListener?: (type: string, listener: () => void) => void;
      })
    | undefined;
  if (!list || typeof list.length !== "number" || list.length < 2) return [];
  return Array.from({ length: list.length }, (_, index) => {
    const track = list[index];
    return {
      index,
      label:
        track?.label?.trim() ||
        labels[index]?.label ||
        track?.language?.trim() ||
        `Audio ${index + 1}`,
      enabled: Boolean(track?.enabled),
    };
  });
}

export function VideoAttachmentPreview({
  attachmentId,
  contentUrl,
  contentType,
  filename,
  toolbarContainer,
  onEnterPictureInPicture,
}: {
  attachmentId: string;
  contentUrl: string;
  contentType?: string;
  filename: string;
  /** Where the track controls belong: the Preview header, beside Download. */
  toolbarContainer?: HTMLElement | null;
  /**
   * Picture-in-Picture is meant to keep playing while you go do something
   * else, and this modal has nothing left to show once it starts - just a
   * "Playing in picture-in-picture" placeholder - so the caller uses this to
   * close it out from under the floating video instead of leaving it lying
   * open behind it.
   */
  onEnterPictureInPicture?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tracks, setTracks] = useState<MediaTracks>({ subtitles: [], audio: [] });
  const [activeSubtitle, setActiveSubtitle] = useState<string>(SUBTITLES_OFF);
  const [audioTracks, setAudioTracks] = useState<SwitchableAudioTrack[]>([]);
  const [playbackRate, setPlaybackRate] = useState(1);
  // Set the instant the video is manually moved into a Document
  // Picture-in-Picture window (see enterDocumentPip below) - the unmount
  // cleanup reads this to know the element now belongs to that window and
  // must be left alone rather than paused and torn down.
  const handedToPipWindowRef = useRef(false);
  // A subtitle to restore once tracks have loaded back in, after reopening
  // from a Picture-in-Picture handoff (see the resume effect below).
  const pendingSubtitleRef = useRef<string | null>(null);
  const supportsDocumentPip = documentPip() !== null;

  // Mounted with a key of the attachment id, so a different attachment gets a
  // fresh component rather than needing its state cleared here.
  useEffect(() => {
    let cancelled = false;
    api
      .get<MediaTracks>(`/api/v1/attachments/${attachmentId}/media-tracks`)
      .then((result) => {
        if (!cancelled) setTracks(result);
      })
      .catch(() => {
        // Tracks are an addition to the player, never a precondition for it.
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  // Only tracks with a source are rendered, and the browser lists its
  // TextTrack objects in that same order - so this one array is what keeps the
  // menu, the `<track>` elements and `video.textTracks` index-aligned.
  const subtitles = useMemo(
    () => tracks.subtitles.filter((track) => track.src),
    [tracks.subtitles],
  );

  // Picks up where a video left off if this preview just reopened after
  // outliving its own instance in a Picture-in-Picture window (see the two
  // handoff points below). Playback position and rate apply as soon as the
  // element has metadata; the subtitle choice needs the track list to have
  // loaded first, so it's stashed in a ref for the effect further down.
  useEffect(() => {
    const resume = pipResumeState.get(attachmentId);
    if (!resume) return;
    pipResumeState.delete(attachmentId);
    pendingSubtitleRef.current = resume.subtitleId;
    const video = videoRef.current;
    if (!video) return;
    const applyResume = () => {
      video.currentTime = resume.time;
      video.playbackRate = resume.playbackRate;
      if (resume.playing) void video.play().catch(() => {});
    };
    if (video.readyState >= 1) applyResume();
    else video.addEventListener("loadedmetadata", applyResume, { once: true });
  }, [attachmentId]);

  // The Picture-in-Picture window (classic or Document) mirrors only the
  // decoded video frame, not the caption overlay the page draws over the
  // element - so its captions never show up there. Document Picture-in-Picture
  // instead hands the video a real floating *window* this app controls, which
  // renders it exactly like any other page and therefore keeps captions
  // working. Where it's supported, the browser's own entry points are
  // disabled (see `disablePictureInPicture` below) in favor of the button
  // this renders, so this is the only way to enter Picture-in-Picture there.
  async function enterDocumentPip() {
    const pip = documentPip();
    const video = videoRef.current;
    if (!pip || !video) return;
    try {
      const nativeWidth = video.videoWidth || 640;
      const nativeHeight = video.videoHeight || 360;
      const width = Math.min(PIP_MAX_WIDTH, nativeWidth);
      const height = Math.round(width * (nativeHeight / nativeWidth));
      const pipWindow = await pip.requestWindow({ width, height });

      // Carry the app's styling over so the native controls (and caption
      // cues, which are styled through the same stylesheet) look right
      // instead of unstyled black-on-white.
      for (const styleSheet of Array.from(document.styleSheets)) {
        try {
          const rules = Array.from(styleSheet.cssRules)
            .map((rule) => rule.cssText)
            .join("\n");
          const style = pipWindow.document.createElement("style");
          style.textContent = rules;
          pipWindow.document.head.appendChild(style);
        } catch {
          // A cross-origin stylesheet's rules can't be read - link to it
          // instead so it still loads inside the PiP window's own document.
          if (styleSheet.href) {
            const link = pipWindow.document.createElement("link");
            link.rel = "stylesheet";
            link.href = styleSheet.href;
            pipWindow.document.head.appendChild(link);
          }
        }
      }
      pipWindow.document.body.style.margin = "0";
      pipWindow.document.body.style.background = "#000";
      pipWindow.document.body.style.height = "100vh";
      pipWindow.document.body.style.overflow = "hidden";

      handedToPipWindowRef.current = true;
      pipWindow.document.body.appendChild(video);
      video.style.width = "100%";
      video.style.height = "100%";
      video.style.objectFit = "contain";

      // The browser's own "back to tab" control means "keep watching, just
      // bring the tab forward", so that (or anything else that closes this
      // window without going through the button below) resumes the preview.
      // But the platform gives no way to tell "back to tab" apart from any
      // other way the window closes - not even from a plain close/X, since
      // Document Picture-in-Picture only ever fires one undifferentiated
      // "pagehide" regardless of cause - so an explicit close control of our
      // own, understood to mean "done watching", is the only reliable way to
      // offer a real stop.
      let closedForGood = false;
      const closeButton = pipWindow.document.createElement("button");
      closeButton.type = "button";
      closeButton.title = "Close and stop";
      closeButton.setAttribute("aria-label", "Close and stop");
      closeButton.textContent = "✕";
      closeButton.style.cssText =
        "position:fixed;top:6px;right:6px;z-index:2147483647;width:26px;height:26px;" +
        "border-radius:9999px;border:none;background:rgba(0,0,0,0.55);color:#fff;" +
        "font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;" +
        "justify-content:center;padding:0;";
      closeButton.addEventListener("click", () => {
        closedForGood = true;
        pipWindow.close();
      });
      pipWindow.document.body.appendChild(closeButton);

      // Not wrapped in a React effect on purpose: this listener has to keep
      // working after this component - and the modal it closes below -
      // unmounts, which is exactly when a `useEffect` cleanup would
      // otherwise tear it back down again.
      pipWindow.addEventListener(
        "pagehide",
        () => {
          if (!closedForGood) {
            captureResumeState(video, attachmentId, subtitles);
            reopenPreview(attachmentId);
          }
          video.pause();
          video.removeAttribute("src");
          video.load();
          video.remove();
        },
        { once: true },
      );

      onEnterPictureInPicture?.();
    } catch (err) {
      handedToPipWindowRef.current = false;
      console.error("Failed to enter Picture-in-Picture", err);
    }
  }

  // The browser's own classic Picture-in-Picture (native context-menu entry
  // or control-bar button, still the only option where Document
  // Picture-in-Picture isn't supported) fires this regardless of how it was
  // triggered. This modal has nothing useful left to show once it starts, so
  // hand off to the floating window the same way the button above does.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || supportsDocumentPip) return;
    const handleEnterPip = () => {
      onEnterPictureInPicture?.();
      // Same reasoning as the Document PiP listener above: attached here,
      // outside any effect cleanup, so it survives this component unmounting
      // when the call above closes the modal.
      video.addEventListener(
        "leavepictureinpicture",
        () => {
          // The classic PiP window's own close (X) button pauses the video as
          // part of leaving, while "back to tab" leaves it exactly as it was
          // - the platform doesn't expose which one was clicked any more
          // directly than that, so a still-playing video is read as "back to
          // tab, keep watching" and an already-paused one as "done".
          if (!video.paused) {
            captureResumeState(video, attachmentId, subtitles);
            reopenPreview(attachmentId);
          }
          video.pause();
          video.removeAttribute("src");
          video.load();
        },
        { once: true },
      );
    };
    video.addEventListener("enterpictureinpicture", handleEnterPip);
    return () => video.removeEventListener("enterpictureinpicture", handleEnterPip);
  }, [attachmentId, onEnterPictureInPicture, supportsDocumentPip, subtitles]);

  // Closing the modal unmounts this component, but React detaching the
  // <video> node from the DOM does not stop playback on its own. Explicitly
  // pausing and clearing the source here is what actually kills playback
  // rather than just hiding it - *except* when the video has just been
  // handed off to a Picture-in-Picture window (classic or Document), where
  // that would defeat the point of Picture-in-Picture. The listeners
  // attached above are what eventually stop it once the viewer actually
  // leaves Picture-in-Picture.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (!video || handedToPipWindowRef.current) return;
      if (document.pictureInPictureElement === video) return;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [attachmentId]);

  // Restores the subtitle a Picture-in-Picture handoff was showing, once the
  // reopened preview's own track list has actually loaded back in.
  useEffect(() => {
    if (!pendingSubtitleRef.current || subtitles.length === 0) return;
    selectSubtitle(pendingSubtitleRef.current);
    pendingSubtitleRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitles]);

  // The video element also exposes its *own* native caption control - the
  // "Captions" entry in its right-click menu, and on some platforms a
  // browser auto-enables a track on its own to match the viewer's OS/browser
  // caption-language preference. Either can flip a TextTrack's mode without
  // this component ever calling `setActiveSubtitle`, which used to leave
  // this button reading "Subtitles off" under a caption that was actively on
  // screen. `textTracks` fires a "change" event whenever any track's mode
  // changes for *any* reason, script or native UI, so listening for it keeps
  // this button truthful to what's really showing instead of just to what
  // this component last chose.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncFromDom = () => setActiveSubtitle(currentSubtitleId(video, subtitles));
    syncFromDom();
    video.textTracks.addEventListener("change", syncFromDom);
    return () => video.textTracks.removeEventListener("change", syncFromDom);
  }, [subtitles]);

  // Applies a choice made from *this* dropdown to the live TextTrack objects
  // - `<track>` display state isn't a DOM attribute React can set declaratively
  // - and lets it win over whatever the browser had picked on its own.
  function selectSubtitle(id: string) {
    setActiveSubtitle(id);
    const video = videoRef.current;
    if (!video) return;
    const textTracks = video.textTracks;
    for (let index = 0; index < textTracks.length; index += 1) {
      textTracks[index].mode = subtitles[index]?.id === id ? "showing" : "disabled";
    }
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setAudioTracks(readAudioTracks(video, tracks.audio));
    sync();
    video.addEventListener("loadedmetadata", sync);
    return () => video.removeEventListener("loadedmetadata", sync);
  }, [tracks.audio]);

  function selectAudioTrack(index: number) {
    const video = videoRef.current;
    if (!video) return;
    const list = (video as HTMLVideoElement & { audioTracks?: unknown }).audioTracks as
      | ArrayLike<{ enabled?: boolean }>
      | undefined;
    if (!list) return;
    for (let position = 0; position < list.length; position += 1) {
      list[position].enabled = position === index;
    }
    setAudioTracks(readAudioTracks(video, tracks.audio));
  }

  // The native "Playback speed" entry in the video's own right-click menu
  // changes `playbackRate` directly, so this listens for "ratechange" rather
  // than only reacting to its own dropdown - the same reasoning as the
  // subtitles sync above.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setPlaybackRate(video.playbackRate);
    sync();
    video.addEventListener("ratechange", sync);
    return () => video.removeEventListener("ratechange", sync);
  }, [attachmentId]);

  function selectPlaybackRate(rate: number) {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
    setPlaybackRate(rate);
  }

  const activeLabel =
    subtitles.find((track) => track.id === activeSubtitle)?.label ?? null;

  const toolbarButtonClass =
    "text-muted-foreground border-border bg-surface hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center gap-1 rounded border px-2 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none";

  const trackControls = (
    <>
      {subtitles.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={toolbarButtonClass} title="Subtitles">
              {activeLabel ? (
                <Captions className="size-3.5" aria-hidden="true" />
              ) : (
                <CaptionsOff className="size-3.5" aria-hidden="true" />
              )}
              <span className="max-w-40 truncate">{activeLabel ?? "Subtitles off"}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-72">
            <DropdownMenuLabel>Subtitles</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => selectSubtitle(SUBTITLES_OFF)}>
              <Check
                className={`size-3.5 ${activeSubtitle === SUBTITLES_OFF ? "" : "invisible"}`}
              />
              Off
            </DropdownMenuItem>
            {subtitles.map((track) => (
              <DropdownMenuItem key={track.id} onSelect={() => selectSubtitle(track.id)}>
                <Check
                  className={`size-3.5 ${activeSubtitle === track.id ? "" : "invisible"}`}
                />
                <span className="truncate">{track.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {audioTracks.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={toolbarButtonClass} title="Audio track">
              <Volume2 className="size-3.5" aria-hidden="true" />
              <span className="max-w-40 truncate">
                {audioTracks.find((track) => track.enabled)?.label ?? "Audio"}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-72">
            <DropdownMenuLabel>Audio track</DropdownMenuLabel>
            {audioTracks.map((track) => (
              <DropdownMenuItem key={track.index} onSelect={() => selectAudioTrack(track.index)}>
                <Check className={`size-3.5 ${track.enabled ? "" : "invisible"}`} />
                <span className="truncate">{track.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={toolbarButtonClass} title="Playback speed">
            <Gauge className="size-3.5" aria-hidden="true" />
            <span>{playbackRate === 1 ? "1x" : `${playbackRate}x`}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-72">
          <DropdownMenuLabel>Playback speed</DropdownMenuLabel>
          {PLAYBACK_RATES.map((rate) => (
            <DropdownMenuItem key={rate} onSelect={() => selectPlaybackRate(rate)}>
              <Check className={`size-3.5 ${playbackRate === rate ? "" : "invisible"}`} />
              {rate === 1 ? "Normal" : `${rate}x`}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {supportsDocumentPip ? (
        <button
          type="button"
          onClick={() => void enterDocumentPip()}
          className={toolbarButtonClass}
          title="Picture in picture"
        >
          <PictureInPicture2 className="size-3.5" aria-hidden="true" />
          Picture in picture
        </button>
      ) : null}
    </>
  );

  return (
    <div className="flex h-full w-full flex-col gap-2">
      {toolbarContainer ? createPortal(trackControls, toolbarContainer) : null}
      <video
        ref={videoRef}
        controls
        preload="metadata"
        disablePictureInPicture={supportsDocumentPip}
        className="min-h-0 w-full flex-1 bg-black object-contain"
        aria-label={`Preview video: ${filename}`}
      >
        <source src={contentUrl} type={contentType} />
        {subtitles.map((track) => (
          <track
            key={track.id}
            kind="subtitles"
            src={track.src ?? undefined}
            srcLang={track.language ?? undefined}
            label={track.label}
          />
        ))}
        Your browser does not support video playback.
      </video>

      {!toolbarContainer ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{trackControls}</div>
      ) : null}
    </div>
  );
}
