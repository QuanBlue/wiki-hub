import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// The chats kept in the browser are encrypted with a key from the server. Tests of what is
// kept read it as written: no cipher, and a key that is there at once. ``chat-vault.test``
// uses the real ones.
vi.mock("@/lib/chat-seal", () => ({
  isSealed: () => false,
  seal: (_key: Uint8Array, _name: string, text: string) => text,
  unseal: (_key: Uint8Array, _name: string, value: string) => value,
  fromBase64: () => new Uint8Array(32),
}));
vi.mock("@/lib/chat-key", () => ({
  fetchChatKey: async () => ({ key: new Uint8Array(32), keyId: "test" }),
}));
// Imported when a test starts, so that a test file's own mocks apply to it.
beforeEach(async () => {
  (await import("@/lib/chat-vault")).setChatKey(new Uint8Array(32));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Per tab, like the chat panel's open state: one test must not leave it open for the next.
  if (typeof window !== "undefined") window.sessionStorage.clear();
});

// jsdom implements neither of these, and both are used by the layout components.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// jsdom doesn't implement this either (used by the slash-command menu to
// keep the keyboard-highlighted row in view as it scrolls).
window.Element.prototype.scrollIntoView = vi.fn();

if (typeof Range !== "undefined") {
  Range.prototype.getClientRects = () =>
    [{ x: 0, y: 0, bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, toJSON: () => ({}) }] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, toJSON: () => ({}) }) as unknown as DOMRect;
}

if (typeof Element !== "undefined") {
  Element.prototype.getClientRects = () =>
    [{ x: 0, y: 0, bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, toJSON: () => ({}) }] as unknown as DOMRectList;
}

// jsdom's Blob/File (File extends Blob) don't implement `.arrayBuffer()` -
// real browsers have supported it for years, so this is purely a test-env
// gap. `sha256File` (backup-panel.tsx) relies on it to fingerprint an
// upload; FileReader, which jsdom does implement, stands in for it here.
if (typeof Blob !== "undefined") {
  if (typeof Blob.prototype.arrayBuffer !== "function") {
    Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error("Blob read failed."));
        reader.readAsArrayBuffer(this);
      });
    };
  }
  if (typeof Blob.prototype.stream !== "function") {
    Blob.prototype.stream = function (this: Blob): ReadableStream {
      return new ReadableStream({
        start: async (controller) => {
          const buf = await this.arrayBuffer();
          controller.enqueue(new Uint8Array(buf));
          controller.close();
        },
      });
    };
  }
}

// jsdom has no layout, so it never implemented hit-testing; ProseMirror asks for it
// on every mouse press in the editor.
if (typeof document !== "undefined" && typeof document.elementFromPoint !== "function") {
  document.elementFromPoint = () => null;
}
