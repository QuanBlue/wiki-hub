/**
 * Shared ambient types for ONLYOFFICE's `DocsAPI.DocEditor` global.
 *
 * Both `OfficeAttachmentEditor` (edit-capable, keyed by attachment) and
 * `OfficePreviewViewer` (read-only, keyed by storage key) load the same
 * Document Server script and mount into this same global - a `declare
 * global` block in each file, with two different shapes for the same
 * `Window.DocsAPI` property, is a TypeScript error ("subsequent property
 * declarations must have the same type"), not just duplication. This is the
 * one definition both files augment `Window` with.
 */

export type OnlyOfficeConfig = {
  documentType: "word" | "cell" | "slide" | "pdf";
  document: { key: string; title: string; fileType: string };
  editorConfig: Record<string, unknown>;
  token: string;
  events?: Record<string, unknown>;
};

export type OnlyOfficeEditor = { destroyEditor: () => void };

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (
        elementId: string,
        config: OnlyOfficeConfig,
      ) => OnlyOfficeEditor;
    };
  }
}
