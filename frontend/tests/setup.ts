import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
if (
  typeof Blob !== "undefined" &&
  typeof Blob.prototype.arrayBuffer !== "function"
) {
  Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error("Blob read failed."));
      reader.readAsArrayBuffer(this);
    });
  };
}
