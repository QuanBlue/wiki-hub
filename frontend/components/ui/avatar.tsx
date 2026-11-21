"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

export type AvatarCrop = { zoom: number; x: number; y: number };

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300",
  "bg-purple-100 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-950/70 dark:text-teal-300",
  "bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-300",
];

/** Consistent deterministic avatar background color for initials across the app. */
export function getUserAvatarColor(identifier: string): string {
  const trimmed = (identifier ?? "").trim();
  if (!trimmed) return AVATAR_COLORS[0]!;
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash << 5) - hash + trimmed.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

/** "AB" for "Alice Brown"; falls back to the username. */
export function avatarInitials(
  name?: string | null,
  username?: string | null,
): string {
  const source = (name ?? "").trim() || (username ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part[0]!.toUpperCase()).join("");
  return initials || "?";
}

/**
 * Normalizes avatar URLs so internal backend URLs (e.g. http://backend:8000/api/v1/users/...
 * or http://localhost:8000/api/v1/users/...) are converted to relative paths (/api/v1/users/...)
 * that the browser can reliably fetch through Next.js proxy with session cookies.
 */
export function resolveAvatarUrl(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf("/api/v1/users/");
  if (idx !== -1) {
    return trimmed.slice(idx);
  }
  return trimmed;
}

/**
 * Appends a cache-busting `?v=<timestamp>` query parameter when `updatedAt` is
 * present and the URL does not already carry query parameters.
 */
export function versionedAvatarUrl(
  url?: string | null,
  updatedAt?: string | null,
): string | null {
  const resolved = resolveAvatarUrl(url);
  if (!resolved || !updatedAt || resolved.includes("?")) return resolved;
  const version = new Date(updatedAt).getTime();
  if (!version || Number.isNaN(version)) return resolved;
  return `${resolved}?v=${version}`;
}

/**
 * Avatar and cover are different URLs, so the browser decodes them as two
 * separate GIFs that start whenever each download finishes - even when both
 * are the same file they drift out of phase. Once both have loaded, remount
 * the two <img> elements together (from the memory cache) so both animations
 * restart on the same frame. Pass `syncKey` to `CroppedAvatarImage`.
 */
export function useGifPairSync(
  enabled: boolean,
  resetToken: string,
): { syncKey: number; onAvatarLoad: () => void; onCoverLoad: () => void } {
  const [state, setState] = useState({ token: resetToken, key: 0 });
  const loaded = useRef({ avatar: false, cover: false, token: resetToken });
  if (loaded.current.token !== resetToken) {
    loaded.current = { avatar: false, cover: false, token: resetToken };
  }
  const key = state.token === resetToken ? state.key : 0;

  const check = useCallback(() => {
    const l = loaded.current;
    if (enabled && l.avatar && l.cover) {
      setState((s) =>
        s.token === l.token && s.key > 0 ? s : { token: l.token, key: 1 },
      );
    }
  }, [enabled]);
  const onAvatarLoad = useCallback(() => {
    loaded.current.avatar = true;
    check();
  }, [check]);
  const onCoverLoad = useCallback(() => {
    loaded.current.cover = true;
    check();
  }, [check]);
  return { syncKey: key, onAvatarLoad, onCoverLoad };
}

function hasActiveGifCrop(
  crop?: AvatarCrop | null,
  contentType?: string | null,
): crop is AvatarCrop {
  if (!crop || contentType !== "image/gif") return false;
  return !(crop.zoom === 1 && crop.x === 0 && crop.y === 0);
}

/**
 * Exact positioning style for an uncropped image inside a `relative overflow-hidden`
 * container of aspect ratio `viewportRatio` (1 for square avatars, 15/4 for covers),
 * matching `cropGeometry` without `object-cover` clipping.
 */
export function croppedImageStyle(
  crop: AvatarCrop,
  imageSize: { width: number; height: number },
  viewportRatio = 1,
): CSSProperties {
  const effectiveRatio = imageSize.width / imageSize.height / viewportRatio;
  return {
    position: "absolute",
    maxWidth: "none",
    maxHeight: "none",
    left: `${50 + crop.x * 100}%`,
    top: `${50 + crop.y * 100}%`,
    transform: "translate(-50%, -50%)",
    ...(effectiveRatio >= 1
      ? { height: `${crop.zoom * 100}%`, width: `${crop.zoom * effectiveRatio * 100}%` }
      : { width: `${crop.zoom * 100}%`, height: `${(crop.zoom / effectiveRatio) * 100}%` }),
  };
}

/**
 * Renders an avatar or cover `<img>` inside a `relative overflow-hidden` container,
 * applying `crop` without `object-cover` clipping when `contentType === "image/gif"`.
 */
export function CroppedAvatarImage({
  src,
  alt = "",
  crop,
  contentType,
  viewportRatio = 1,
  className,
  onError,
  onImageLoad,
  syncKey,
}: {
  src: string;
  alt?: string;
  crop?: AvatarCrop | null;
  contentType?: string | null;
  viewportRatio?: number;
  /** Changing this remounts the <img> so a GIF restarts (see `useGifPairSync`). */
  syncKey?: number;
  className?: string;
  onError?: () => void;
  onImageLoad?: (size: { width: number; height: number }) => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{
    src: string;
    width: number;
    height: number;
  } | null>(null);
  const activeCrop = hasActiveGifCrop(crop, contentType) ? crop : null;

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      setNaturalSize({ src, ...size });
      onImageLoad?.(size);
    }
  }, [src, onImageLoad]);

  const sizeForSrc =
    naturalSize && naturalSize.src === src && naturalSize.width > 0 && naturalSize.height > 0
      ? naturalSize
      : null;

  return (
    <img
      key={syncKey}
      ref={imgRef}
      src={src}
      alt={alt}
      onLoad={(event) => {
        const img = event.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          const size = { width: img.naturalWidth, height: img.naturalHeight };
          setNaturalSize({ src, ...size });
          onImageLoad?.(size);
        }
      }}
      onError={onError}
      className={
        activeCrop && sizeForSrc
          ? className
          : cn("size-full object-cover", className)
      }
      style={activeCrop && sizeForSrc ? croppedImageStyle(activeCrop, sizeForSrc, viewportRatio) : undefined}
    />
  );
}

/** A round avatar: the picture when there is one, otherwise initials with consistent color. */
export function Avatar({
  name,
  username,
  src,
  crop,
  contentType,
  className,
}: {
  name?: string | null;
  username?: string | null;
  src?: string | null;
  crop?: AvatarCrop | null;
  contentType?: string | null;
  className?: string;
}) {
  const resolvedSrc = resolveAvatarUrl(src);
  const useCroppedImg = Boolean(resolvedSrc && hasActiveGifCrop(crop, contentType));
  const identifier = (username ?? "").trim() || (name ?? "").trim();
  const colorClass = resolvedSrc ? "" : getUserAvatarColor(identifier);
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cover bg-center text-xs font-semibold select-none ring-1 ring-inset ring-black/5 dark:ring-white/10",
        colorClass,
        className,
      )}
      style={
        resolvedSrc && !useCroppedImg
          ? {
              backgroundImage: `url(${resolvedSrc})`,
              backgroundSize: "cover",
            }
          : undefined
      }
    >
      {resolvedSrc ? (
        useCroppedImg ? (
          <CroppedAvatarImage
            src={resolvedSrc}
            crop={crop}
            contentType={contentType}
          />
        ) : null
      ) : (
        avatarInitials(name, username)
      )}
    </span>
  );
}
