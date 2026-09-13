"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api-client";
import type { WikiPage } from "@/types/api";

// Mirrors SAVED_PAGE_KEYS_STORAGE / SAVED_PAGE_KEYS_EVENT in
// components/pages/space-workspace.tsx (the only place that writes it, via
// the page toolbar's "Save for later" toggle). Duplicated rather than
// imported to keep this read-only page independent of that much larger file.
const STORAGE_KEY = "wikihub:saved-page-keys";
const CHANGE_EVENT = "wikihub:saved-pages-changed";

function readSavedKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function splitKey(key: string): { spaceKey: string; slug: string } {
  const slashIndex = key.indexOf("/");
  return slashIndex < 0
    ? { spaceKey: key, slug: "" }
    : { spaceKey: key.slice(0, slashIndex), slug: key.slice(slashIndex + 1) };
}

/** Drops a key that no longer resolves to a real page - a deleted or
 * moved-out-from-under-it page otherwise sits here forever as a dead link,
 * since nothing else ever prunes this client-only list. */
function removeSavedKey(key: string) {
  const next = readSavedKeys().filter((existing) => existing !== key);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort: the in-memory list still drops it for this session.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function SavedPagesList() {
  const [keys, setKeys] = useState<string[] | null>(null);
  // undefined = not fetched yet, null = fetch failed (page gone or no access).
  const [pages, setPages] = useState<Record<string, WikiPage | null>>({});

  useEffect(() => {
    const sync = () => setKeys(readSavedKeys());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    if (!keys) return;
    const missing = keys.filter((key) => !(key in pages));
    if (missing.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missing.map(async (key) => {
        const { spaceKey, slug } = splitKey(key);
        try {
          const page = await api.get<WikiPage>(
            `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}`,
          );
          if (!cancelled) setPages((current) => ({ ...current, [key]: page }));
        } catch (error) {
          if (!cancelled) {
            setPages((current) => ({ ...current, [key]: null }));
            // Only a definitive 404 means the page itself is gone - a
            // transient network error or a permissions hiccup should not
            // silently drop it from the saved list.
            if (error instanceof ApiError && error.status === 404) removeSavedKey(key);
          }
        }
      }),
    );
    return () => {
      cancelled = true;
    };
    // `pages` is read only to find keys not fetched yet, not to react to its
    // own updates - including it would re-run this on every fetch result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  if (keys === null) return null;

  if (keys.length === 0) {
    return (
      <div className="border-border bg-surface rounded-xl border border-dashed p-10 text-center">
        <FileText className="text-muted-foreground mx-auto size-6" aria-hidden />
        <p className="mt-2 text-sm font-medium">Nothing saved yet</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Use &ldquo;Save for later&rdquo; on a page to keep it here.
        </p>
      </div>
    );
  }

  return (
    <ul className="border-border bg-surface divide-border divide-y rounded-xl border">
      {keys.map((key) => {
        const { spaceKey, slug } = splitKey(key);
        const page = pages[key];
        return (
          <li key={key}>
            <Link
              href={`/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}`}
              className="hover:bg-surface-hover flex items-center gap-3 px-4 py-3 transition-colors duration-150 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2"
            >
              <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="text-foreground block truncate text-sm font-medium">
                  {page?.title ?? slug}
                </span>
                <span className="text-muted-foreground mt-0.5 block text-xs">
                  {page === null
                    ? "No longer available"
                    : page === undefined
                      ? "Loading…"
                      : spaceKey}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
