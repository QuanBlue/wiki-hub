import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LikersPopover } from "@/components/comments/likers-popover";
import { IssueExportButton, issueExportUrl } from "@/components/issues/issue-export-button";
import { IssueScreenshots } from "@/components/issues/issue-screenshots";
import { PageLabelsDialog } from "@/components/pages/page-labels-dialog";
import { api } from "@/lib/api-client";
import type { IssueAttachment, PageLabel } from "@/types/api";

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/components/users/user-profile-trigger", () => ({
  UserProfileTrigger: ({ username }: { username: string }) => <span>{username}</span>,
}));

const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PageLabelsDialog", () => {
  const label = (id: string, name: string) => ({ id, name }) as PageLabel;

  function renderDialog(props: Partial<React.ComponentProps<typeof PageLabelsDialog>> = {}) {
    const onChange = vi.fn();
    render(
      <PageLabelsDialog spaceKey="ENG" slug="a b" open onOpenChange={vi.fn()} onChange={onChange} {...props} />,
    );
    return { onChange };
  }

  it("loads and lists the labels", async () => {
    mocked.get.mockResolvedValue([label("1", "urgent")]);
    const { onChange } = renderDialog();
    expect(screen.getByText("Loading labels...")).toBeInTheDocument();
    expect(await screen.findByText("urgent")).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/spaces/ENG/pages/a%20b/labels");
    expect(onChange).toHaveBeenCalledWith([label("1", "urgent")]);
  });

  it("says when there are none, and reports a load failure", async () => {
    mocked.get.mockResolvedValue([]);
    const first = render(
      <PageLabelsDialog spaceKey="ENG" slug="p" open onOpenChange={vi.fn()} onChange={vi.fn()} />,
    );
    expect(await screen.findByText("No labels yet.")).toBeInTheDocument();
    first.unmount();

    mocked.get.mockRejectedValue(new Error("x"));
    renderDialog();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not load page labels."));
  });

  it("adds a label with the button or Enter, ignoring blanks", async () => {
    mocked.get.mockResolvedValue([]);
    mocked.post.mockResolvedValueOnce(label("2", "draft")).mockResolvedValueOnce(label("3", "later"));
    const actor = userEvent.setup();
    const { onChange } = renderDialog();
    await screen.findByText("No labels yet.");

    const input = screen.getByPlaceholderText("Add a label");
    expect(screen.getByRole("button", { name: /Add/ })).toBeDisabled();
    await actor.type(input, "   {Enter}");
    expect(mocked.post).not.toHaveBeenCalled();

    await actor.type(input, " draft ");
    await actor.click(screen.getByRole("button", { name: /Add/ }));
    expect(await screen.findByText("draft")).toBeInTheDocument();
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/spaces/ENG/pages/a%20b/labels", { name: "draft" });
    expect(input).toHaveValue("");

    await actor.type(input, "later{Enter}");
    expect(await screen.findByText("later")).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith([label("2", "draft"), label("3", "later")]);
  });

  it("reports why adding or removing failed", async () => {
    mocked.get.mockResolvedValue([label("1", "urgent")]);
    mocked.post.mockRejectedValueOnce(new Error("Duplicate label")).mockRejectedValueOnce("odd");
    mocked.delete.mockRejectedValueOnce(new Error("Cannot remove")).mockRejectedValueOnce("odd");
    const actor = userEvent.setup();
    renderDialog();
    await screen.findByText("urgent");

    const input = screen.getByPlaceholderText("Add a label");
    await actor.type(input, "dup{Enter}");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Duplicate label"));
    await actor.type(input, "{Enter}");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not add label."));

    await actor.click(screen.getByRole("button", { name: "Remove urgent" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Cannot remove"));
    await actor.click(screen.getByRole("button", { name: "Remove urgent" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not remove label."));
  });

  it("removes a label", async () => {
    mocked.get.mockResolvedValue([label("1", "urgent")]);
    mocked.delete.mockResolvedValue(undefined);
    const actor = userEvent.setup();
    const { onChange } = renderDialog();
    await actor.click(await screen.findByRole("button", { name: "Remove urgent" }));
    await waitFor(() => expect(screen.queryByText("urgent")).not.toBeInTheDocument());
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/spaces/ENG/pages/a%20b/labels/1");
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("does nothing while closed", () => {
    renderDialog({ open: false });
    expect(mocked.get).not.toHaveBeenCalled();
  });
});

describe("LikersPopover", () => {
  const likers = [
    { id: "1", username: "ann", full_name: "Ann", avatar_url: null },
    { id: "2", username: "bob", full_name: "Bob", avatar_url: "/b.png" },
  ];

  it("shows a plain zero without a button", () => {
    render(<LikersPopover url="/likes" count={0} className="c" />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("fetches and lists who liked it each time it opens", async () => {
    mocked.get.mockResolvedValue(likers);
    const actor = userEvent.setup();
    render(<LikersPopover url="/likes" count={2} badge />);
    const trigger = screen.getByRole("button");
    await actor.click(trigger);
    expect(await screen.findByText("ann")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith("/likes");

    await actor.keyboard("{Escape}");
    await actor.click(trigger);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(2));
  });

  it("shows a spinner while loading and an error when it fails", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocked.get.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const actor = userEvent.setup();
    const view = render(<LikersPopover url="/likes" count={1} />);
    await actor.click(screen.getByRole("button"));
    expect(document.querySelector("svg.animate-spin")).not.toBeNull();
    resolve([]);
    view.unmount();

    mocked.get.mockRejectedValueOnce(new Error("x"));
    render(<LikersPopover url="/likes" count={1} />);
    await actor.click(screen.getByRole("button"));
    expect(await screen.findByText(/could not load|error/i)).toBeInTheDocument();
  });
});

describe("IssueScreenshots", () => {
  it("renders nothing without screenshots", () => {
    const { container } = render(<IssueScreenshots attachments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links each thumbnail to the full image", () => {
    render(
      <IssueScreenshots
        attachments={[{ id: "1", filename: "shot.png", content_url: "/img/1" } as IssueAttachment]}
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/img/1");
    expect(screen.getByAltText("shot.png")).toBeInTheDocument();
  });
});

describe("issue export", () => {
  it("builds the URL for one issue or several, per language", () => {
    expect(issueExportUrl(["a b"], "vi")).toBe(`${window.location.origin}/api/v1/issues/a%20b/export/docx?lang=vi`);
    expect(issueExportUrl(["1", "2"], "en")).toBe(
      `${window.location.origin}/api/v1/issues/export/docx?ids=1&ids=2&lang=en`,
    );
    expect(issueExportUrl(["1"], "fr")).toContain("lang=en");
  });

  it("downloads and says so", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<IssueExportButton issueIds={["1", "2"]} />);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("title", expect.stringMatching(/2/));
    await userEvent.click(button);
    expect(click).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("is disabled with nothing to export, or when asked", async () => {
    const first = render(<IssueExportButton issueIds={[]} />);
    expect(screen.getByRole("button")).toBeDisabled();
    first.unmount();
    render(<IssueExportButton issueIds={["1"]} disabled size="sm" variant="ghost" className="x" />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("does nothing if clicked with no issues", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { container } = render(<IssueExportButton issueIds={[]} />);
    const button = container.querySelector("button")!;
    button.disabled = false;
    button.click();
    expect(click).not.toHaveBeenCalled();
  });
});
