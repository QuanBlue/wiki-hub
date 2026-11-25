"use client";

import dynamic from "next/dynamic";
import {
  ArrowLeft,
  ChevronDown,
  Info,
  Pencil,
  WrapText,
  FileText,
  FileAudio,
  Download,
  Loader2,
  Search,
} from "lucide-react";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/context";
import { codeLanguageForFilename, highlightToLines, type CodeToken } from "@/lib/code-highlight";
import { matchesShortcut } from "@/lib/keyboard-shortcuts";
import { markLocalFindActive } from "@/lib/local-find-registry";
import { cn } from "@/lib/utils";
import { isEditableOfficeAttachment, isOfficeAttachment } from "@/lib/office-attachments";

const OfficeAttachmentPreview = dynamic(
  () =>
    import("@/components/pages/office-attachment-preview").then(
      (module) => module.OfficeAttachmentPreview,
    ),
  { ssr: false },
);
const VideoAttachmentPreview = dynamic(
  () =>
    import("@/components/pages/video-attachment-preview").then(
      (module) => module.VideoAttachmentPreview,
    ),
  { ssr: false },
);
class AttachmentModalErrorBoundary extends Component<
  {
    children: ReactNode;
    onBackToPreview?: () => void;
    backLabel: string;
    retryLabel: string;
    title: string;
    description: string;
  },
  { hasError: boolean; message: string | null }
> {
  state = { hasError: false, message: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error?.message || null,
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="text-muted-foreground flex h-full min-h-64 w-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-foreground text-sm font-semibold">{this.props.title}</p>
          <p className="max-w-md text-sm">
            {this.state.message || this.props.description}
          </p>
          <div className="flex items-center gap-2 pt-1">
            {this.props.onBackToPreview ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  this.setState({ hasError: false, message: null });
                  this.props.onBackToPreview?.();
                }}
              >
                {this.props.backLabel}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => this.setState({ hasError: false, message: null })}
            >
              {this.props.retryLabel}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const OfficeAttachmentEditor = dynamic(
  () =>
    import("@/components/pages/office-attachment-editor").then(
      (module) => module.OfficeAttachmentEditor,
    ),
  { ssr: false },
);
const PdfAttachmentPreview = dynamic(
  () =>
    import("@/components/pages/pdf-attachment-preview").then(
      (module) => module.PdfAttachmentPreview,
    ),
  { ssr: false },
);

const AUDIO_WAVEFORM_BARS = Array.from({ length: 112 }, (_, index) => {
  const position = index / 111;
  const pulse = 0.55 + 0.45 * Math.sin(index * 1.7) ** 2;
  return Math.round(26 + 68 * (1 - position * 0.55) * pulse);
});

