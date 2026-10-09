import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SpaceWorkspace } from "@/components/pages/space-workspace";
import { api } from "@/lib/api-client";
import * as drafts from "@/lib/drafts";
import type { Group, PageDraft, Space, WikiPage } from "@/types/api";

const { push, refresh, toastSuccess, toastError, sidebar, uploadResults } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  sidebar: { collapsed: false, setCollapsed: vi.fn(), mobileOpen: false },
  uploadResults: [] as unknown[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/components/layout/sidebar-context", () => ({ useSidebar: () => sidebar }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/drafts", () => ({
  clearLocalPageDraft: vi.fn(),
  discardPageDraft: vi.fn(),
  getLocalPageDraft: vi.fn(),
  getPageDraft: vi.fn(),
  saveLocalPageDraft: vi.fn(),
  savePageDraft: vi.fn(),
}));

type EditorProps = {
  content: string;
  onChange: (value: string) => void;
  onUploadFile?: (file: File) => Promise<unknown>;
  onSubpageCreated?: (page: { slug: string }) => void;
};
vi.mock("@/components/pages/rich-text-editor", () => ({
  RichTextEditor: ({ content, onChange, onUploadFile, onSubpageCreated }: EditorProps) => (
    <div>
      <textarea aria-label="Rich editor" value={content} onChange={(event) => onChange(event.target.value)} />
      {onUploadFile ? (
        <button
          type="button"
          onClick={() =>
            void onUploadFile(new File(["x"], "a.png")).then(
              (value) => uploadResults.push(value),
              (error) => uploadResults.push(error),
            )
          }
        >
          Upload file
        </button>
      ) : null}
      {onSubpageCreated ? (
        <button type="button" onClick={() => onSubpageCreated({ slug: "child" })}>
          Make subpage
        </button>
      ) : null}
    </div>
  ),
  RichTextContent: ({ content }: { content: string }) => (
    <div data-testid="rendered" dangerouslySetInnerHTML={{ __html: content }} />
  ),
  isAttachmentHref: (href: string) => href.includes("/attachments/"),
}));
vi.mock("@/components/pages/source-code-editor", () => ({
  SourceCodeEditor: ({ language, value, onChange }: { language: string; value: string; onChange: (value: string) => void }) => (
    <textarea aria-label={`${language} source`} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

function dialogStub(name: string) {
  return ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) =>
    open ? (
      <div role="dialog" aria-label={name}>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close {name}
        </button>
      </div>
    ) : null;
}
vi.mock("@/components/admin/edit-space-modal", () => ({ EditSpaceModal: dialogStub("Edit space") }));
vi.mock("@/components/pages/page-history-modal", () => ({
  PageHistoryModal: (props: { open: boolean; onOpenChange: (open: boolean) => void; onRestored?: () => void }) =>
    props.open ? (
      <div role="dialog" aria-label="History">
        <button type="button" onClick={() => props.onRestored?.()}>Restore version</button>
      </div>
    ) : null,
}));
vi.mock("@/components/pages/page-attachments-dialog", () => ({ PageAttachmentsDialog: dialogStub("Attachments") }));
vi.mock("@/components/pages/page-restrictions-dialog", () => ({ PageRestrictionsDialog: dialogStub("Page access") }));
vi.mock("@/components/pages/move-page-dialog", () => ({ MovePageDialog: dialogStub("Move page") }));
vi.mock("@/components/pages/page-labels-dialog", () => ({
  PageLabelsDialog: ({ open, onChange }: { open: boolean; onChange: (labels: { id: string; name: string }[]) => void }) =>
    open ? (
      <div role="dialog" aria-label="Labels">
        <button type="button" onClick={() => onChange([{ id: "l1", name: "runbook" }, { id: "l2", name: "ops" }])}>
          Apply labels
        </button>
      </div>
    ) : null,
}));
vi.mock("@/components/pages/import-pages-dialog", () => ({
  ImportPagesDialog: (props: { open: boolean; onStarted: () => void; onFinished: () => void }) =>
    props.open ? (
      <div role="dialog" aria-label="Import pages">
        <button type="button" onClick={() => { props.onStarted(); props.onFinished(); }}>Finish import</button>
      </div>
    ) : null,
}));
vi.mock("@/components/pages/create-page-dialog", () => ({
  CreatePageDialog: ({ triggerLabel }: { triggerLabel: string }) => <button type="button">{triggerLabel || "New page"}</button>,
}));
vi.mock("@/components/pages/page-content-loading", () => ({ PageContentLoading: () => null }));
vi.mock("@/components/users/user-profile-trigger", () => ({
  UserProfileTrigger: ({ username }: { username: string }) => <span>@{username}</span>,
}));
vi.mock("@/components/comments/likers-popover", () => ({
  LikersPopover: ({ count }: { count: number }) => <span data-testid="like-count">{count}</span>,
}));
vi.mock("@/components/comments/page-comments", () => ({
  PageComments: ({ headerStart, headerEnd }: { headerStart: React.ReactNode; headerEnd: React.ReactNode }) => (
    <section aria-label="Comments">{headerStart}{headerEnd}</section>
  ),
}));
vi.mock("@/components/pages/share-page-dialog", () => ({
  SharePageDialog: (props: { open: boolean; onShared: (count: number) => void; onCopyLink: () => void }) =>
    props.open ? (
      <div role="dialog" aria-label="Share with people">
        <button type="button" onClick={() => props.onShared(5)}>Send share</button>
      </div>
    ) : null,
}));

const mocked = vi.mocked(api);
const mockedDrafts = vi.mocked(drafts);

class FakeResizeObserver {
  constructor(private callback: (entries: unknown[]) => void) {}
  observe() {
    this.callback([]);
  }
  disconnect() {}
}

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "s1",
    key: "ENG",
    name: "Engineering",
    description: "<p>Space overview</p>",
    icon: "",
    font_family: null,
    status: "active",
    visibility: "open",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T10:30:00Z",
    created_by_username: "ann",
    owners: [],
    is_owner: false,
    member_count: 3,
    group_permission_count: 0,
    direct_user_permission_count: 0,
    is_favorite: false,
    my_role: "admin",
    ...overrides,
  } as Space;
}

function page(id: string, overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id,
    space_id: "s1",
    parent_id: null,
    title: `Page ${id}`,
    slug: id,
    content: `<p>Body of ${id}</p>`,
    content_format: "html",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-03-04T05:06:07Z",
    created_by_username: "ann",
    updated_by_username: "bob",
    can_edit: true,
    can_move: true,
    can_delete: true,
    ...overrides,
  };
}

