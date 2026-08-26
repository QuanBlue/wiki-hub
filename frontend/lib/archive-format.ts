/**
 * Tell a WikiHub backup and a Confluence export apart, in the browser, before
 * a byte is uploaded.
 *
 * The two import cards sit side by side and both take a `.zip`, so handing one
 * the other's archive is an easy mistake. The server catches it (see
 * `backup/package.py` and `import_export/confluence.py`), but only after the
 * whole upload has finished - which on a multi-GB archive means discovering
 * the mistake an hour in. This reads the archive's index locally instead.
 *
 * A ZIP keeps its index - the central directory - at the *end*, so this needs
 * only the tail of the file no matter how large it is: the end-of-central-
 * directory record, then the directory itself. For a 16 GB backup with 100k
 * entries that is under 10 MB, and `File.slice()` reads it without loading the
 * rest.
 */

/** `data/workspace.json` is the entry `list_backup_spaces` requires. */
const WIKIHUB_MARKER = "data/workspace.json";
/** `entities.xml` is the entry `scan_archive` requires. */
const CONFLUENCE_MARKER = "entities.xml";

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CD_ENTRY_SIGNATURE = 0x02014b50;

const EOCD_MIN_SIZE = 22;
/** A ZIP comment is a u16 length, so the record starts within this of the end. */
const EOCD_MAX_SEARCH = EOCD_MIN_SIZE + 0xffff;
/** Refuse to pull an unbounded directory over what may be a slow disk. */
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;

export type ArchiveFormat =
  /** A WikiHub full backup - the "Restore WikiHub Backup" card. */
  | "wikihub"
  /** A Confluence site/space export - the "Import Confluence Backup" card. */
  | "confluence"
  /** Not a ZIP, unreadable, or carrying neither marker. Say nothing. */
  | "unknown";

async function readSlice(file: File, start: number, end: number): Promise<DataView> {
  const from = Math.max(0, start);
  const to = Math.min(file.size, end);
  if (to <= from) return new DataView(new ArrayBuffer(0));
  return new DataView(await file.slice(from, to).arrayBuffer());
}

/** Locate the central directory, following the ZIP64 records when present. */
async function findCentralDirectory(
  file: File,
): Promise<{ offset: number; size: number } | null> {
  const tail = await readSlice(file, file.size - EOCD_MAX_SEARCH, file.size);
  if (tail.byteLength < EOCD_MIN_SIZE) return null;

  // Scan backwards: the signature can also occur inside the comment, and the
  // last match is the real record.
  let eocd = -1;
  for (let i = tail.byteLength - EOCD_MIN_SIZE; i >= 0; i -= 1) {
    if (tail.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  let size = tail.getUint32(eocd + 12, true);
  let offset = tail.getUint32(eocd + 16, true);

  // 0xffffffff in either field means the true values live in the ZIP64
  // records - which is the normal case for the multi-GB archives this exists
  // to spare, so it is not an edge case worth skipping.
  if (size === 0xffffffff || offset === 0xffffffff) {
    let locator = -1;
    for (let i = eocd - 20; i >= 0; i -= 1) {
      if (tail.getUint32(i, true) === ZIP64_LOCATOR_SIGNATURE) {
        locator = i;
        break;
      }
    }
    if (locator < 0) return null;
    // Reading the u64 as two u32s: a ZIP offset beyond 2^53 is not a case any
    // browser could open anyway, and Number keeps the arithmetic below plain.
    const zip64Low = tail.getUint32(locator + 8, true);
    const zip64High = tail.getUint32(locator + 12, true);
    const zip64Offset = zip64High * 0x100000000 + zip64Low;

    const record = await readSlice(file, zip64Offset, zip64Offset + 56);
    if (record.byteLength < 56) return null;
    if (record.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) return null;
    size =
      record.getUint32(44, true) * 0x100000000 + record.getUint32(40, true);
    offset =
      record.getUint32(52, true) * 0x100000000 + record.getUint32(48, true);
  }

  if (!Number.isFinite(offset) || !Number.isFinite(size) || size <= 0) {
    return null;
  }
  return { offset, size };
}

/**
 * Walk the central directory and return the entry names it declares.
 *
 * Names are matched exactly rather than by searching the raw bytes for the
 * marker: a path such as `attachments/data/workspace.json.bak` contains the
 * marker as a substring and is not the entry we mean.
 */
function entryNames(directory: DataView): Set<string> {
  const names = new Set<string>();
  const decoder = new TextDecoder();
  const bytes = new Uint8Array(
    directory.buffer,
    directory.byteOffset,
    directory.byteLength,
  );
  let at = 0;
  while (at + 46 <= directory.byteLength) {
    if (directory.getUint32(at, true) !== CD_ENTRY_SIGNATURE) break;
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    const nameStart = at + 46;
    if (nameStart + nameLength > directory.byteLength) break;
    names.add(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)));
    at = nameStart + nameLength + extraLength + commentLength;
  }
  return names;
}

/**
 * Identify a selected archive, or return "unknown" rather than guessing.
 *
 * Never throws: a file that cannot be read this way is simply not classified,
 * and the upload proceeds to the server's own validation as before. Refusing
 * an upload on a hunch would be worse than the mistake this prevents.
 */
export async function detectArchiveFormat(file: File): Promise<ArchiveFormat> {
  try {
    const directory = await findCentralDirectory(file);
    if (!directory) return "unknown";
    if (directory.size > MAX_DIRECTORY_BYTES) return "unknown";
    const bytes = await readSlice(
      file,
      directory.offset,
      directory.offset + directory.size,
    );
    if (bytes.byteLength === 0) return "unknown";
    const names = entryNames(bytes);
    if (names.has(WIKIHUB_MARKER)) return "wikihub";
    if (names.has(CONFLUENCE_MARKER)) return "confluence";
    return "unknown";
  } catch {
    return "unknown";
  }
}
