export type ImageSize = { width: number; height: number };
export type ImageOffset = { x: number; y: number };

export function cropGeometry(
  image: ImageSize,
  viewport: ImageSize,
  zoom: number,
  offset: ImageOffset,
) {
  const scale =
    Math.max(viewport.width / image.width, viewport.height / image.height) *
    zoom;
  const renderedWidth = image.width * scale;
  const renderedHeight = image.height * scale;
  const maxX = Math.max(0, (renderedWidth - viewport.width) / 2);
  const maxY = Math.max(0, (renderedHeight - viewport.height) / 2);
  const x = Math.max(-maxX, Math.min(maxX, offset.x));
  const y = Math.max(-maxY, Math.min(maxY, offset.y));

  return {
    renderedWidth,
    renderedHeight,
    x,
    y,
    sourceX: (maxX - x) / scale,
    sourceY: (maxY - y) / scale,
    sourceWidth: viewport.width / scale,
    sourceHeight: viewport.height / scale,
  };
}

export function drawImageCrop(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  geometry: ReturnType<typeof cropGeometry>,
  width: number,
  height: number,
) {
  context.drawImage(
    image,
    geometry.sourceX,
    geometry.sourceY,
    geometry.sourceWidth,
    geometry.sourceHeight,
    0,
    0,
    width,
    height,
  );
}

export async function cropImageFile(
  source: File,
  image: HTMLImageElement,
  viewport: ImageSize,
  zoom: number,
  offset: ImageOffset,
  kind: "avatar" | "cover",
): Promise<File> {
  const geometry = cropGeometry(
    { width: image.naturalWidth, height: image.naturalHeight },
    viewport,
    zoom,
    offset,
  );
  const canvas = document.createElement("canvas");
  canvas.width = kind === "avatar" ? 512 : 1500;
  canvas.height = kind === "avatar" ? 512 : 400;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  drawImageCrop(context, image, geometry, canvas.width, canvas.height);
  const type = source.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, 0.9),
  );
  if (!blob) throw new Error("Could not crop the image.");
  const extension = type === "image/jpeg" ? "jpg" : "png";
  const baseName = source.name.replace(/\.[^.]+$/, "") || kind;
  return new File([blob], `${baseName}.${extension}`, { type });
}
