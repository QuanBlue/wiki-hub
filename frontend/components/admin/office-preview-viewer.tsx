"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api-client";
import type { OnlyOfficeConfig, OnlyOfficeEditor } from "@/types/onlyoffice";

/**
 * Read-only ONLYOFFICE preview for an arbitrary storage object.
 *
 * The edit-capable counterpart of this is `OfficeAttachmentEditor`
 * (`@/components/pages/office-attachment-editor`), keyed by a `PageAttachment`
 * row with a save-back callback. This one is keyed by a raw storage key
 * instead - the admin Object Storage browser lists avatars, import archives
 * and other objects with no attachment permission to check an edit against -
 * so it only ever asks the backend for a view-only configuration
 * (`/api/v1/storage/office-preview/config`) and never registers a callback.
 * The DocsAPI script-loading plumbing below is intentionally the same shape
 * as the editor's; two documented copies of a five-line loader are cheaper to
 * read than a shared abstraction over "load this global script once" would be.
 */

let documentServerScript: Promise<void> | null = null;

function documentServerUrl() {
  return (process.env.NEXT_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL ?? "").replace(
    /\/+$/,
    "",
  );
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

  useEffect(() => {
    let cancelled = false;
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
        if (cancelled || !hostRef.current || !window.DocsAPI?.DocEditor) return;

        const config: OnlyOfficeConfig = {
          ...result.config,
          events: {
            ...result.config.events,
            onDocumentReady: () => {
              if (!cancelled) setReady(true);
            },
            onError: (event: { data?: { errorDescription?: string } }) => {
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
          hostRef.current.id,
          config,
        );
      } catch (loadError) {
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
      editorRef.current?.destroyEditor();
      editorRef.current = null;
    };
  }, [storageKey]);

  if (error) {
    return (
      <div className="text-muted-foreground flex h-full min-h-80 w-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="text-warning size-8" />
        <div>
          <p className="text-foreground text-sm font-semibold">
            Could not open the document preview
          </p>
          <p className="mt-1 max-w-md text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface relative h-full min-h-0 w-full overflow-hidden">
      {!ready ? (
        <div className="text-muted-foreground bg-surface absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-sm">
          <Loader2 className="size-6 animate-spin" />
          <span>Loading preview…</span>
        </div>
      ) : null}
      <div
        id={elementIdFor(storageKey)}
        ref={hostRef}
        aria-label={`Preview of ${filename}`}
        className="h-full w-full"
      />
    </div>
  );
}
