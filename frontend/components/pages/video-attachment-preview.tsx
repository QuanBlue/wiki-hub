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
 * Picture-in-Picture exists to keep a video going while you do something
 * else, so closing this modal must not kill playback when the video is
 * floating in a PiP window - only actually leaving PiP should. Keyed by
 * attachment id rather than React state: the preview that eventually
 * reopens is a brand new component instance with no memory of the one that
 * was orphaned in PiP, so the handoff has to live outside any one instance.
 */
const pipResumeState = new Map<string, { time: number; playing: boolean }>();

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

  // Closing the modal unmounts this component, but React detaching the
  // <video> node from the DOM does not stop playback on its own - if the
  // element is in Picture-in-Picture, the browser keeps decoding and playing
  // it (audio included) in the background even with no window showing it.
  // Explicitly pausing here is what actually kills playback rather than
  // just hiding it - *except* while the video is genuinely floating in a
  // PiP window, where that would defeat the point of PiP. See the PiP
  // handoff effect below for what happens to that case instead.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (!video) return;
      if (document.pictureInPictureElement !== video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        return;
      }
      // Floating in PiP: the browser keeps this now-detached element alive
      // and rendered in its own window for as long as it stays the PiP
      // element, so a listener attached here still fires later, after this
      // component has fully unmounted. Once the user leaves PiP - its own
      // "back to tab" or close control - hand playback position to a fresh
      // preview through the same modal-open event the rest of the app
      // already uses to open this dialog, then release this element.
      const handleLeavePip = () => {
        pipResumeState.set(attachmentId, {
          time: video.currentTime,
          playing: !video.paused,
        });
        window.dispatchEvent(
          new CustomEvent("wikihub:open-attachment-modal", {
            detail: { attachmentId },
          }),
        );
        video.pause();
        video.removeAttribute("src");
        video.load();
      };
      video.addEventListener("leavepictureinpicture", handleLeavePip, { once: true });
    };
  }, [attachmentId]);

  // Picks up where a video left off if it just reopened after outliving its
  // own preview instance in a Picture-in-Picture window (see above).
  useEffect(() => {
    const resume = pipResumeState.get(attachmentId);
    if (!resume) return;
    pipResumeState.delete(attachmentId);
    const video = videoRef.current;
    if (!video) return;
    const applyResume = () => {
      video.currentTime = resume.time;
      if (resume.playing) void video.play().catch(() => {});
    };
    if (video.readyState >= 1) applyResume();
    else video.addEventListener("loadedmetadata", applyResume, { once: true });
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

  // `<track>` elements are rendered by React; their display state is not a DOM
  // attribute, so it has to be pushed onto the live TextTrack objects.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const textTracks = video.textTracks;
    for (let index = 0; index < textTracks.length; index += 1) {
      textTracks[index].mode =
        subtitles[index]?.id === activeSubtitle ? "showing" : "disabled";
    }
  }, [activeSubtitle, subtitles]);

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
              <DropdownMenuItem onSelect={() => setActiveSubtitle(SUBTITLES_OFF)}>
                <Check
                  className={`size-3.5 ${activeSubtitle === SUBTITLES_OFF ? "" : "invisible"}`}
                />
                Off
              </DropdownMenuItem>
              {subtitles.map((track) => (
                <DropdownMenuItem key={track.id} onSelect={() => setActiveSubtitle(track.id)}>
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
