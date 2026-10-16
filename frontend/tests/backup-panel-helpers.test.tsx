import { createHash, webcrypto } from "node:crypto";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CountList,
  automatedBackupBadgeVariant,
  clearStoredUploadMetadata,
  errorMessage,
  fileMatchesStoredUpload,
  forgetCancelledUpload,
  normalizeStoredUpload,
  readCancelledUploadIds,
  readStoredUploadMetadata,
  rememberCancelledUpload,
  saveStoredUploadMetadata,
  serverUploadToStoredUpload,
  sha256File,
  type StoredConfluenceUpload,
} from "@/components/admin/backup-panel";

const METADATA_KEY = "wikihub-confluence-upload-current";
const CANCELLED_KEY = "wikihub-confluence-cancelled-uploads";

const stored = (overrides: Partial<StoredConfluenceUpload> = {}): StoredConfluenceUpload => ({
  archiveId: "a1",
  fileName: "space.zip",
  fileSize: 10,
  fileLastModified: 5,
  sha256: "abc",
  partSize: 4,
  ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stored upload metadata", () => {
  it("keeps what is needed to resume, taking missing details from the file itself", () => {
    const file = new File(["12345"], "from-file.zip", { lastModified: 77 });

    expect(normalizeStoredUpload({ archiveId: "a1", partSize: 4, file })).toMatchObject({
      archiveId: "a1",
      fileName: "from-file.zip",
      fileSize: 5,
      fileLastModified: 77,
      sha256: null,
      partSize: 4,
      file,
    });
    expect(
      normalizeStoredUpload({
        archiveId: "a1",
        partSize: 4,
        fileName: "x.zip",
        fileSize: 1,
        fileLastModified: null,
        sha256: "h",
      }),
    ).toMatchObject({ fileName: "x.zip", fileLastModified: null, sha256: "h", file: undefined });
  });

  it.each([
    [null],
    [undefined],
    [{ archiveId: "", partSize: 4, fileName: "x", fileSize: 1, fileLastModified: 1 }],
    [{ archiveId: "a", partSize: 0, fileName: "x", fileSize: 1, fileLastModified: 1 }],
    [{ archiveId: "a", partSize: 4, fileSize: 1, fileLastModified: 1 }],
    [{ archiveId: "a", partSize: 4, fileName: "x", fileLastModified: 1 }],
    [{ archiveId: "a", partSize: 4, fileName: "x", fileSize: 1 }],
  ])("refuses an incomplete record (%j)", (record) => {
    expect(normalizeStoredUpload(record as never)).toBeNull();
  });

  it("saves, reads and clears the record without the file itself", () => {
    saveStoredUploadMetadata(stored({ file: new File(["x"], "x.zip") }));

    expect(JSON.parse(window.localStorage.getItem(METADATA_KEY)!)).not.toHaveProperty("file");
    expect(readStoredUploadMetadata()).toMatchObject({ archiveId: "a1", fileName: "space.zip" });

    clearStoredUploadMetadata();
    expect(readStoredUploadMetadata()).toBeNull();
  });

  it.each([["{broken"], [JSON.stringify({ archiveId: "a" })]])("treats %s as nothing saved", (raw) => {
    window.localStorage.setItem(METADATA_KEY, raw);

    expect(readStoredUploadMetadata()).toBeNull();
  });

  it("carries on when browser storage is not available", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => saveStoredUploadMetadata(stored())).not.toThrow();
    expect(() => clearStoredUploadMetadata()).not.toThrow();
    expect(() => rememberCancelledUpload("a1")).not.toThrow();
    expect(() => forgetCancelledUpload("a1")).not.toThrow();
    expect(readStoredUploadMetadata()).toBeNull();
    expect(readCancelledUploadIds().size).toBe(0);
  });
});