const HOME = page("eng", { title: "Engineering" });
const GUIDES = page("guides", { parent_id: "eng", title: "Guides" });
const SETUP = page("setup", { parent_id: "guides", title: "Setup" });
const DEEP = page("deep", { parent_id: "setup", title: "Deep dive" });
const ORPHAN = page("orphan", { parent_id: "missing", title: "Orphan" });
const PAGES = [HOME, GUIDES, SETUP, DEEP, ORPHAN];

type Props = Parameters<typeof SpaceWorkspace>[0];

function renderWorkspace(overrides: Partial<Props> = {}) {
  const props: Props = {
    space: makeSpace(),
    pages: PAGES,
    members: [],
    groups: [] as Group[],
    currentPage: null,
    canEdit: true,
    canExport: true,
    canManageRestrictions: true,
    currentUser: { username: "ann" } as Props["currentUser"],
    ...overrides,
  };
  const view = render(<SpaceWorkspace {...props} />);
  return { view, props, actor: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) };
}

function serve(extra: Record<string, unknown> = {}) {
  mocked.get.mockImplementation(async (path: string) => {
    if (path in extra) {
      const value = extra[path];
      if (value instanceof Error) throw value;
      return value;
    }
    if (path.endsWith("/audience")) return { users: 1, groups: 2, everyone: false };
    if (path.endsWith("/like")) return { liked_by_me: false, like_count: 4 };
    if (path.endsWith("/shares")) return { share_count: 3 };
    if (path === "/api/v1/users/me/pins") return [];
    throw new Error(`unexpected ${path}`);
  });
}

/** The page's own Edit button (it opens a menu), not the sidebar's space Edit. */
function pageEditButton() {
  return screen
    .getAllByRole("button", { name: /^Edit/ })
    .find((button) => button.getAttribute("aria-haspopup") === "menu")!;
}

async function openMenu(actor: ReturnType<typeof userEvent.setup>, index = 0) {
  await actor.click(screen.getAllByRole("button", { name: "More page actions" })[index]!);
}