function AudioAttachmentPreview({
  contentUrl,
  contentType,
  filename,
}: {
  contentUrl: string;
  contentType?: string;
  filename: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const frequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const lastWaveUpdateRef = useRef(0);
  const [waveLevels, setWaveLevels] = useState(AUDIO_WAVEFORM_BARS);
  const [isPlaying, setIsPlaying] = useState(false);
  const { t } = useTranslation();

  const stopWaveform = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const startWaveform = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || typeof window === "undefined") return;

    try {
      if (!audioContextRef.current) {
        const AudioContextConstructor =
          window.AudioContext ??
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (!AudioContextConstructor) return;

        const context = new AudioContextConstructor();
        const analyser = context.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.78;
        const source = context.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(context.destination);
        audioContextRef.current = context;
        analyserRef.current = analyser;
        sourceRef.current = source;
        frequencyDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      }

      await audioContextRef.current.resume();
      setIsPlaying(true);
      stopWaveform();

      const renderWaveform = (timestamp: number) => {
        const analyser = analyserRef.current;
        const frequencyData = frequencyDataRef.current;
        if (!analyser || !frequencyData) return;

        analyser.getByteFrequencyData(frequencyData);
        // Updating at 24fps gives the waveform natural movement while keeping
        // the attachment modal responsive during long playback.
        if (timestamp - lastWaveUpdateRef.current >= 42) {
          lastWaveUpdateRef.current = timestamp;
          // Speech and music usually have little energy in the final high
          // frequency bins. Repeat the active low/mid spectrum across the
          // whole display and blend it with the overall energy so every part
          // of the waveform continues to respond to playback.
          const usableBins = Math.max(
            8,
            Math.floor(frequencyData.length * 0.55),
          );
          let overallEnergy = 0;
          for (let bin = 0; bin < usableBins; bin += 1) {
            overallEnergy += frequencyData[bin] ?? 0;
          }
          overallEnergy /= usableBins * 255;
          const barsPerPass = Math.ceil(AUDIO_WAVEFORM_BARS.length / 3);
          setWaveLevels(
            AUDIO_WAVEFORM_BARS.map((_, index) => {
              const pass = Math.floor(index / barsPerPass);
              const position =
                (index % barsPerPass) / Math.max(1, barsPerPass - 1);
              const mirroredPosition = pass % 2 === 0 ? position : 1 - position;
              const start = Math.floor(mirroredPosition * (usableBins - 1));
              const end = Math.min(usableBins, start + 2);
              let total = 0;
              for (let bin = start; bin < end; bin += 1)
                total += frequencyData[bin] ?? 0;
              const localEnergy = total / (end - start) / 255;
              const amplitude = localEnergy * 0.72 + overallEnergy * 0.28;
              return Math.max(
                14,
                Math.min(96, Math.round(14 + amplitude * 82)),
              );
            }),
          );
        }
        animationFrameRef.current = requestAnimationFrame(renderWaveform);
      };

      animationFrameRef.current = requestAnimationFrame(renderWaveform);
    } catch {
      // Native controls remain usable even if the browser blocks Web Audio.
      setIsPlaying(true);
    }
  }, [stopWaveform]);

  useEffect(
    () => () => {
      stopWaveform();
      sourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      void audioContextRef.current?.close();
    },
    [stopWaveform],
  );

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="bg-primary-subtle text-primary flex size-10 shrink-0 items-center justify-center rounded-md">
          <FileAudio className="size-5" aria-hidden="true" />
        </span>
        <span
          className="text-foreground truncate text-sm font-medium"
          title={filename}
        >
          {filename}
        </span>
      </div>
      <div
        className="bg-surface-sunken flex h-20 items-center gap-px overflow-hidden rounded-md px-3"
        aria-label={t("editor.audioWaveformAria")}
        role="img"
      >
        {waveLevels.map((height, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={cn(
              "min-w-px flex-1 rounded-full transition-[height,background-color] duration-100 ease-out",
              isPlaying ? "bg-primary/80" : "bg-muted-foreground/30",
            )}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        className="w-full"
        aria-label={t("editor.previewAudioAria", { filename })}
        onPlay={() => void startWaveform()}
        onPause={() => {
          setIsPlaying(false);
          stopWaveform();
        }}
        onEnded={() => {
          setIsPlaying(false);
          stopWaveform();
        }}
      >
        <source src={contentUrl} type={contentType} />
        Your browser does not support audio playback.
      </audio>
    </div>
  );
}
type AttachmentMetadata = {
  id: string;
  page_id: string;
  filename: string;
  content_type: string;
  created_at: string;
  size_bytes: number;
  office_revision?: number;
};

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One coloured token's span within the line it belongs to. */
type TokenSpan = { start: number; end: number; className: string | null };

function tokenSpans(tokens: CodeToken[]): TokenSpan[] {
  const spans: TokenSpan[] = [];
  let offset = 0;
  for (const token of tokens) {
    spans.push({
      start: offset,
      end: offset + token.text.length,
      className: token.className,
    });
    offset += token.text.length;
  }
  return spans;
}

/**
 * Slices one fragment of a line against the token boundaries, so a fragment
 * that straddles two differently-coloured tokens - most often a search
 * match - keeps both syntax colours instead of losing them to plain text.
 * With no spans (a plain file, or a surface with no highlighting at all),
 * the fragment is returned as a single, uncoloured piece.
 */
function sliceByTokens(
  fragment: string,
  fragmentStart: number,
  spans: TokenSpan[],
) {
  if (spans.length === 0 || !fragment)
    return [{ text: fragment, className: null as string | null }];
  const pieces: { text: string; className: string | null }[] = [];
  let cursor = fragmentStart;
  const end = fragmentStart + fragment.length;
  while (cursor < end) {
    const span = spans.find((s) => s.start <= cursor && cursor < s.end);
    const pieceEnd = span ? Math.min(span.end, end) : end;
    pieces.push({
      text: fragment.slice(cursor - fragmentStart, pieceEnd - fragmentStart),
      className: span?.className ?? null,
    });
    cursor = pieceEnd;
  }
  return pieces;
}

function HighlightedText({
  text,
  tokens,
  query,
  lineIdx,
  activeMatchIdx,
  matches,
}: {
  text: string;
  /** Syntax tokens for this same line, when the file is being highlighted. */
  tokens?: CodeToken[];
  query: string;
  lineIdx: number;
  activeMatchIdx: number;
  matches: { lineIdx: number; charIdx: number }[];
}) {
  if (!text) return <> </>;

  const spans = tokens ? tokenSpans(tokens) : [];
  const renderPieces = (
    fragment: string,
    fragmentStart: number,
    keyPrefix: string,
  ) =>
    sliceByTokens(fragment, fragmentStart, spans).map((piece, pieceIdx) => (
      <span
        key={`${keyPrefix}-${pieceIdx}`}
        className={piece.className ?? undefined}
      >
        {piece.text}
      </span>
    ));

  if (!query) return <>{renderPieces(text, 0, "t")}</>;

  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));
  // Resolve every fragment's offset within the line up front. Carrying a
  // running counter through the map below would mean mutating a variable from
  // inside render, which is not safe to repeat across renders.
  const segments: { part: string; start: number }[] = [];
  for (let index = 0, start = 0; index < parts.length; index += 1) {
    segments.push({ part: parts[index], start });
    start += parts[index].length;
  }

  return (
    <>
      {segments.map(({ part, start: startOffset }, partIdx) => {
        const isMatch = part.toLowerCase() === query.toLowerCase();

        if (!isMatch) return renderPieces(part, startOffset, String(partIdx));

        const globalIdx = matches.findIndex(
          (m) => m.lineIdx === lineIdx && m.charIdx === startOffset,
        );
        const isActive = globalIdx === activeMatchIdx;

        return (
          <mark
            key={partIdx}
            className={cn(
              "rounded-sm px-0.5 font-semibold",
              isActive
                ? "bg-warning text-warning-foreground ring-warning ring-2"
                : "text-foreground bg-yellow-200 dark:bg-yellow-800",
            )}
          >
            {renderPieces(part, startOffset, String(partIdx))}
          </mark>
        );
      })}
    </>
  );
}

