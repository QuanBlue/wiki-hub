import { vi } from "vitest";

/** Shared scaffolding for the BackupPanel test files: a routed `fetch`, a
 * stand-in for the `XMLHttpRequest` the part uploads use, and a tiny real ZIP. */

export type RouteHandler = (
  init?: RequestInit,
) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

export type Route = { method: string; match: (pathname: string) => boolean; handler: RouteHandler };

export function mockFetch(routes: Route[]) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const route = routes.find((r) => r.method === method && r.match(pathname));
    if (!route) {
      return new Response(
        JSON.stringify({ error: { code: "not_found", message: `Unhandled ${method} ${pathname}` } }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    const { status = 200, body } = await route.handler(init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

export const SPACES = [
  { id: "s1", key: "ENG", name: "Engineering", status: "active" },
  { id: "s2", key: "SALES", name: "Sales", status: "active" },
];

/** What every render of BackupPanel asks for on mount. */
export function baseRoutes(): Route[] {
  return [
    { method: "POST", match: (p) => p === "/api/v1/auth/renew", handler: () => ({ body: {} }) },
    { method: "GET", match: (p) => p === "/api/v1/confluence-imports/jobs", handler: () => ({ body: [] }) },
    {
      method: "GET",
      match: (p) => p === "/api/v1/confluence-imports/uploads/active",
      handler: () => ({ body: [] }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/settings",
      handler: () => ({ status: 500, body: { error: { code: "unavailable", message: "n/a" } } }),
    },
    { method: "GET", match: (p) => p === "/api/v1/spaces", handler: () => ({ body: SPACES }) },
    { method: "GET", match: (p) => p === "/api/v1/backup/jobs", handler: () => ({ body: [] }) },
    {
      method: "GET",
      match: (p) => p === "/api/v1/backup/archives/uploads/active",
      handler: () => ({ body: [] }),
    },
  ];
}

/** The part uploads go through `XMLHttpRequest` (for `upload.onprogress`). */
export class FakeUploadXHR {
  static status = 200;
  static fail: "error" | null = null;
  static hold = false;
  static last: FakeUploadXHR | null = null;
  method = "";
  url = "";
  status = 0;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {
    /* no-op */
  }
  send() {
    FakeUploadXHR.last = this;
    if (FakeUploadXHR.hold) return;
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 } as ProgressEvent);
      this.upload.onprogress?.({ lengthComputable: false, loaded: 1, total: 1 } as ProgressEvent);
      this.upload.onprogress?.({ lengthComputable: true, loaded: 0, total: 1 } as ProgressEvent);
      if (FakeUploadXHR.fail === "error") {
        this.onerror?.();
        return;
      }
      this.status = FakeUploadXHR.status;
      this.onload?.();
    });
  }
  abort() {
    this.onabort?.();
  }
}

export function stubUploadXHR(options: { status?: number; fail?: "error" | null; hold?: boolean } = {}) {
  FakeUploadXHR.status = options.status ?? 200;
  FakeUploadXHR.fail = options.fail ?? null;
  FakeUploadXHR.hold = options.hold ?? false;
  FakeUploadXHR.last = null;
  vi.stubGlobal("XMLHttpRequest", FakeUploadXHR as unknown as typeof XMLHttpRequest);
}

/** A minimal genuine ZIP, so the archive-format check walks a real central directory. */
export function makeZip(entries: Record<string, string>, filename: string): File {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new File([new Blob([...locals, ...centrals, eocd] as BlobPart[])], filename, {
    type: "application/zip",
  });
}

export const confluenceExportZip = (filename: string) =>
  makeZip({ "entities.xml": "<root/>", "exportDescriptor.properties": "b=1" }, filename);

export const wikihubBackupZip = (filename: string) =>
  makeZip({ "manifest.json": "{}", "data/workspace.json": "{}" }, filename);

export const CONFLUENCE_ARCHIVE = {
  id: "conf-1",
  filename: "confluence.zip",
  size_bytes: 10,
  sha256: null,
  status: "scanned",
  error: null,
  spaces: [
    { key: "ENG", name: "Engineering", page_count: 3, attachment_count: 1, conflict: false },
    { key: "OPS", name: "Operations", page_count: 5, attachment_count: 0, conflict: true },
  ],
};

export const UPLOAD_TARGET = {
  archive_id: "conf-1",
  object_key: "imports/conf-1/c.zip",
  max_size_bytes: 999_999_999,
  part_size_bytes: 8 * 1024 * 1024,
  uploaded_parts: [] as number[],
  status: "uploading",
  sha256: null,
  reused: false,
};

/** Every route a Confluence upload-and-scan makes, ending in a scanned archive. */
export function confluenceUploadRoutes(overrides: Partial<Record<string, RouteHandler>> = {}): Route[] {
  const route = (method: string, match: (p: string) => boolean, key: string, handler: RouteHandler): Route => ({
    method,
    match,
    handler: overrides[key] ?? handler,
  });
  return [
    route("POST", (p) => p === "/api/v1/confluence-imports/uploads", "start", () => ({ body: UPLOAD_TARGET })),
    route(
      "POST",
      (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload-parts",
      "parts",
      () => ({ body: { urls: { "1": "http://localhost/part1" } } }),
    ),
    route(
      "POST",
      (p) => p === "/api/v1/confluence-imports/archives/conf-1/complete-upload",
      "complete",
      () => ({ body: {} }),
    ),
    route("POST", (p) => p === "/api/v1/confluence-imports/archives/conf-1/scan", "scan", () => ({
      body: CONFLUENCE_ARCHIVE,
    })),
  ];
}

export const RESTORE_ARCHIVE = {
  id: "archive-1",
  filename: "f.zip",
  size_bytes: 9,
  sha256: null,
  status: "scanned",
  error: null,
  spaces: [
    { key: "ENG", name: "Engineering", page_count: 3, conflict: false },
    { key: "SALES", name: "Sales", page_count: 2, conflict: true },
  ],
};

/** The routes of a `.zip` restore's "Upload and scan" step, ending in a scanned archive. */
export function restoreUploadRoutes(overrides: Partial<Record<string, RouteHandler>> = {}): Route[] {
  const route = (match: (p: string) => boolean, key: string, handler: RouteHandler): Route => ({
    method: "POST",
    match,
    handler: overrides[key] ?? handler,
  });
  return [
    route((p) => p === "/api/v1/backup/archives/uploads", "start", () => ({
      body: {
        archive_id: "archive-1",
        object_key: "backups/imports/archive-1/f.zip",
        max_size_bytes: 999_999_999,
        part_size_bytes: 64,
        uploaded_parts: [],
        status: "uploading",
        sha256: null,
        reused: false,
      },
    })),
    route((p) => p === "/api/v1/backup/archives/archive-1/upload-parts", "parts", () => ({
      body: { urls: { "1": "http://localhost/p1", "2": "http://localhost/p2", "3": "http://localhost/p3" } },
    })),
    route((p) => p === "/api/v1/backup/archives/archive-1/complete-upload", "complete", () => ({
      body: { ...RESTORE_ARCHIVE, status: "uploaded", spaces: [] },
    })),
    route((p) => p === "/api/v1/backup/archives/archive-1/scan", "scan", () => ({ body: RESTORE_ARCHIVE })),
  ];
}