async function openSub(actor: ReturnType<typeof userEvent.setup>, name: string) {
  const trigger = screen.getByRole("menuitem", { name });
  trigger.focus();
  await actor.keyboard("{ArrowRight}");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.localStorage.clear();
  window.sessionStorage.clear();
  uploadResults.length = 0;
  sidebar.collapsed = false;
  sidebar.mobileOpen = false;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  serve();
  mockedDrafts.getPageDraft.mockResolvedValue(null);
  mockedDrafts.getLocalPageDraft.mockReturnValue(null);
  mockedDrafts.savePageDraft.mockResolvedValue(undefined as never);
  mockedDrafts.discardPageDraft.mockResolvedValue(undefined);
  mocked.patch.mockImplementation(async (_path: string, body: unknown) => ({ ...HOME, ...(body as object) }));
  mocked.put.mockResolvedValue({ liked_by_me: true, like_count: 5 });
  mocked.delete.mockResolvedValue({ liked_by_me: false, like_count: 4 });
  mocked.post.mockResolvedValue({ id: "att", url: "/a" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SpaceWorkspace overview", () => {
  it("shows the space overview, its audience and its page tree", async () => {
    renderWorkspace();

    expect(screen.getByRole("heading", { level: 1, name: "Engineering" })).toBeInTheDocument();
    expect(screen.getByTestId("rendered")).toHaveTextContent("Space overview");
    expect(await screen.findByText("1 user and 2 groups have access to this space")).toBeInTheDocument();
    const tree = screen.getByRole("navigation", { name: "Engineering page tree" });
    // The home page is the space itself, so its children sit at the top level.
    expect(within(tree).getByRole("link", { name: "Guides" })).toBeInTheDocument();
    expect(within(tree).getByRole("link", { name: "Orphan" })).toBeInTheDocument();
    expect(within(tree).queryByRole("link", { name: "Setup" })).toBeNull();
    expect(screen.getAllByText("@ann").length).toBeGreaterThan(0);
  });

  it("says when the whole workspace can read it, or nothing could be counted", async () => {
    serve({ "/api/v1/spaces/ENG/audience": { users: 5, groups: 1, everyone: true } });
    const { view } = renderWorkspace();
    expect(await screen.findByText("All users and all groups have access to this space")).toBeInTheDocument();
    view.unmount();

    serve({ "/api/v1/spaces/ENG/audience": new Error("offline") });
    renderWorkspace();
    await act(async () => {});
    expect(screen.queryByText(/have access to this space/)).toBeNull();
  });

  it("edits and saves the overview, or reports why it could not", async () => {
    const { actor } = renderWorkspace();

    await actor.click(screen.getByRole("button", { name: "Edit overview" }));
    await actor.type(screen.getByLabelText("Rich editor"), "!");
    expect(screen.getByText(/\/200,000 characters/)).toBeInTheDocument();
    mocked.patch.mockRejectedValueOnce(new Error("Too long."));
    await actor.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Too long."));
    mocked.patch.mockRejectedValueOnce("odd");
    await actor.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not update the overview."));

    await actor.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Overview updated."));
    expect(mocked.patch).toHaveBeenLastCalledWith("/api/v1/spaces/ENG", { description: "<p>Space overview</p>!" });
    expect(refresh).toHaveBeenCalled();

    await actor.click(screen.getByRole("button", { name: "Edit overview" }));
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit overview" })).toBeInTheDocument();
  });

  it("favourites the space, and undoes it when that fails", async () => {
    const { actor } = renderWorkspace();

    await actor.click(screen.getByRole("button", { name: "Add to favourites" }));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/ENG/favorite"));
    await actor.click(screen.getByRole("button", { name: "Remove from favourites" }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith("/api/v1/spaces/ENG/favorite"));

    mocked.put.mockRejectedValueOnce(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: "Add to favourites" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not update favourites."));
    expect(screen.getByRole("button", { name: "Add to favourites" })).toHaveAttribute("aria-pressed", "false");
  });

  it("opens space administration, and the import dialog", async () => {
    const { actor } = renderWorkspace();

    await actor.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog", { name: "Edit space" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Close Edit space" }));

    await actor.click(screen.getByRole("button", { name: "Import pages from files" }));
    await actor.click(screen.getByRole("button", { name: "Finish import" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("hides editing for readers and archived spaces", () => {
    const { view } = renderWorkspace({ canEdit: false, space: makeSpace({ my_role: null, my_permissions: ["admin"] }) });
    expect(screen.queryByRole("button", { name: "Edit overview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import pages from files" })).toBeNull();
    // Admin through the permission list still gets space administration.
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    view.unmount();

    renderWorkspace({ space: makeSpace({ status: "archived", my_role: "viewer" as never, description: "", icon: "x" }) });
    expect(screen.queryByRole("button", { name: "Edit overview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByText("No content yet")).toBeInTheDocument();
    expect(screen.getByText("X")).toBeInTheDocument();
  });

  it("collapses away the sidebar, or shows it on mobile", () => {
    sidebar.collapsed = true;
    const { view } = renderWorkspace();
    expect(screen.queryByRole("navigation", { name: "Engineering page tree" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resize space sidebar" })).toBeNull();
    view.unmount();

    sidebar.mobileOpen = true;
    renderWorkspace({ space: makeSpace({ font_family: "roboto" }) });
    expect(document.getElementById("wikihub-sidebar")).toHaveClass("block");
  });
});

describe("SpaceWorkspace page tree", () => {
  it("opens the active page's ancestors, toggles folders and remembers them", async () => {
    const { actor, view } = renderWorkspace({ currentPage: DEEP });
    const tree = screen.getByRole("navigation", { name: "Engineering page tree" });

    expect(within(tree).getByRole("link", { name: "Deep dive" })).toHaveAttribute("aria-current", "page");
    await actor.click(within(tree).getByRole("button", { name: "Collapse folder Guides" }));
    expect(within(tree).queryByRole("link", { name: "Setup" })).toBeNull();
    await actor.click(within(tree).getByRole("button", { name: "Expand folder Guides" }));
    view.unmount();

    window.sessionStorage.setItem("wikihub:page-tree-expanded:ENG", "not json");
    const second = renderWorkspace({ currentPage: GUIDES });
    // The active page's own children open too.
    expect(within(screen.getByRole("navigation", { name: "Engineering page tree" })).getByRole("link", { name: "Setup" })).toBeInTheDocument();
    second.view.unmount();

    window.sessionStorage.setItem("wikihub:page-tree-expanded:ENG", JSON.stringify(["guides", "setup"]));
    renderWorkspace();
    expect(screen.getByRole("link", { name: "Deep dive" })).toBeInTheDocument();
  });

  it("restores the sidebar's scroll position and saves it again", () => {
    window.sessionStorage.setItem("wikihub:space-sidebar-scroll:ENG", "120");
    const { view } = renderWorkspace();
    const scroller = screen.getByRole("navigation", { name: "Engineering page tree" }).parentElement!;

    expect(scroller.scrollTop).toBe(120);
    scroller.scrollTop = 40;
    fireEvent.scroll(scroller);
    expect(window.sessionStorage.getItem("wikihub:space-sidebar-scroll:ENG")).toBe("40");
    view.unmount();
  });

  it("resizes the sidebar by dragging, within its bounds", () => {
    renderWorkspace();
    const handle = screen.getByRole("button", { name: "Resize space sidebar" });

    fireEvent.pointerDown(handle);
    expect(document.body.style.cursor).toBe("col-resize");
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 9000 }));
    });
    expect(window.localStorage.getItem("wikihub:space-sidebar-width")).toBe("520");
    expect(sidebar.setCollapsed).toHaveBeenCalledWith(false);
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(document.body.style.cursor).toBe("");
  });

  it("reads the width from storage, the preloaded style, or the default", () => {
    window.localStorage.setItem("wikihub:space-sidebar-width", "100");
    const { view } = renderWorkspace();
    expect(document.getElementById("wikihub-sidebar")!.style.getPropertyValue("--space-sidebar-width")).toBe("200px");
    view.unmount();

    window.localStorage.setItem("wikihub:space-sidebar-width", "wide");
    document.documentElement.style.setProperty("--wh-preloaded-space-sidebar-width", "333px");
    const second = renderWorkspace();
    expect(document.getElementById("wikihub-sidebar")!.style.getPropertyValue("--space-sidebar-width")).toBe("333px");
    second.view.unmount();

    document.documentElement.style.removeProperty("--wh-preloaded-space-sidebar-width");
    const getItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (this === window.localStorage) throw new Error("blocked");
      return getItem.call(this, key);
    });
    renderWorkspace();
    expect(document.getElementById("wikihub-sidebar")!.style.getPropertyValue("--space-sidebar-width")).toBe("320px");
  });
});

describe("SpaceWorkspace page view", () => {
  it("shows the breadcrumb, collapsing a deep path, and the access icon", async () => {
    renderWorkspace({ currentPage: { ...DEEP, is_restricted: true } });

    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByLabelText("Earlier pages")).toBeInTheDocument();
    expect(within(crumbs).getByRole("link", { name: "Setup" })).toBeInTheDocument();
    expect(within(crumbs).getByRole("img", { name: /only the people this page names/ })).toBeInTheDocument();
    expect(screen.getByText(/last modified/)).toHaveTextContent("Mar 4, 2026 at");
    expect(await screen.findByText("1 user and 2 groups can view this page")).toBeInTheDocument();
  });

  it.each([
    [{ is_restricted: true }, "restricted", /restricted page inside a restricted space/],
    [{}, "restricted", /only members of this restricted space/],
    [{}, "open", /everyone with access to this site/],
  ] as const)("describes access for %o in a %s space", (extra, visibility, label) => {
    renderWorkspace({ currentPage: { ...GUIDES, ...extra }, space: makeSpace({ visibility }) });
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
  });

  it("names nobody for a page without author records, and keeps a date-only stamp as a date", () => {
    renderWorkspace({
      currentPage: { ...GUIDES, created_by_username: null, updated_by_username: null, updated_at: "2026-03-04" },
    });
    expect(screen.getByText(/Created by unknown/)).toHaveTextContent("on Mar 4, 2026");
  });

  it("renders a Markdown page through the built-in Markdown subset", () => {
    const markdown = [
      "# Title **bold**",
      "",
      "- one `code`",
      "* two _em_",
      "1. first [link](https://x.test)",
      "2. second",
      "<hr>",
      "<div class=\"note\">",
      "html block",
      "</div>",
      "plain <b>text</b>",
    ].join("\r\n");
    renderWorkspace({ currentPage: { ...GUIDES, content: markdown, content_format: "markdown" } });

    const rendered = screen.getByTestId("rendered");
    expect(rendered.querySelector("h1 strong")).toHaveTextContent("bold");
    expect(rendered.querySelectorAll("ul li")).toHaveLength(2);
    expect(rendered.querySelector("ol a")).toHaveAttribute("href", "https://x.test");
    expect(rendered.querySelector("hr")).not.toBeNull();
    expect(rendered.querySelector("div.note")).toHaveTextContent("html block");
    expect(rendered.querySelector("p")).toHaveTextContent("plain <b>text</b>");
  });

  it("likes and unlikes the page, and reports a failure", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });

    // Rendered at once with 0, then filled in by the like lookup.
    await waitFor(() => expect(screen.getByTestId("like-count")).toHaveTextContent("4"));
    await actor.click(screen.getByRole("button", { name: "Like this page (4 likes)" }));
    expect(await screen.findByRole("button", { name: "Unlike this page (5 likes)" })).toBeInTheDocument();
    mocked.delete.mockRejectedValueOnce(new Error("Nope."));
    await actor.click(screen.getByRole("button", { name: "Unlike this page (5 likes)" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Nope."));
    mocked.delete.mockRejectedValueOnce("odd");
    await actor.click(screen.getByRole("button", { name: "Unlike this page (5 likes)" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not update the like."));
  });

  it("pins and unpins the page, from either toolbar", async () => {
    serve({ "/api/v1/users/me/pins": [{ id: "guides" }] });
    const { actor } = renderWorkspace({ currentPage: GUIDES });

    await waitFor(() => expect(screen.getByRole("button", { name: "Pinned" })).toBeInTheDocument());
    await actor.click(screen.getByRole("button", { name: "Pinned" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Removed from pinned pages."));
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/users/me/pins/guides");
    await openMenu(actor, 1);
    await actor.click(screen.getByRole("menuitem", { name: "Pin page" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Page pinned."));

    mocked.delete.mockRejectedValueOnce(new Error("Locked."));
    await actor.click(screen.getByRole("button", { name: "Pinned" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Locked."));
    mocked.delete.mockRejectedValueOnce("odd");
    await actor.click(screen.getByRole("button", { name: "Pinned" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not update the pinned page."));
  });

  it("treats a failed pin lookup as not pinned", async () => {
    serve({ "/api/v1/users/me/pins": new Error("offline") });
    renderWorkspace({ currentPage: GUIDES });
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Pin page" })).toBeInTheDocument();
  });

  it("saves the page for later, and un-saves it from the mobile menu", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });

    await actor.click(screen.getByRole("button", { name: "Save for later" }));
    expect(toastSuccess).toHaveBeenCalledWith("Page saved for later.");
    expect(JSON.parse(window.localStorage.getItem("wikihub:saved-page-keys")!)).toEqual(["ENG/guides"]);
    await openMenu(actor, 1);
    await actor.click(screen.getByRole("menuitem", { name: "Remove from saved" }));
    expect(toastSuccess).toHaveBeenCalledWith("Removed from saved pages.");

    // Storage written elsewhere is picked up; a broken value reads as empty.
    window.localStorage.setItem("wikihub:saved-page-keys", JSON.stringify(["ENG/guides", 3]));
    act(() => window.dispatchEvent(new Event("storage")));
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
    window.localStorage.setItem("wikihub:saved-page-keys", JSON.stringify({ a: 1 }));
    act(() => window.dispatchEvent(new Event("storage")));
    window.localStorage.setItem("wikihub:saved-page-keys", "{broken");
    act(() => window.dispatchEvent(new Event("storage")));
    expect(screen.getByRole("button", { name: "Save for later" })).toBeInTheDocument();

    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (this === window.localStorage) throw new Error("quota");
      setItem.call(this, key, value);
    });
    await actor.click(screen.getByRole("button", { name: "Save for later" }));
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
  });

  it("copies the page link, falling back when the clipboard API refuses", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    writeText.mockResolvedValueOnce();
    await actor.click(screen.getByRole("button", { name: "Share" }));
    await actor.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Page link copied to clipboard."));

    writeText.mockRejectedValueOnce(new Error("denied"));
    document.execCommand = vi.fn().mockReturnValue(true);
    await actor.click(screen.getByRole("button", { name: "Share" }));
    await actor.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(document.execCommand).toHaveBeenCalledWith("copy"));

    writeText.mockRejectedValueOnce(new Error("denied"));
    document.execCommand = vi.fn().mockReturnValue(false);
    await openMenu(actor, 1);
    await actor.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not copy the page link."));
  });

  it("shares with people from the Share menu and the count under the page", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    const count = await screen.findByRole("button", { name: "Shared 3 times - share with people" });

    await actor.click(screen.getByRole("button", { name: "Share" }));
    await actor.click(screen.getByRole("menuitem", { name: "Share with people…" }));
    await actor.click(screen.getByRole("button", { name: "Send share" }));
    expect(count).toHaveAccessibleName("Shared 5 times - share with people");

    await actor.click(count);
    expect(screen.getByRole("dialog", { name: "Share with people" })).toBeInTheDocument();
  });

  it("only copies the link on a space overview, which has no page to send", async () => {
    const { actor } = renderWorkspace();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValueOnce();

    await actor.click(screen.getByRole("button", { name: "Share" }));

    expect(screen.queryByRole("menuitem", { name: "Share with people…" })).not.toBeInTheDocument();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Page link copied to clipboard."));
  });

  it("exports the page in each format from both menus", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    for (const [index, label, format] of [
      [0, "Export HTML", "HTML"],
      [0, "Export PDF", "PDF"],
      [1, "Export Word", "DOCX"],
    ] as const) {
      await openMenu(actor, index);
      await openSub(actor, "Export");
      await actor.click(await screen.findByRole("menuitem", { name: label }));
      expect(toastSuccess).toHaveBeenLastCalledWith(
        `Preparing your ${format} export — the download will start shortly.`,
      );
    }
    expect(click).toHaveBeenCalledTimes(3);
  });

  it("opens each page tool from the desktop menu", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });

    for (const [item, dialog] of [
      ["Move page", "Move page"],
      ["Page history", "History"],
      ["Page access", "Page access"],
      ["Labels", "Labels"],
      ["Attachments", "Attachments"],
    ] as const) {
      await openMenu(actor);
      await actor.click(screen.getByRole("menuitem", { name: item }));
      expect(screen.getByRole("dialog", { name: dialog })).toBeInTheDocument();
      const close = within(screen.getByRole("dialog", { name: dialog })).queryByRole("button", { name: new RegExp(`^Close`) });
      if (close) await actor.click(close);
    }
    await actor.click(screen.getByRole("button", { name: "Restore version" }));
    expect(refresh).toHaveBeenCalled();
    await actor.click(screen.getByRole("button", { name: "Apply labels" }));
    expect(screen.getByText("runbook, ops")).toBeInTheDocument();
  });

  it("opens each page tool from the mobile menu", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });

    for (const item of ["Move page", "Page history", "Page access", "Labels", "Attachments", "Delete page"]) {
      await openMenu(actor, 1);
      await actor.click(screen.getByRole("menuitem", { name: item }));
    }
    expect(screen.getByRole("alertdialog", { name: "Delete this page?" })).toBeInTheDocument();
  });

  it("switches between full and normal width from both menus", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    const article = () => document.querySelector("article")!;

    await openMenu(actor);
    await openSub(actor, "View");
    await actor.click(await screen.findByRole("menuitem", { name: "Normal width" }));
    expect(article()).toHaveClass("max-w-[var(--wh-content-max)]");
    await openMenu(actor, 1);
    await openSub(actor, "View");
    await actor.click(await screen.findByRole("menuitem", { name: /Full width/ }));
    expect(article()).not.toHaveClass("max-w-[var(--wh-content-max)]");
    await openMenu(actor);
    await openSub(actor, "View");
    await actor.click(await screen.findByRole("menuitem", { name: /Full width/ }));
    await openMenu(actor, 1);
    await openSub(actor, "View");
    await actor.click(await screen.findByRole("menuitem", { name: "Normal width" }));
    expect(article()).toHaveClass("max-w-[var(--wh-content-max)]");
  });

  it("deletes the page after confirming, or reports why not", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });

    await openMenu(actor);
    await actor.click(screen.getByRole("menuitem", { name: "Delete page" }));
    mocked.delete.mockRejectedValueOnce(new Error("Has children."));
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete page" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Has children."));
    mocked.delete.mockRejectedValueOnce("odd");
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete page" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not delete this page."));

    mocked.delete.mockResolvedValueOnce(undefined);
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete page" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/spaces/ENG"));
    expect(toastSuccess).toHaveBeenCalledWith('Deleted "Guides".');
  });

  it("offers only reading tools to a reader of an archived space", async () => {
    const { actor } = renderWorkspace({
      currentPage: { ...GUIDES, can_move: false, can_delete: false },
      canEdit: false,
      canExport: false,
      canManageRestrictions: false,
      currentUser: undefined,
      space: makeSpace({ status: "archived", my_role: null }),
    });

    expect(screen.queryAllByRole("button", { name: /^Edit/ })).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Comments" })).toBeNull();
    await openMenu(actor);
    expect(screen.queryByRole("menuitem", { name: "Move page" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Export" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete page" })).toBeNull();
  });

  it("offers New on the home page and Create below it", () => {
    const { view } = renderWorkspace({ currentPage: HOME });
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    view.unmount();
    renderWorkspace({ currentPage: GUIDES });
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("hides the header while scrolling down, and pins it once far down", () => {
    renderWorkspace({ currentPage: GUIDES });
    const header = screen.getByRole("navigation", { name: "Breadcrumb" }).parentElement!;
    // The desktop layout scrolls the main column, not the window.
    const main = document.querySelector("main")!;
    const scrollTo = (top: number) => {
      main.scrollTop = top;
      fireEvent.scroll(main);
    };

    scrollTo(300);
    expect(header).toHaveClass("sticky");
    expect(header).toHaveClass("opacity-0");
    scrollTo(250);
    expect(header).toHaveClass("opacity-100");
    // Jitter under 10px changes nothing; between the thresholds it stays pinned.
    scrollTo(245);
    expect(header).toHaveClass("opacity-100");
    scrollTo(100);
    expect(header).toHaveClass("sticky");
    scrollTo(2);
    expect(header).not.toHaveClass("sticky");
    expect(header).toHaveClass("opacity-100");
    // The window's own scroll is listened to as well.
    fireEvent.scroll(window);
  });
});

