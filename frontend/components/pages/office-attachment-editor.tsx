"use client";

import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
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
        reject(new Error("The document editor did not initialize."));
      }
    };
    script.onerror = () => {
      documentServerScript = null;
      reject(new Error("Could not load the document editor."));
    };
    document.head.appendChild(script);
  });
  return documentServerScript;
}

export function OfficeAttachmentEditor({
  attachmentId,
  filename,
}: {
  attachmentId: string;
  filename: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<OnlyOfficeEditor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
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
        setError("The workspace document editor is not configured.");
        return;
      }
      try {
        const response = await fetch(
          `/api/v1/attachments/${attachmentId}/office/config`,
        );
        if (!response.ok) {
          const envelope = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(
            envelope?.error?.message ?? "Could not open the document editor.",
          );
        }
        const result = (await response.json()) as { config: OnlyOfficeConfig };
        await loadDocumentServerScript(serverUrl);
        if (cancelled || !hostElement || !window.DocsAPI?.DocEditor) return;

        // DocsAPI replaces the target DOM node in-place with an <iframe>.
        // Mount inside an imperative child node so React reconciliation never
        // calls removeChild on a node ONLYOFFICE already replaced.
        const mountNode = document.createElement("div");
        mountNode.id = `onlyoffice-editor-${attachmentId}`;
        mountNode.className = "h-full w-full";
        hostElement.replaceChildren(mountNode);

        loadTimer = window.setTimeout(() => {
          if (!cancelled) {
            setError(
              "The document editor took too long to respond. Make sure the Document Server is reachable and try again.",
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
            onDocumentStateChange: (event: { data?: boolean }) => {
              if (!cancelled) setSaving(Boolean(event.data));
            },
            onError: (event: { data?: { errorDescription?: string } }) => {
              clearLoadTimer();
              if (!cancelled) {
                setError(
                  event.data?.errorDescription ??
                    "The document editor encountered an error.",
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
              : "Could not open the document editor.",
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
  }, [attachmentId, attempt]);

  if (error) {
    return (
      <div
        key="office-error"
        className="text-muted-foreground flex h-full min-h-80 w-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <TriangleAlert className="text-warning size-8" />
        <div>
          <p className="text-foreground text-sm font-semibold">
            Could not open the document editor
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
            setSaving(false);
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
      key="office-host"
      className="bg-surface relative h-full min-h-0 w-full overflow-hidden"
    >
      {!ready ? (
        <div className="text-muted-foreground bg-surface absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-sm">
          <Loader2 className="size-6 animate-spin" />
          <span>Loading document editor…</span>
        </div>
      ) : null}
      <div ref={hostRef} className="h-full w-full" />
      {ready ? (
        <p className="text-muted-foreground bg-surface-raised/90 pointer-events-none absolute right-3 bottom-2 z-10 rounded px-2 py-1 text-xs shadow-xs">
          {saving
            ? "Saving changes…"
            : `${filename} · Changes save automatically`}
        </p>
      ) : null}
    </div>
  );
}
