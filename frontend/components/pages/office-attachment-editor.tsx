"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { OnlyOfficeConfig, OnlyOfficeEditor } from "@/types/onlyoffice";

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

  useEffect(() => {
    let cancelled = false;
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
        if (cancelled || !hostRef.current || !window.DocsAPI?.DocEditor) return;

        const config: OnlyOfficeConfig = {
          ...result.config,
          events: {
            ...result.config.events,
            onDocumentReady: () => {
              if (!cancelled) setReady(true);
            },
            onDocumentStateChange: (event: { data?: boolean }) => {
              if (!cancelled) setSaving(Boolean(event.data));
            },
            onError: (event: { data?: { errorDescription?: string } }) => {
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
          hostRef.current.id,
          config,
        );
      } catch (loadError) {
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
      editorRef.current?.destroyEditor();
      editorRef.current = null;
    };
  }, [attachmentId]);

  if (error) {
    return (
      <div className="text-muted-foreground flex h-full min-h-80 w-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="text-warning size-8" />
        <div>
          <p className="text-foreground text-sm font-semibold">
            Could not open the document editor
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
          <span>Loading document editor…</span>
        </div>
      ) : null}
      <div
        id={`onlyoffice-editor-${attachmentId}`}
        ref={hostRef}
        className="h-full w-full"
      />
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
