import { describe, expect, it } from "vitest";

import { detectArchiveFormat } from "@/lib/archive-format";

/**
 * Build a real ZIP rather than a fixture blob: the point of the detector is
 * that it walks an actual central directory, so a hand-waved byte string would
 * test nothing. Stored (uncompressed) entries keep the writer short; the
 * detector never decompresses anything.
 */
function zip(entries: Record<string, string>, options: { zip64?: boolean } = {}): File {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const cdSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const cdOffset = offset;
  const parts: Uint8Array[] = [...locals, ...centrals];

  if (options.zip64) {
    // The shape a >4GB archive actually takes: the EOCD carries 0xffffffff
    // placeholders and the real numbers live in the ZIP64 records.
    const zip64Eocd = new Uint8Array(56);
    const z = new DataView(zip64Eocd.buffer);
    z.setUint32(0, 0x06064b50, true);
    z.setUint32(4, 44, true);
    z.setUint32(40, cdSize, true);
    z.setUint32(48, cdOffset, true);

    const locator = new Uint8Array(20);
    const l = new DataView(locator.buffer);
    l.setUint32(0, 0x07064b50, true);
    l.setUint32(8, cdOffset + cdSize, true);
    l.setUint32(16, 1, true);

    const eocd = new Uint8Array(22);
    const e = new DataView(eocd.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, 0xffff, true);
    e.setUint16(10, 0xffff, true);
    e.setUint32(12, 0xffffffff, true);
    e.setUint32(16, 0xffffffff, true);

    parts.push(zip64Eocd, locator, eocd);
  } else {
    const eocd = new Uint8Array(22);
    const e = new DataView(eocd.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, centrals.length, true);
    e.setUint16(10, centrals.length, true);
    e.setUint32(12, cdSize, true);
    e.setUint32(16, cdOffset, true);
    parts.push(eocd);
  }

  return new File([new Blob(parts as BlobPart[])], "archive.zip");
}

describe("detectArchiveFormat", () => {
  it("recognises a WikiHub backup", async () => {
    const file = zip({
      "manifest.json": "{}",
      "data/workspace.json": "{}",
      "attachments/a/b.png": "x",
    });
    expect(await detectArchiveFormat(file)).toBe("wikihub");
  });

  it("recognises a Confluence export", async () => {
    const file = zip({
      "entities.xml": "<root/>",
      "exportDescriptor.properties": "buildNumber=1",
    });
    expect(await detectArchiveFormat(file)).toBe("confluence");
  });

  it("reads a ZIP64 archive, which is what any multi-GB backup is", async () => {
    // The archives this feature exists for are all ZIP64; a detector that
    // silently gave up on them would help exactly nobody.
    const file = zip({ "data/workspace.json": "{}" }, { zip64: true });
    expect(await detectArchiveFormat(file)).toBe("wikihub");
  });

  it("does not match a marker that is only part of a longer path", async () => {
    // Searching the raw directory bytes would call this a WikiHub backup.
    const file = zip({
      "entities.xml": "<root/>",
      "attachments/data/workspace.json.bak": "{}",
    });
    expect(await detectArchiveFormat(file)).toBe("confluence");
  });

  it("returns unknown for a zip that is neither", async () => {
    expect(await detectArchiveFormat(zip({ "readme.txt": "hi" }))).toBe("unknown");
  });

  it("returns unknown rather than throwing on a non-zip file", async () => {
    const file = new File([new Blob([new Uint8Array(64)])], "notes.json");
    expect(await detectArchiveFormat(file)).toBe("unknown");
  });

  it("returns unknown on a truncated archive instead of blocking the upload", async () => {
    // Refusing an upload on a hunch is worse than the mistake being prevented,
    // so anything unparseable must fall through to the server's validation.
    const whole = zip({ "data/workspace.json": "{}" });
    const truncated = new File(
      [(await whole.arrayBuffer()).slice(0, 20)],
      "archive.zip",
    );
    expect(await detectArchiveFormat(truncated)).toBe("unknown");
  });

  it("ignores an end-of-directory signature that appears inside the comment", async () => {
    const base = zip({ "entities.xml": "<root/>" });
    const bytes = new Uint8Array(await base.arrayBuffer());
    // Re-emit the archive with a comment that contains the EOCD signature: a
    // forward scan would stop at the decoy and read garbage offsets.
    const decoy = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
    const withComment = new Uint8Array(bytes.length + decoy.length);
    withComment.set(bytes, 0);
    withComment.set(decoy, bytes.length);
    new DataView(withComment.buffer).setUint16(
      bytes.length - 2,
      decoy.length,
      true,
    );
    const file = new File([withComment], "archive.zip");
    expect(await detectArchiveFormat(file)).toBe("confluence");
  });

  it("does not read the whole file to answer", async () => {
    // The guarantee that makes this usable on a 16 GB archive. The payload has
    // to exceed the 64 KB end-of-directory search window for the claim to mean
    // anything - below that, reading "the tail" is reading everything.
    const file = zip({
      "data/workspace.json": "{}",
      "big.bin": "x".repeat(2 * 1024 * 1024),
    });
    let bytesRead = 0;
    const realSlice = file.slice.bind(file);
    Object.defineProperty(file, "slice", {
      value: (start?: number, end?: number) => {
        const blob = realSlice(start, end);
        bytesRead += blob.size;
        return blob;
      },
    });
    expect(await detectArchiveFormat(file)).toBe("wikihub");
    expect(bytesRead).toBeLessThan(file.size);
  });
});
