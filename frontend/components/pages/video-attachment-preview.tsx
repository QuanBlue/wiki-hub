"use client";

import { Captions, CaptionsOff, Check, Volume2 } from "lucide-react";
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
}: {
  attachmentId: string;
  contentUrl: string;
  contentType?: string;
  filename: string;
  /** Where the track controls belong: the Preview header, beside Download. */
  toolbarContainer?: HTMLElement | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tracks, setTracks] = useState<MediaTracks>({ subtitles: [], audio: [] });
  const [activeSubtitle, setActiveSubtitle] = useState<string>(SUBTITLES_OFF);
  const [audioTracks, setAudioTracks] = useState<SwitchableAudioTrack[]>([]);

  // Picture-in-Picture is for "keep watching while I do something else" -
  // once you leave it, by any means (its own "back to tab" control, closing
  // the floating window, or the browser closing it for you), the intent is
  // "I'm done watching", so playback stops there rather than quietly
  // continuing inline behind whatever you switched to.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleLeavePip = () => video.pause();
    video.addEventListener("leavepictureinpicture", handleLeavePip);
    return () => video.removeEventListener("leavepictureinpicture", handleLeavePip);
  }, [attachmentId]);

  // Closing the modal unmounts this component, but React detaching the
  // <video> node from the DOM does not stop playback on its own - if the
  // element is in Picture-in-Picture, the browser keeps decoding and playing
  // it (audio included) in the background even with no window showing it.
  // Exiting PiP first (so no floating window survives the preview closing)
  // and then pausing and clearing the source is what actually kills
  // playback rather than just hiding it.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (!video) return;
      if (document.pictureInPictureElement === video) {
        void document.exitPictureInPicture().catch(() => {});
      }
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

  const trackControls =
    subtitles.length > 0 || audioTracks.length > 1 ? (
      <>
        {subtitles.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground border-border bg-surface hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center gap-1 rounded border px-2 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                title="Subtitles"
              >
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
              <button
                type="button"
                className="text-muted-foreground border-border bg-surface hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center gap-1 rounded border px-2 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                title="Audio track"
              >
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