describe("SpaceWorkspace editing", () => {
  async function startEditing(
    actor: ReturnType<typeof userEvent.setup>,
    mode: "Normal editor" | "Markdown source" | "HTML source" = "Normal editor",
  ) {
    await actor.click(pageEditButton());
    await actor.click(await screen.findByRole("menuitem", { name: mode }));
  }

  it("edits a page in the rich editor and saves it", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await startEditing(actor);

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    await actor.clear(screen.getByLabelText("Page title"));
    await actor.type(screen.getByLabelText("Page title"), "Guides 2");
    await actor.type(screen.getByLabelText("Rich editor"), "!");
    expect(mockedDrafts.saveLocalPageDraft).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveTextContent("Save*");
    await actor.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Saved "Guides 2".'));
    expect(mocked.patch).toHaveBeenCalledWith("/api/v1/spaces/ENG/pages/guides", {
      title: "Guides 2",
      content: "<p>Body of guides</p>!",
      content_format: "html",
    });
    expect(mockedDrafts.clearLocalPageDraft).toHaveBeenCalledWith("ENG", "guides");
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByLabelText("Page title")).toBeNull();
  });

  it("falls back to the old title when the field was emptied, and reports a failed save", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await startEditing(actor);
    await actor.clear(screen.getByLabelText("Page title"));

    mocked.patch.mockRejectedValueOnce(new Error("Conflict."));
    await actor.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Conflict."));
    expect(mocked.patch).toHaveBeenCalledWith(
      "/api/v1/spaces/ENG/pages/guides",
      expect.objectContaining({ title: "Guides" }),
    );
    mocked.patch.mockRejectedValueOnce("odd");
    await actor.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not save this page."));
  });

  it("keeps a draft shortly after each change, and on request", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await startEditing(actor);

    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await actor.type(screen.getByLabelText("Rich editor"), "a");
    act(() => vi.advanceTimersByTime(700));
    await waitFor(() => expect(mockedDrafts.savePageDraft).toHaveBeenCalledTimes(1));
    expect(mockedDrafts.savePageDraft).toHaveBeenCalledWith(
      "ENG",
      "guides",
      expect.objectContaining({ content: "<p>Body of guides</p>a", edit_mode: "normal" }),
      { keepalive: false },
    );
    // Nothing new since: the button stays off.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled());

    await actor.type(screen.getByLabelText("Rich editor"), "b");
    await actor.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Draft saved. It is not published and adds nothing to history."),
    );

    mockedDrafts.savePageDraft.mockRejectedValueOnce(new Error("offline"));
    await actor.type(screen.getByLabelText("Rich editor"), "c");
    await actor.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not save the draft. Please try again."));
  });

  it("auto-saves every 30 seconds while switched on", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await startEditing(actor);

    expect(screen.getByRole("button", { name: /Auto-save on/ })).toHaveAttribute("aria-pressed", "true");
    // Nothing to save yet: the tick is a no-op.
    act(() => vi.advanceTimersByTime(30_000));
    await actor.type(screen.getByLabelText("Rich editor"), "a");
    await act(async () => vi.advanceTimersByTime(30_000));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Saved$/ })).toBeInTheDocument());
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("button", { name: /Auto-save on/ })).toBeInTheDocument();

    // Every save fails from here (the 700ms draft debounce may run first), so
    // the tick ends idle rather than "Saved".
    mockedDrafts.savePageDraft.mockRejectedValue(new Error("offline"));
    await actor.type(screen.getByLabelText("Rich editor"), "b");
    await act(async () => vi.advanceTimersByTime(30_000));
    await waitFor(() => expect(screen.getByRole("button", { name: /Auto-save on/ })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Saved$/ })).toBeNull();

    await actor.click(screen.getByRole("button", { name: /Auto-save on/ }));
    expect(screen.getByRole("button", { name: /^Auto-save$/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a live preview beside the editor, alone, and resizable", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await startEditing(actor);

    await actor.click(screen.getByRole("button", { name: "Live preview" }));
    const preview = screen.getByRole("region", { name: "Live page preview" });
    expect(within(preview).getByTestId("rendered")).toHaveTextContent("Body of guides");
    const separator = screen.getByRole("separator", { name: /Resize editor and live preview/ });
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "x"]) fireEvent.keyDown(separator, { key });
    expect(separator).toHaveAttribute("aria-valuenow", "70");

    separator.setPointerCapture = vi.fn();
    separator.releasePointerCapture = vi.fn();
    let captured = false;
    separator.hasPointerCapture = () => captured;
    fireEvent.pointerMove(separator, { clientX: 10 });
    fireEvent.pointerDown(separator, { pointerId: 1 });
    captured = true;
    vi.spyOn(separator.parentElement!, "getBoundingClientRect").mockReturnValue({ left: 0, width: 200 } as DOMRect);
    act(() => {
      separator.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, bubbles: true }));
    });
    expect(separator).toHaveAttribute("aria-valuenow", "30");
    fireEvent.pointerUp(separator, { pointerId: 1 });
    fireEvent.pointerCancel(separator);

    await actor.click(within(preview).getByRole("button", { name: /Full/ }));
    expect(screen.queryByRole("separator")).toBeNull();
    await actor.click(within(preview).getByRole("button", { name: /Split/ }));
    await actor.clear(screen.getByLabelText("Rich editor"));
    expect(screen.getByText("Nothing to preview yet.")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Hide live preview" }));
    expect(screen.queryByRole("region", { name: "Live page preview" })).toBeNull();
  });

  it("asks before converting an HTML page to Markdown, and edits the converted source", async () => {
    const complex = [
      "<h2>Heading <em>it</em></h2>",
      "<p>Hello <strong>bold</strong> <b>b</b> <i>i</i> <code>x</code> <a href=\"/l\">link</a><br>next</p>",
      "<ul><li>a</li><li>b</li></ul>",
      "<ol><li>one</li><li>two</li></ol>",
      "<table><tbody><tr><td style=\"color:red\">cell</td></tr></tbody></table>",
      "<p><span>wrapped</span></p>",
      "<p></p>",
    ].join("");
    const { actor } = renderWorkspace({ currentPage: { ...GUIDES, content: complex } });

    await startEditing(actor, "Markdown source");
    const dialog = screen.getByRole("alertdialog", { name: "Convert this page to Markdown?" });
    await actor.click(within(dialog).getByRole("button", { name: "Continue" }));

    const source = screen.getByLabelText("markdown source") as HTMLTextAreaElement;
    expect(source.value).toContain("## Heading _it_");
    expect(source.value).toContain("Hello **bold** **b** _i_ `x` [link](/l)\nnext");
    expect(source.value).toContain("- a\n- b");
    expect(source.value).toContain("1. one\n2. two");
    expect(source.value).toContain('<td style="color:red">cell</td>');
    expect(source.value).toContain("<p><span>wrapped</span></p>");

    await actor.type(source, "{enter}more");
    await actor.click(screen.getByRole("button", { name: "Live preview" }));
    expect(within(screen.getByRole("region", { name: "Live page preview" })).getByTestId("rendered")).toHaveTextContent("more");
    await actor.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith(
        "/api/v1/spaces/ENG/pages/guides",
        expect.objectContaining({ content_format: "markdown" }),
      ),
    );
  });

  it("backs out of a conversion", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await startEditing(actor, "Markdown source");
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("markdown source")).toBeNull();
  });

  it("opens a Markdown page in the HTML source editor, pretty-printed", async () => {
    const markdown = "# Title\n\n<table><tbody><tr><td>x</td></tr></tbody></table>";
    const { actor } = renderWorkspace({ currentPage: { ...GUIDES, content: markdown, content_format: "markdown" } });

    await startEditing(actor, "HTML source");
    await actor.click(within(screen.getByRole("alertdialog", { name: "Convert this page to HTML?" })).getByRole("button", { name: "Continue" }));

    const source = screen.getByLabelText("html source") as HTMLTextAreaElement;
    expect(source.value).toContain("<h1>Title</h1>");
    expect(source.value).toContain("<table>\n  <tbody>\n    <tr>\n      <td>x</td>");
    await actor.type(source, " ");
    await actor.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith(
        "/api/v1/spaces/ENG/pages/guides",
        expect.objectContaining({ content_format: "html" }),
      ),
    );
  });

  it("opens a Markdown page in its own source editor directly, keeping embedded HTML readable", async () => {
    const markdown = "Intro\n\n<div><p>a</p>text</div>";
    const { actor } = renderWorkspace({ currentPage: { ...GUIDES, content: markdown, content_format: "markdown" } });

    await startEditing(actor, "Markdown source");

    expect((screen.getByLabelText("markdown source") as HTMLTextAreaElement).value).toBe(
      "Intro\n\n<div>\n  <p>a</p>\n  text\n</div>",
    );
  });

  it("uploads an attachment to the page being edited", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await startEditing(actor);

    await actor.click(screen.getByRole("button", { name: "Upload file" }));

    await waitFor(() => expect(uploadResults).toHaveLength(1));
    expect(mocked.post).toHaveBeenCalledWith(
      "/api/v1/spaces/ENG/pages/guides/attachments",
      undefined,
      { rawBody: expect.any(FormData) },
    );
  });

  it("saves the draft and opens a sub-page created from the editor", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await startEditing(actor);
    await actor.type(screen.getByLabelText("Rich editor"), "x");

    await actor.click(screen.getByRole("button", { name: "Make subpage" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/spaces/ENG/pages/child"));
    expect(mockedDrafts.savePageDraft).toHaveBeenCalled();
  });

  it("saves with the keyboard shortcut, only when there is something to save", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await startEditing(actor);

    fireEvent.keyDown(window, { key: "s", code: "KeyS", ctrlKey: true });
    expect(mocked.patch).not.toHaveBeenCalled();
    await actor.type(screen.getByLabelText("Rich editor"), "x");
    const handled = new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    fireEvent.keyDown(window, { key: "x", code: "KeyX", ctrlKey: true });
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "s", code: "KeyS", ctrlKey: true });

    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    // Still editing: the shortcut saves without closing the editor.
    expect(screen.getByLabelText("Page title")).toBeInTheDocument();
  });
});

