"use client";

import { Captions, CaptionsOff, Check, PictureInPicture2, Volume2 } from "lucide-react";
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
  // Set the instant the video is manually moved into a Document
  // Picture-in-Picture window (see enterDocumentPip below) - the unmount
  // cleanup reads this to know the element now belongs to that window and
  // must be left alone rather than paused and torn down.
  const handedToPipWindowRef = useRef(false);
  const supportsDocumentPip = documentPip() !== null;

  // The classic Picture-in-Picture API (the browser's own context-menu entry
  // or control-bar button) mirrors only the decoded video frame into its
  // floating window, not the caption overlay the page renders over the
  // element - so its captions never show up there. Document Picture-in-Picture
  // instead hands the video a real floating *window* this app controls, which
  // renders it exactly like any other page and therefore keeps captions
  // working. Where it's supported, the browser's own entry points are
  // disabled (see `disablePictureInPicture` below) in favor of the button
  // this renders, so this is the only way to enter Picture-in-Picture there.
  async function enterDocumentPip() {
    const api = documentPip();
    const video = videoRef.current;
    if (!api || !video) return;
    try {
      const pipWindow = await api.requestWindow({
        width: video.videoWidth || 480,
        height: video.videoHeight || 270,
      });

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

      // Not wrapped in a React effect on purpose: this listener has to keep
      // working after this component - and the modal it closes below -
      // unmounts, which is exactly when a `useEffect` cleanup would
      // otherwise tear it back down again.
      pipWindow.addEventListener(
        "pagehide",
        () => {
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
          video.pause();
          video.removeAttribute("src");
          video.load();
        },
        { once: true },
      );
    };
    video.addEventListener("enterpictureinpicture", handleEnterPip);
    return () => video.removeEventListener("enterpictureinpicture", handleEnterPip);
  }, [attachmentId, onEnterPictureInPicture, supportsDocumentPip]);

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
    const textTracks = video.textTracks;
    const syncFromDom = () => {
      let showingId: string = SUBTITLES_OFF;
      for (let index = 0; index < textTracks.length; index += 1) {
        if (textTracks[index].mode === "showing") {
          showingId = subtitles[index]?.id ?? SUBTITLES_OFF;
          break;
        }
      }
      setActiveSubtitle(showingId);
    };
    syncFromDom();
    textTracks.addEventListener("change", syncFromDom);
    return () => textTracks.removeEventListener("change", syncFromDom);
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

  const activeLabel =
    subtitles.find((track) => track.id === activeSubtitle)?.label ?? null;

  const toolbarButtonClass =
    "text-muted-foreground border-border bg-surface hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center gap-1 rounded border px-2 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none";

  const trackControls =
    subtitles.length > 0 || audioTracks.length > 1 || supportsDocumentPip ? (
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
                <DropdownMenuItem
                  key={track.index}
                  onSelect={() => selectAudioTrack(track.index)}
                >
                  <Check className={`size-3.5 ${track.enabled ? "" : "invisible"}`} />
                  <span className="truncate">{track.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

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
    ) : null;

  return (
    <div className="flex h-full w-full flex-col gap-2">
      {trackControls && toolbarContainer
        ? createPortal(trackControls, toolbarContainer)
        : null}
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

      {trackControls && !toolbarContainer ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{trackControls}</div>
      ) : null}
    </div>
  );
}