describe("cancelled uploads", () => {
  it("remembers the newest twenty, once each, and forgets one on request", () => {
    for (let i = 0; i < 25; i += 1) rememberCancelledUpload(`id-${i}`);
    rememberCancelledUpload("id-24");
    rememberCancelledUpload(null);
    rememberCancelledUpload(undefined);

    const ids = readCancelledUploadIds();
    expect(ids.size).toBeLessThanOrEqual(20);
    expect(ids.has("id-24")).toBe(true);
    expect(ids.has("id-0")).toBe(false);

    forgetCancelledUpload("id-24");
    expect(readCancelledUploadIds().has("id-24")).toBe(false);
    forgetCancelledUpload(null);
  });

  it("drops the record altogether once nothing is left in it", () => {
    rememberCancelledUpload("only");

    forgetCancelledUpload("only");

    expect(window.localStorage.getItem(CANCELLED_KEY)).toBeNull();
  });

  it.each([["{broken"], [JSON.stringify({ not: "a list" })], [JSON.stringify(["", "a", null])]])(
    "reads %s defensively",
    (raw) => {
      window.localStorage.setItem(CANCELLED_KEY, raw);

      const ids = readCancelledUploadIds();
      expect([...ids].every((id) => id === "a")).toBe(true);
    },
  );
});

describe("matching a chosen file to a saved upload", () => {
  it("needs the same name and size", () => {
    const file = new File(["0123456789"], "space.zip");

    expect(fileMatchesStoredUpload(file, stored())).toBe(true);
    expect(fileMatchesStoredUpload(file, stored({ fileName: "other.zip" }))).toBe(false);
    expect(fileMatchesStoredUpload(file, stored({ fileSize: 3 }))).toBe(false);
    expect(fileMatchesStoredUpload(null, stored())).toBe(false);
    expect(fileMatchesStoredUpload(file, null)).toBe(false);
  });

  it("reads an upload the server knows about", () => {
    expect(
      serverUploadToStoredUpload({
        archive_id: "arch",
        filename: "s.zip",
        size_bytes: 9,
        sha256: "h",
        part_size_bytes: 3,
      } as never),
    ).toEqual({
      archiveId: "arch",
      fileName: "s.zip",
      fileSize: 9,
      fileLastModified: null,
      sha256: "h",
      partSize: 3,
    });
  });
});

