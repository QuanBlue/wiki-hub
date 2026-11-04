import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ImageCropDialog } from "@/components/account/image-crop-dialog";

const drawImage = vi.fn();

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:source");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 1200;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 600,
    height: 100,
  } as DOMRect);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => {
      callback(new Blob(["cropped"], { type: "image/png" }));
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  drawImage.mockClear();
});

it.each([
  { kind: "cover" as const, width: 600, height: 160, output: [1500, 400] },
  { kind: "avatar" as const, width: 240, height: 240, output: [512, 512] },
])("uses the same positioned crop for the $kind preview and upload", async ({ kind, width, height, output }) => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height,
  } as DOMRect);
  const onApply = vi.fn();
  const file = new File(["original"], `${kind}.webp`, { type: "image/webp" });
  render(
    <ImageCropDialog
      file={file}
      kind={kind}
      onApply={onApply}
      onClose={vi.fn()}
    />,
  );

  const position = screen.getByRole("group", {
    name: "Image position. Use arrow keys to move.",
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Use image" })).toBeEnabled(),
  );
  fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), {
    target: { value: "2" },
  });
  fireEvent.keyDown(position, { key: "ArrowLeft" });
  fireEvent.click(screen.getByRole("button", { name: "Use image" }));

  await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
  const cropped = onApply.mock.calls[0]![0] as File;
  expect(cropped.name).toBe(`${kind}.png`);
  expect(cropped.type).toBe("image/png");
  const preview = drawImage.mock.calls.filter((call) =>
    call.slice(-2).every((value, index) => value === [width, height][index]),
  ).at(-1);
  const upload = drawImage.mock.calls.find((call) =>
    call.slice(-2).every((value, index) => value === output[index]),
  );
  expect(preview).toBeDefined();
  expect(upload).toBeDefined();
  expect(upload!.slice(1, 5)).toEqual(preview!.slice(1, 5));
  expect((upload![1] as number)).toBeGreaterThan(0);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});