describe("SpaceWorkspace leaving with unsaved changes", () => {
  const originalLocation = window.location;

  function stubLocation() {
    const reload = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...originalLocation, href: originalLocation.href, origin: originalLocation.origin, reload, assign });
    return { reload, assign };
  }

  function link(href: string) {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.textContent = "elsewhere";
    document.body.appendChild(anchor);
    return anchor;
  }

  async function dirty() {
    const result = renderWorkspace({ currentPage: GUIDES });
    await result.actor.click(pageEditButton());
    await result.actor.click(await screen.findByRole("menuitem", { name: "Normal editor" }));
    await result.actor.type(screen.getByLabelText("Rich editor"), "x");
    return result;
  }

  it("cancels straight away with nothing changed", async () => {
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await actor.click(pageEditButton());
    await actor.click(await screen.findByRole("menuitem", { name: "Normal editor" }));

    await actor.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Page title")).toBeNull();
  });

  it("asks before cancelling: stay, or discard the draft", async () => {
    const { actor } = await dirty();

    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("alertdialog", { name: "Save changes before cancelling?" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(screen.getByRole("button", { name: "Leave without saving" }));
    await waitFor(() => expect(screen.queryByLabelText("Page title")).toBeNull());
    expect(mockedDrafts.discardPageDraft).toHaveBeenCalledWith("ENG", "guides");
    expect(mockedDrafts.clearLocalPageDraft).toHaveBeenCalled();
  });

  it("reports a draft that could not be discarded, and still closes the editor", async () => {
    const { actor } = await dirty();
    mockedDrafts.discardPageDraft.mockRejectedValueOnce(new Error("offline"));

    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(screen.getByRole("button", { name: "Leave without saving" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not discard the draft."));
    expect(screen.queryByLabelText("Page title")).toBeNull();
  });

  it("keeps the edits as a draft when cancelling, unless that fails", async () => {
    const { actor } = await dirty();

    mockedDrafts.savePageDraft.mockRejectedValueOnce(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(screen.getByRole("button", { name: "Save draft and leave" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not save the draft. Please try again."));
    expect(screen.getByLabelText("Page title")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Save draft and leave" }));
    await waitFor(() => expect(screen.queryByLabelText("Page title")).toBeNull());
  });

  it("saves and then cancels", async () => {
    const { actor } = await dirty();

    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(screen.getByRole("button", { name: "Save and leave" }));

    await waitFor(() => expect(screen.queryByLabelText("Page title")).toBeNull());
    expect(mocked.patch).toHaveBeenCalled();
  });

  it("stays when saving before leaving fails", async () => {
    const { actor } = await dirty();
    mocked.patch.mockRejectedValueOnce(new Error("Conflict."));

    fireEvent.click(link("/spaces/ENG/pages/other"));
    await actor.click(await screen.findByRole("button", { name: "Save and leave" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Conflict."));
    expect(push).not.toHaveBeenCalled();
  });

  it("asks before following a link, then saves and goes there", async () => {
    const { actor } = await dirty();

    fireEvent.click(link("/spaces/ENG/pages/other?x=1#h"));
    expect(await screen.findByRole("alertdialog", { name: "Save changes before leaving?" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Save and leave" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/spaces/ENG/pages/other?x=1#h"));
  });

  it("follows a link without saving, keeping a draft first", async () => {
    const { actor } = await dirty();

    fireEvent.click(link("/spaces/ENG/pages/other"));
    await actor.click(await screen.findByRole("button", { name: "Leave without saving" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/spaces/ENG/pages/other"));
    expect(mockedDrafts.savePageDraft).toHaveBeenCalled();
  });

  it("leaves for another site with a full navigation, saving or not", async () => {
    const { assign } = stubLocation();
    const { actor } = await dirty();

    fireEvent.click(link("https://elsewhere.example/a"));
    await actor.click(await screen.findByRole("button", { name: "Leave without saving" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://elsewhere.example/a"));

    await actor.type(screen.getByLabelText("Rich editor"), "y");
    fireEvent.click(link("https://elsewhere.example/b"));
    await actor.click(await screen.findByRole("button", { name: "Save and leave" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://elsewhere.example/b"));
  });

  it("asks before reloading with the shortcut, then reloads with or without saving", async () => {
    const { reload } = stubLocation();
    const { actor } = await dirty();

    fireEvent.keyDown(window, { key: "r", code: "KeyR", ctrlKey: true });
    expect(await screen.findByRole("alertdialog", { name: "Reload site?" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Reload without saving" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(window, { key: "r", code: "KeyR", ctrlKey: true });
    await actor.click(await screen.findByRole("button", { name: "Reload" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  });

  it("keeps a draft and warns on a tab close, but not once leaving is allowed", async () => {
    await dirty();

    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(mockedDrafts.savePageDraft).toHaveBeenCalledWith("ENG", "guides", expect.anything(), { keepalive: true }),
    );
  });

  it("guards unsaved overview edits too", async () => {
    const { actor } = renderWorkspace();
    await actor.click(screen.getByRole("button", { name: "Edit overview" }));
    await actor.type(screen.getByLabelText("Rich editor"), "!");

    fireEvent.click(link("/spaces"));
    expect(await screen.findByRole("alertdialog", { name: "Save changes before leaving?" })).toBeInTheDocument();
    // Ignored clicks: a plain click on the page itself, not a link.
    fireEvent.click(document.body);
  });
});

describe("SpaceWorkspace recovered drafts", () => {
  const SERVER_DRAFT: PageDraft = {
    id: "d1",
    page_id: "guides",
    content: "<p>Draft body</p>",
    content_format: "html",
    edit_mode: "normal",
    base_updated_at: "2026-03-04T05:06:07Z",
    updated_at: "2026-03-05T00:00:00Z",
    is_conflict: false,
  };

  it("offers to reopen an unreleased draft in the editor", async () => {
    mockedDrafts.getPageDraft.mockResolvedValue(SERVER_DRAFT);
    const { actor } = renderWorkspace({ currentPage: GUIDES });

    expect(await screen.findByText("Draft not released")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Open editor" }));

    expect(screen.getByLabelText("Rich editor")).toHaveValue("<p>Draft body</p>");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("reopens a Markdown draft against a Markdown page, via the Edit menu too", async () => {
    mockedDrafts.getPageDraft.mockResolvedValue({ ...SERVER_DRAFT, content: "# Draft", content_format: "markdown" });
    const { actor } = renderWorkspace({ currentPage: { ...GUIDES, content: "# Page", content_format: "markdown" } });

    await screen.findByText("Draft not released");
    await actor.click(pageEditButton());
    await actor.click(await screen.findByRole("menuitem", { name: "Normal editor" }));

    expect(screen.getByLabelText("Rich editor")).toHaveValue("<h1>Draft</h1>");
  });

  it("prefers a newer local draft and flags a conflict with the page", async () => {
    mockedDrafts.getPageDraft.mockResolvedValue(SERVER_DRAFT);
    mockedDrafts.getLocalPageDraft.mockReturnValue({
      content: "<p>Local</p>",
      content_format: "html",
      edit_mode: "normal",
      base_updated_at: "2026-01-01T00:00:00Z",
      saved_at: "2026-03-06T00:00:00Z",
    });
    renderWorkspace({ currentPage: GUIDES });

    expect(await screen.findByText(/The page has changed since this draft was created/)).toBeInTheDocument();
  });

  it("discards the draft after confirming, or reports why not", async () => {
    mockedDrafts.getPageDraft.mockResolvedValue(SERVER_DRAFT);
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await screen.findByText("Draft not released");

    await actor.click(screen.getByRole("button", { name: "Discard draft" }));
    mockedDrafts.discardPageDraft.mockRejectedValueOnce(new Error("Gone."));
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Gone."));
    mockedDrafts.discardPageDraft.mockRejectedValueOnce("odd");
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not discard the draft."));
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard draft" }));

    await waitFor(() => expect(screen.queryByText("Draft not released")).toBeNull());
    expect(toastSuccess).toHaveBeenCalledWith("Unreleased draft discarded.");
  });

  it("ignores a failed draft lookup, and asks nothing for a page you cannot edit", async () => {
    mockedDrafts.getPageDraft.mockRejectedValueOnce(new Error("offline"));
    const { view } = renderWorkspace({ currentPage: GUIDES });
    await act(async () => {});
    expect(screen.queryByText("Draft not released")).toBeNull();
    view.unmount();

    renderWorkspace({ currentPage: { ...GUIDES, can_edit: false } });
    expect(mockedDrafts.getPageDraft).toHaveBeenCalledTimes(1);
  });
});

describe("SpaceWorkspace edge cases", () => {
  function blockStorage(storage: Storage, method: "getItem" | "setItem") {
    const original = Storage.prototype[method];
    return vi.spyOn(Storage.prototype, method).mockImplementation(function (this: Storage, ...args: [string, string]) {
      if (this === storage) throw new Error("blocked");
      return (original as (...a: [string, string]) => string | null).apply(this, args);
    } as never);
  }

  it("still resizes when the width cannot be stored", () => {
    renderWorkspace();
    blockStorage(window.localStorage, "setItem");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Resize space sidebar" }));
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 250 }));
    });

    expect(document.cookie).toContain("wikihub_space_sidebar_width=250");
  });

  it("still toggles folders when their state cannot be stored", async () => {
    const { actor } = renderWorkspace({ currentPage: DEEP });
    const blocked = blockStorage(window.sessionStorage, "setItem");

    await actor.click(screen.getByRole("button", { name: "Collapse folder Guides" }));

    const tree = screen.getByRole("navigation", { name: "Engineering page tree" });
    expect(within(tree).queryByRole("link", { name: "Setup" })).toBeNull();
    // Unblock before unmount: the sidebar saves its scroll position then.
    blocked.mockRestore();
  });

  it("links home to the space itself when it has no pages, and shows no date without one", () => {
    renderWorkspace({ pages: [], space: makeSpace({ updated_at: "" }) });

    expect(screen.getByRole("link", { name: "Engineering" })).toHaveAttribute("href", "/spaces/ENG");
    expect(screen.getByText(/Created by/)).not.toHaveTextContent("last modified");
  });

  it("keeps the draft when its discard prompt is dismissed", async () => {
    mockedDrafts.getPageDraft.mockResolvedValue({
      id: "d1",
      page_id: "guides",
      content: "<p>x</p>",
      content_format: "html",
      edit_mode: "normal",
      base_updated_at: "2026-03-04T05:06:07Z",
      updated_at: "2026-03-05T00:00:00Z",
      is_conflict: false,
    });
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await screen.findByText("Draft not released");

    await actor.click(screen.getByRole("button", { name: "Discard draft" }));
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText("Draft not released")).toBeInTheDocument();
  });

  it("waits for a draft still being saved before discarding it on cancel", async () => {
    let finishSave: () => void = () => {};
    mockedDrafts.savePageDraft.mockImplementation(
      () => new Promise<never>((resolve) => (finishSave = () => resolve(undefined as never))),
    );
    const { actor } = renderWorkspace({ currentPage: GUIDES });
    await actor.click(pageEditButton());
    await actor.click(await screen.findByRole("menuitem", { name: "Normal editor" }));
    await actor.type(screen.getByLabelText("Rich editor"), "x");
    act(() => vi.advanceTimersByTime(700));
    await waitFor(() => expect(mockedDrafts.savePageDraft).toHaveBeenCalled());

    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(screen.getByRole("button", { name: "Leave without saving" }));
    expect(mockedDrafts.discardPageDraft).not.toHaveBeenCalled();
    await act(async () => finishSave());

    await waitFor(() => expect(mockedDrafts.discardPageDraft).toHaveBeenCalled());
  });

  it("stops the 'Saved' badge when auto-save is switched off, or the page is left", async () => {
    const { actor, view } = renderWorkspace({ currentPage: GUIDES });
    await actor.click(pageEditButton());
    await actor.click(await screen.findByRole("menuitem", { name: "Normal editor" }));
    await actor.type(screen.getByLabelText("Rich editor"), "a");
    await act(async () => vi.advanceTimersByTime(30_000));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Saved$/ })).toBeInTheDocument());

    await actor.click(screen.getByRole("button", { name: /^Saved$/ }));
    expect(screen.getByRole("button", { name: /^Auto-save$/ })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: /^Auto-save$/ }));

    await actor.type(screen.getByLabelText("Rich editor"), "b");
    await act(async () => vi.advanceTimersByTime(30_000));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Saved$/ })).toBeInTheDocument());
    view.unmount();
  });
});
