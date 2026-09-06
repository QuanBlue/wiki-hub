import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: getMock, post: postMock } }));

import {
  getPageRevision,
  getRevisionDiff,
  listPageRevisions,
  restorePageRevision,
} from "@/lib/revisions";

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe("listPageRevisions", () => {
  it("lists a page's revisions, encoding the space key and slug", async () => {
    getMock.mockResolvedValue([]);

    await listPageRevisions("ENG", "getting started");

    expect(getMock).toHaveBeenCalledWith(
      "/api/v1/spaces/ENG/pages/getting%20started/revisions",
    );
  });
});

describe("getPageRevision", () => {
  it("reads one specific version", async () => {
    getMock.mockResolvedValue({ version: 3 });

    await getPageRevision("ENG", "home", 3);

    expect(getMock).toHaveBeenCalledWith("/api/v1/spaces/ENG/pages/home/revisions/3");
  });
});

describe("getRevisionDiff", () => {
  it("requests the diff with no query when neither version is given", async () => {
    getMock.mockResolvedValue({});

    await getRevisionDiff("ENG", "home");

    expect(getMock).toHaveBeenCalledWith("/api/v1/spaces/ENG/pages/home/revisions/diff");
  });

  it("includes only the versions actually given", async () => {
    getMock.mockResolvedValue({});

    await getRevisionDiff("ENG", "home", 2);

    expect(getMock).toHaveBeenCalledWith(
      "/api/v1/spaces/ENG/pages/home/revisions/diff?from_version=2",
    );
  });

  it("includes both versions when given", async () => {
    getMock.mockResolvedValue({});

    await getRevisionDiff("ENG", "home", 2, 5);

    expect(getMock).toHaveBeenCalledWith(
      "/api/v1/spaces/ENG/pages/home/revisions/diff?from_version=2&to_version=5",
    );
  });
});

describe("restorePageRevision", () => {
  it("posts to the restore endpoint for the given version", async () => {
    postMock.mockResolvedValue(undefined);

    await restorePageRevision("ENG", "home", 4);

    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/spaces/ENG/pages/home/revisions/4/restore",
    );
  });
});