describe("display helpers", () => {
  it.each([
    ["complete", "success"],
    ["failed", "danger"],
    ["cancelled", "warning"],
    ["running", "info"],
    ["queued", "neutral"],
  ])("colours %s as %s", (status, variant) => {
    expect(automatedBackupBadgeVariant(status)).toBe(variant);
  });

  it("lists counts by kind, and nothing when there are none", () => {
    const { container, rerender } = render(<CountList title="Created" counts={{ page_comment: 2, user: 1 }} />);

    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("2 × page comment")).toBeInTheDocument();
    expect(screen.getByText("1 × user")).toBeInTheDocument();

    rerender(<CountList title="Created" counts={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

function fileOf(bytes: Uint8Array, name = "archive.zip", lastModified = 1_700_000_000_000) {
  return new File([bytes as BlobPart], name, { lastModified });
}

function nativeCrypto() {
  vi.stubGlobal("crypto", {
    subtle: { digest: (algorithm: string, data: BufferSource) => webcrypto.subtle.digest(algorithm, data) },
  });
}

const sha = (...parts: Uint8Array[]) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
};

const MB = 1024 * 1024;

describe("sha256File", () => {
  it("fingerprints a small file with the browser's own SHA-256", async () => {
    nativeCrypto();
    const bytes = new TextEncoder().encode("hello wiki");
    const onProgress = vi.fn();

    expect(await sha256File(fileOf(bytes), onProgress)).toBe(sha(bytes));
    expect(onProgress).toHaveBeenCalledWith(bytes.length);
  });

  it("samples the start, middle and end of a large file", async () => {
    nativeCrypto();
    const bytes = new Uint8Array(9 * MB).map((_, i) => i % 251);
    const file = fileOf(bytes, "big.zip");
    const mid = Math.floor((bytes.length - 2 * MB) / 2);
    const meta = new TextEncoder().encode(`size:${bytes.length};name:big.zip;`);

    const result = await sha256File(file, vi.fn());

    expect(result).toBe(
      sha(bytes.slice(0, 2 * MB), bytes.slice(mid, mid + 2 * MB), bytes.slice(bytes.length - 2 * MB), meta),
    );
  });

  it("gives up on a small file that was cancelled while it was being read or hashed", async () => {
    nativeCrypto();
    const bytes = new TextEncoder().encode("hello wiki");

    const early = new AbortController();
    early.abort();
    await expect(sha256File(fileOf(bytes), vi.fn(), early.signal)).rejects.toMatchObject({ name: "AbortError" });

    const late = new AbortController();
    vi.stubGlobal("crypto", {
      subtle: {
        digest: async (algorithm: string, data: BufferSource) => {
          late.abort();
          return webcrypto.subtle.digest(algorithm, data);
        },
      },
    });
    await expect(sha256File(fileOf(bytes), vi.fn(), late.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("gives up on a large file that was cancelled while it was being read or hashed", async () => {
    nativeCrypto();
    const bytes = new Uint8Array(9 * MB);
    const early = new AbortController();
    const file = fileOf(bytes);
    const original = file.slice.bind(file);
    vi.spyOn(file, "slice").mockImplementation((...args: Parameters<Blob["slice"]>) => {
      const part = original(...args);
      // Cancelled once the last sample has been taken.
      if (args[0] === bytes.length - 2 * MB) early.abort();
      return part;
    });
    await expect(sha256File(file, vi.fn(), early.signal)).rejects.toMatchObject({ name: "AbortError" });

    const late = new AbortController();
    vi.stubGlobal("crypto", {
      subtle: {
        digest: async (algorithm: string, data: BufferSource) => {
          late.abort();
          return webcrypto.subtle.digest(algorithm, data);
        },
      },
    });
    await expect(sha256File(fileOf(bytes), vi.fn(), late.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("falls back to its own SHA-256 where the browser has none, and gets the same answer", async () => {
    vi.stubGlobal("crypto", undefined);
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 7) % 256);
    const onProgress = vi.fn();

    expect(await sha256File(fileOf(bytes), onProgress)).toBe(sha(bytes));
    expect(onProgress).toHaveBeenLastCalledWith(bytes.length);
    expect(await sha256File(fileOf(new Uint8Array(0)), vi.fn())).toBe(sha(new Uint8Array(0)));
    // A length that forces the padding into a second block.
    const edge = new Uint8Array(60).fill(3);
    expect(await sha256File(fileOf(edge), vi.fn())).toBe(sha(edge));
  });

  it("falls back when the browser's SHA-256 fails", async () => {
    vi.stubGlobal("crypto", { subtle: { digest: async () => Promise.reject(new Error("unsupported")) } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bytes = new TextEncoder().encode("hello wiki");

    expect(await sha256File(fileOf(bytes), vi.fn())).toBe(sha(bytes));
    expect(warn).toHaveBeenCalled();
  });

  it("samples a large file with its own SHA-256 too", async () => {
    vi.stubGlobal("crypto", undefined);
    const bytes = new Uint8Array(9 * MB).map((_, i) => i % 253);
    const mid = Math.floor((bytes.length - 2 * MB) / 2);
    const lastModified = 1_700_000_000_000;
    const meta = new TextEncoder().encode(`size:${bytes.length};modified:${lastModified};name:big.zip;`);
    const onProgress = vi.fn();

    const result = await sha256File(fileOf(bytes, "big.zip", lastModified), onProgress);

    expect(result).toBe(
      sha(bytes.slice(0, 2 * MB), bytes.slice(mid, mid + 2 * MB), bytes.slice(bytes.length - 2 * MB), meta),
    );
    expect(onProgress).toHaveBeenCalledWith(bytes.length);
  });

  it("stops its own hashing when cancelled", async () => {
    vi.stubGlobal("crypto", undefined);
    const controller = new AbortController();
    controller.abort();
    await expect(
      sha256File(fileOf(new Uint8Array(10)), vi.fn(), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });

    const late = new AbortController();
    const small = fileOf(new Uint8Array(10));
    await expect(
      sha256File(small, () => late.abort(), late.signal),
    ).rejects.toMatchObject({ name: "AbortError" });

    const large = new AbortController();
    await expect(
      sha256File(fileOf(new Uint8Array(9 * MB)), () => large.abort(), large.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("errorMessage", () => {
  it("passes on the server's own words, and falls back for anything else", async () => {
    const { ApiError } = await import("@/lib/api-client");

    expect(errorMessage(new ApiError(409, "busy", "Already running."), "Fallback.")).toBe("Already running.");
    expect(errorMessage(new Error("boom"), "Fallback.")).toBe("Fallback.");
    expect(errorMessage("text", "Fallback.")).toBe("Fallback.");
    expect(errorMessage(undefined, "Fallback.")).toBe("Fallback.");
  });
});
