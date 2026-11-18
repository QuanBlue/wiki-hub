"use client";

import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import type { OnlyOfficeConfig, OnlyOfficeEditor } from "@/types/onlyoffice";

const LOAD_TIMEOUT_MS = 15_000;
let documentServerScript: Promise<void> | null = null;

function documentServerUrl() {
  const raw = (process.env.NEXT_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL ?? "").replace(
    /\/+$/,
    "",
  );
  if (!raw) return "";
  if (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  ) {
    return raw.replace(
      /\/\/(?:localhost|127\.0\.0\.1)(?=:|\/|$)/,
      `//${window.location.hostname}`,
    );
  }
  return raw;
}

function loadDocumentServerScript(url: string) {
  if (window.DocsAPI?.DocEditor) return Promise.resolve();
  if (documentServerScript) return documentServerScript;

  documentServerScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${url}/web-apps/apps/api/documents/api.js`;
    script.async = true;
    script.onload = () => {
      if (window.DocsAPI?.DocEditor) resolve();
      else {
        documentServerScript = null;
        reject(new Error("The document viewer did not initialize."));
      }
    };
    script.onerror = () => {
      documentServerScript = null;
      reject(new Error("Could not load the document viewer."));
    };
    document.head.appendChild(script);
  });
  return documentServerScript;
}

/** ONLYOFFICE mounts into an element by id, and a storage key is full of
 * characters (`/`, `.`) that are not valid there. */
function elementIdFor(storageKey: string) {
  return `onlyoffice-preview-${storageKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function OfficePreviewViewer({
  storageKey,
  filename,
}: {
  storageKey: string;
  filename: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<OnlyOfficeEditor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let loadTimer: number | null = null;
    const clearLoadTimer = () => {
      if (loadTimer !== null) {
        window.clearTimeout(loadTimer);
        loadTimer = null;
      }
    };
    const hostElement = hostRef.current;
    const serverUrl = documentServerUrl();

    async function initialize() {
      if (!serverUrl) {
        setError("The document viewer is not configured.");
        return;
      }
      try {
        const result = await apiFetch<{ config: OnlyOfficeConfig }>(
          `/api/v1/storage/office-preview/config?key=${encodeURIComponent(storageKey)}`,
        );
        await loadDocumentServerScript(serverUrl);
        if (cancelled || !hostElement || !window.DocsAPI?.DocEditor) return;

        // DocsAPI replaces the target DOM node in-place with an <iframe>.
        const mountNode = document.createElement("div");
        mountNode.id = elementIdFor(storageKey);
        mountNode.setAttribute("aria-label", `Preview of ${filename}`);
        mountNode.className = "h-full w-full";
        hostElement.replaceChildren(mountNode);

        loadTimer = window.setTimeout(() => {
          if (!cancelled) {
            setError(
              "The document viewer took too long to respond. Make sure the Document Server is reachable and try again.",
            );
          }
        }, LOAD_TIMEOUT_MS);

        const config: OnlyOfficeConfig = {
          ...result.config,
          events: {
            ...result.config.events,
            onDocumentReady: () => {
              clearLoadTimer();
              if (!cancelled) setReady(true);
            },
            onError: (event: { data?: { errorDescription?: string } }) => {
              clearLoadTimer();
              if (!cancelled) {
                setError(
                  event.data?.errorDescription ??
                    "The document viewer encountered an error.",
                );
              }
            },
          },
        };
        editorRef.current = new window.DocsAPI.DocEditor(
          mountNode.id,
          config,
        );
      } catch (loadError) {
        clearLoadTimer();
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not open the document preview.",
          );
        }
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      clearLoadTimer();
      try {
        editorRef.current?.destroyEditor();
      } catch {
        // Ignore teardown errors if the iframe was never attached.
      }
      editorRef.current = null;
      hostElement?.replaceChildren();
    };
  }, [storageKey, filename, attempt]);

  if (error) {
    return (
      <div
        key="preview-error"
        className="text-muted-foreground flex h-full min-h-80 w-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <TriangleAlert className="text-warning size-8" />
        <div>
          <p className="text-foreground text-sm font-semibold">
            Could not open the document preview
          </p>
          <p className="mt-1 max-w-md text-sm">{error}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setError(null);
            setReady(false);
            setAttempt((current) => current + 1);
          }}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div
      key="preview-host"
      className="bg-surface relative h-full min-h-0 w-full overflow-hidden"
    >
      {!ready ? (
        <div className="text-muted-foreground bg-surface absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-sm">
          <Loader2 className="size-6 animate-spin" />
          <span>Loading preview…</span>
        </div>
      ) : null}
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