export function AttachmentDetailsModal({
  attachmentId,
  canEditOffice = false,
  onClose,
}: {
  attachmentId: string | null;
  canEditOffice?: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<AttachmentMetadata | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [wrapLines, setWrapLines] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [isEditingOffice, setIsEditingOffice] = useState(false);
  const [attachmentRevision, setAttachmentRevision] = useState(0);
  const [syncingOfficeSave, setSyncingOfficeSave] = useState(false);
  const revisionBeforeEditRef = useRef<number>(0);
  const [isPdfExpanded, setIsPdfExpanded] = useState(false);
  const [isOfficeExpanded, setIsOfficeExpanded] = useState(false);
  const [previewToolbarContainer, setPreviewToolbarContainer] =
    useState<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { t, locale: attachmentLocale } = useTranslation();

  // All hooks must run unconditionally (rules of hooks)
  useEffect(() => {
    // Nothing to clear when there is no attachment: the render sites key this
    // component by id, so closing the modal unmounts this state rather than
    // asking the effect to reset it.
    if (!attachmentId) return;

    async function fetchDetails() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/v1/attachments/${attachmentId}`);
        if (!response.ok) {
          // The API answers failures in a standard envelope. Surfacing its
          // message separates a genuinely missing attachment (a link left
          // behind in a local draft after the record was deleted) from a
          // permission or connectivity problem - all three used to read as
          // the same unhelpful sentence.
          const envelope = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(
            envelope?.error?.message ??
              (response.status === 404
                ? t("editor.attachmentGone")
                : t("editor.couldNotRetrieveDetails", {
                    status: response.status,
                  })),
          );
        }
        const data = (await response.json()) as AttachmentMetadata;
        setMetadata(data);

        const isText =
          data.content_type.startsWith("text/") ||
          /\.(txt|py|js|ts|tsx|jsx|json|css|html|md|sh|yml|yaml|xml|ini|conf)$/i.test(
            data.filename,
          );
        if (isText) {
          try {
            const res = await fetch(
              `/api/v1/attachments/${attachmentId}/content`,
            );
            if (res.ok) setTextContent(await res.text());
          } catch (e) {
            console.error("Error reading file content", e);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("editor.genericError"));
      } finally {
        setLoading(false);
      }
    }

    void fetchDetails();
  }, [attachmentId]);

  useEffect(() => {
    if (!attachmentId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut("attachment.find", event)) return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", handleKeyDown);
    // Tells the app-shell's quick-search shortcut (also Ctrl+F) to step
    // aside while this preview's own find-in-content is around to claim it.
    const releaseLocalFind = markLocalFindActive();
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      releaseLocalFind();
    };
  }, [attachmentId]);

  const lines = useMemo(
    () => (textContent !== null ? textContent.split(/\r?\n/) : []),
    [textContent],
  );

  // The same colour theme the editor's code blocks use, keyed off the
  // filename since a plain attachment has no explicit language choice.
  // Highlighting the whole file once, rather than one line at a time, is
  // what keeps a multi-line string or block comment tokenised correctly.
  const codeLanguage = metadata
    ? codeLanguageForFilename(metadata.filename)
    : null;
  const tokenLines = useMemo(
    () =>
      textContent !== null && codeLanguage
        ? highlightToLines(textContent, codeLanguage)
        : null,
    [textContent, codeLanguage],
  );

  const matches = useMemo(() => {
    if (!searchQuery || !textContent) return [];
    const queryLower = searchQuery.toLowerCase();
    const allMatches: { lineIdx: number; charIdx: number }[] = [];
    lines.forEach((line, lineIdx) => {
      let charIdx = line.toLowerCase().indexOf(queryLower);
      while (charIdx !== -1) {
        allMatches.push({ lineIdx, charIdx });
        charIdx = line.toLowerCase().indexOf(queryLower, charIdx + 1);
      }
    });
    return allMatches;
  }, [searchQuery, textContent, lines]);

  useEffect(() => {
    if (matches.length > 0 && matches[activeMatchIdx]) {
      const element = document.querySelector(
        `[data-line-idx="${matches[activeMatchIdx].lineIdx}"]`,
      );
      if (element)
        element.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeMatchIdx, matches]);

  useEffect(() => {
    if (!syncingOfficeSave || !attachmentId || isEditingOffice) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 12; // ~18s window for ONLYOFFICE close/forcesave callback

    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        const response = await fetch(`/api/v1/attachments/${attachmentId}`);
        if (response.ok && !cancelled) {
          const updated = (await response.json()) as AttachmentMetadata;
          if (
            typeof updated.office_revision === "number" &&
            updated.office_revision > revisionBeforeEditRef.current
          ) {
            setMetadata(updated);
            setAttachmentRevision((revision) => revision + 1);
            setSyncingOfficeSave(false);
            return;
          }
        }
      } catch {
        // Ignore transient network errors while polling.
      }
      if (attempts === 1 && !cancelled) {
        // Refresh once after 1.5s even if office_revision is unavailable or not yet bumped.
        setAttachmentRevision((revision) => revision + 1);
      }
      if (attempts >= maxAttempts && !cancelled) {
        setSyncingOfficeSave(false);
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [attachmentId, isEditingOffice, syncingOfficeSave]);

  // All hooks above — safe to do early return now
  if (!attachmentId) return null;

  const effectiveVersion =
    (metadata?.office_revision ?? 0) + attachmentRevision;
  const contentUrl = `/api/v1/attachments/${attachmentId}/content${effectiveVersion ? `?v=${effectiveVersion}` : ""}`;

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const isImage = metadata ? metadata.content_type.startsWith("image/") : false;
  const isPdf = metadata ? metadata.content_type === "application/pdf" : false;
  const isVideo = metadata
    ? metadata.content_type.startsWith("video/") ||
      /\.(mp4|m4v|mov|webm|ogv|avi|mkv|wmv|flv)$/i.test(metadata.filename)
    : false;
  const isAudio = metadata
    ? metadata.content_type.startsWith("audio/") ||
      /\.(mp3|wav|flac|ogg|oga|m4a|aac|opus)$/i.test(metadata.filename)
    : false;
  const mediaType =
    metadata?.content_type === "application/octet-stream"
      ? undefined
      : metadata?.content_type;
  const isOffice = metadata ? isOfficeAttachment(metadata.filename) : false;
  const isXlsxPreview = metadata ? /\.xlsx$/i.test(metadata.filename) : false;
  const isEditableOffice = metadata
    ? isEditableOfficeAttachment(metadata.filename)
    : false;
  const hasTextPreview = textContent !== null;
  const attachmentTitle = (
    <span className="inline-flex items-center gap-1.5">
      {t("editor.attachmentDetails")}
      {metadata ? (
        <span className="group relative inline-flex">
          <button
            type="button"
            aria-label={t("editor.showAttachmentInfoAria")}
            aria-describedby="attachment-information"
            className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-6 cursor-pointer items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <Info className="size-4" />
          </button>
          <span
            id="attachment-information"
            role="tooltip"
            className="bg-surface-raised border-border text-muted-foreground pointer-events-none absolute top-full left-0 z-50 mt-2 grid w-max max-w-[min(28rem,calc(100vw-4rem))] grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border p-3 text-xs font-normal opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <span className="text-foreground font-semibold">
              {t("editor.fileLabel")}
            </span>
            <span className="break-all">{metadata.filename}</span>
            <span className="text-foreground font-semibold">
              {t("editor.sizeLabel")}
            </span>
            <span>{formatSize(metadata.size_bytes)}</span>
            <span className="text-foreground font-semibold">
              {t("editor.typeLabel")}
            </span>
            <span className="break-all">{metadata.content_type}</span>
            <span className="text-foreground font-semibold">
              {t("editor.uploadedLabel")}
            </span>
            <span>{formatDateTime(metadata.created_at, attachmentLocale)}</span>
          </span>
        </span>
      ) : null}
    </span>
  );

  const handleSearchInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (matches.length === 0) return;
      if (event.shiftKey) {
        setActiveMatchIdx(
          (prev) => (prev - 1 + matches.length) % matches.length,
        );
      } else {
        setActiveMatchIdx((prev) => (prev + 1) % matches.length);
      }
    }
  };

  const toggleOfficeEditing = () => {
    if (isEditingOffice) {
      setIsEditingOffice(false);
      setSyncingOfficeSave(true);
      return;
    }
    revisionBeforeEditRef.current = metadata?.office_revision ?? 0;
    setSyncingOfficeSave(false);
    setIsEditingOffice(true);
  };

  return (
    <Dialog
      open={!!attachmentId}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={attachmentTitle}
        className={cn(
          "max-w-3xl",
          isEditingOffice &&
            "flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[min(100vw-2rem,112rem)] max-w-none flex-col overflow-hidden",
          hasTextPreview &&
            "flex h-[84vh] max-h-[84vh] w-[min(100vw-2rem,64rem)] max-w-none flex-col overflow-hidden",
          isPdfExpanded &&
            "flex h-[90vh] max-h-[90vh] w-[90vw] max-w-none flex-col overflow-hidden",
          isOfficeExpanded &&
            !isEditingOffice &&
            "flex h-[84vh] max-h-[84vh] w-[80vw] max-w-none flex-col overflow-hidden",
        )}
      >
        {loading ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2">
            <Loader2 className="text-muted-foreground size-8 animate-spin" />
            <p className="text-muted-foreground text-sm">
              {t("editor.loadingDetails")}
            </p>
          </div>
        ) : error ? (
          <div className="text-danger flex h-48 flex-col items-center justify-center gap-2">
            <p className="text-sm font-semibold">{error}</p>
            <Button variant="secondary" onClick={onClose}>
              {t("editor.closeAria")}
            </Button>
          </div>
        ) : metadata ? (
          <div
            className={cn(
              "space-y-4",
              (isEditingOffice ||
                isPdfExpanded ||
                isOfficeExpanded ||
                hasTextPreview) &&
                "flex min-h-0 flex-1 flex-col gap-4 space-y-0",
            )}
          >
            {/* Compact details bar */}
            <div className="hidden">
              <div className={cn(isOffice && "min-w-0 shrink")}>
                <span className="text-foreground font-semibold">
                  {t("editor.fileLabel")}{" "}
                </span>
                <span
                  className={cn(
                    isOffice &&
                      "inline-block max-w-full truncate align-bottom sm:max-w-56",
                  )}
                  title={metadata.filename}
                >
                  {metadata.filename}
                </span>
              </div>
              <div>
                <span className="text-foreground font-semibold">
                  {t("editor.sizeLabel")}{" "}
                </span>
                <span>{formatSize(metadata.size_bytes)}</span>
              </div>
              <div>
                <span className="text-foreground font-semibold">
                  {t("editor.typeLabel")}{" "}
                </span>
                <span title={metadata.content_type}>
                  {metadata.content_type}
                </span>
              </div>
              <div>
                <span className="text-foreground font-semibold">
                  {t("editor.uploadedLabel")}
                </span>
                <span>
                  {formatDateTime(metadata.created_at, attachmentLocale)}
                </span>
              </div>
            </div>

            <div
              className={cn(
                "border-border overflow-hidden rounded-lg border",
                (isEditingOffice ||
                  isPdfExpanded ||
                  isOfficeExpanded ||
                  hasTextPreview) &&
                  "flex min-h-0 flex-1 flex-col",
                isXlsxPreview && "overflow-visible",
              )}
            >
              <div className="bg-surface-sunken text-muted-foreground flex items-center justify-between border-b px-3 py-1.5 text-xs font-semibold tracking-wider uppercase">
                <span>{t("editor.preview")}</span>
                <div className="flex items-center gap-1 tracking-normal normal-case">
                  {!isEditingOffice ? (
                    <div
                      ref={setPreviewToolbarContainer}
                      className={cn(
                        "attachment-preview-actions flex items-center gap-1",
                        !isOffice && !isPdf && !isVideo && "hidden",
                      )}
                    />
                  ) : null}
                  <a
                    href={contentUrl}
                    download={metadata.filename}
                    className="text-muted-foreground border-border bg-surface hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center gap-1 rounded border px-2 text-xs font-medium tracking-normal normal-case transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                    title={t("editor.downloadNamed", {
                      filename: metadata.filename,
                    })}
                  >
                    <Download className="size-3.5" aria-hidden="true" />
                    <span>{t("editor.download")}</span>
                  </a>
                  {canEditOffice && isEditableOffice ? (
                    <button
                      type="button"
                      onClick={toggleOfficeEditing}
                      className="text-primary border-primary/30 bg-primary-subtle/60 hover:bg-primary-subtle hover:border-primary/50 hover:text-primary-hover active:bg-primary-subtle focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center gap-1 rounded border px-2 text-xs font-medium tracking-normal normal-case transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                    >
                      {isEditingOffice ? (
                        <ArrowLeft className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Pencil className="size-3.5" aria-hidden="true" />
                      )}
                      {isEditingOffice ? "Back to preview" : "Edit"}
                    </button>
                  ) : (
                    textContent !== null && (
                      <div className="flex items-center gap-3 tracking-normal normal-case">
                        <div className="flex items-center gap-1.5">
                          <div className="relative">
                            <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
                            <Input
                              ref={searchInputRef}
                              value={searchQuery}
                              onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setActiveMatchIdx(0);
                              }}
                              onKeyDown={handleSearchInputKeyDown}
                              placeholder={t("editor.searchContent")}
                              className="h-7 w-40 pr-2 pl-7 text-xs"
                            />
                          </div>
                          {matches.length > 0 && (
                            <div className="text-muted-foreground flex items-center gap-1 text-xs select-none">
                              <span className="text-foreground font-medium">
                                {activeMatchIdx + 1}/{matches.length}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveMatchIdx(
                                    (prev) =>
                                      (prev - 1 + matches.length) %
                                      matches.length,
                                  )
                                }
                                className="hover:bg-surface-hover hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded transition-colors duration-150"
                                title={t("editor.previousMatch")}
                              >
                                <ChevronDown className="size-4 rotate-180" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveMatchIdx(
                                    (prev) => (prev + 1) % matches.length,
                                  )
                                }
                                className="hover:bg-surface-hover hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded transition-colors duration-150"
                                title={t("editor.nextMatch")}
                              >
                                <ChevronDown className="size-4" />
                              </button>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setWrapLines((w) => !w)}
                          className={cn(
                            "hover:bg-surface-hover focus-visible:ring-ring flex size-7 cursor-pointer items-center justify-center rounded border border-transparent transition-all duration-150 focus-visible:ring-2 focus-visible:outline-none",
                            wrapLines
                              ? "bg-primary-subtle text-primary border-primary-subtle font-medium"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          title={
                            wrapLines
                              ? t("editor.disableLineWrapping")
                              : t("editor.enableLineWrapping")
                          }
                        >
                          <WrapText className="size-4" />
                        </button>
                      </div>
                    )
                  )}
                </div>
              </div>
              <div
                className={cn(
                  "bg-surface min-h-32 items-center justify-center overflow-auto p-4",
                  (isPdfExpanded || isOfficeExpanded) && (isPdf || isOffice)
                    ? "flex max-h-none min-h-0 flex-1 !items-start !justify-start !overflow-hidden !p-0"
                    : isEditingOffice
                      ? "flex min-h-0 flex-1 !overflow-hidden !p-0"
                      : isPdf
                        ? "flex max-h-[min(70vh,36rem)] !items-start !justify-start !p-0"
                        : isOffice
                          ? `flex max-h-[min(66vh,36rem)] !items-start !justify-start !p-0 ${isXlsxPreview ? "!overflow-visible" : "!overflow-hidden"}`
                          : isVideo
                            ? "flex max-h-[min(70vh,36rem)] !items-stretch !justify-stretch !overflow-hidden !bg-black !p-0"
                            : isAudio
                              ? "flex max-h-72 w-full !p-5"
                              : textContent !== null
                                ? "flex min-h-0 flex-1 !overflow-hidden"
                                : "flex max-h-96",
                )}
              >
                <AttachmentModalErrorBoundary
                  key={`${attachmentId}-${isEditingOffice}`}
                  onBackToPreview={
                    isEditingOffice ? () => setIsEditingOffice(false) : undefined
                  }
                  backLabel={t("editor.backToPreview")}
                  retryLabel={t("common.tryAgain")}
                  title={t("editor.attachmentPreviewErrorTitle")}
                  description={t("editor.attachmentPreviewErrorDescription")}
                >
                  {isEditingOffice && canEditOffice && isEditableOffice ? (
                    <OfficeAttachmentEditor
                      attachmentId={attachmentId}
                      filename={metadata.filename}
                    />
                  ) : isOffice ? (
                    <OfficeAttachmentPreview
                      contentUrl={contentUrl}
                      filename={metadata.filename}
                      contentType={metadata.content_type}
                      expanded={isOfficeExpanded}
                      onExpandedChange={setIsOfficeExpanded}
                      toolbarContainer={previewToolbarContainer}
                    />
                  ) : isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={contentUrl}
                      alt={metadata.filename}
                      className="max-h-80 w-auto rounded border object-contain shadow-sm"
                    />
                  ) : isVideo ? (
                    <div className="h-full max-h-[min(70vh,36rem)] w-full">
                      <VideoAttachmentPreview
                        key={attachmentId}
                        attachmentId={attachmentId}
                        contentUrl={contentUrl}
                        contentType={mediaType}
                        filename={metadata.filename}
                        toolbarContainer={previewToolbarContainer}
                        onEnterPictureInPicture={onClose}
                      />
                    </div>
                  ) : isAudio ? (
                    <AudioAttachmentPreview
                      contentUrl={contentUrl}
                      contentType={mediaType}
                      filename={metadata.filename}
                    />
                  ) : textContent !== null ? (
                    <div className="wikihub-code bg-code-bg border-code-border h-full max-h-none w-full overflow-auto rounded border font-mono text-xs leading-relaxed select-text">
                      {lines.map((line, idx) => (
                        <div
                          key={idx}
                          data-line-idx={idx}
                          className={cn(
                            "hover:bg-code-inset flex",
                            matches[activeMatchIdx]?.lineIdx === idx &&
                              searchQuery &&
                              "bg-code-highlight/15 hover:bg-code-highlight/25",
                          )}
                        >
                          <span className="text-code-muted border-code-border w-12 shrink-0 border-r pr-2.5 text-right tabular-nums select-none">
                            {idx + 1}
                          </span>
                          <span
                            className={cn(
                              "pl-3",
                              wrapLines ? "break-all whitespace-pre-wrap" : "",
                            )}
                          >
                            <HighlightedText
                              text={line}
                              tokens={tokenLines?.[idx]}
                              query={searchQuery}
                              lineIdx={idx}
                              activeMatchIdx={activeMatchIdx}
                              matches={matches}
                            />
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : isPdf ? (
                    <PdfAttachmentPreview
                      contentUrl={contentUrl}
                      filename={metadata.filename}
                      expanded={isPdfExpanded}
                      onExpandedChange={setIsPdfExpanded}
                      toolbarContainer={previewToolbarContainer}
                    />
                  ) : (
                    <div className="py-6 text-center">
                      <FileText className="text-muted-foreground mx-auto size-12" />
                      <p className="text-muted-foreground mt-2 text-sm">
                        {t("editor.noPreview")}
                      </p>
                    </div>
                  )}
                </AttachmentModalErrorBoundary>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
