import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const SUMMARY_URL = "/api/v1/ai/spaces/ENG/pages/runbook/summary";

// The availability lookup is cached per page load, so every test starts from a
// fresh copy of the module.
async function setup(enabled: boolean, canConfigure = false) {
  vi.resetModules();
  const { api } = await import("@/lib/api-client");
  const { PageSummaryDialog } = await import("@/components/pages/page-summary-dialog");
  vi.mocked(api.get).mockResolvedValue({ enabled, can_configure: canConfigure });
  const onOpenChange = vi.fn();
  const view = render(
    <PageSummaryDialog
      open
      onOpenChange={onOpenChange}
      spaceKey="ENG"
      pageSlug="runbook"
      pageTitle="Runbook"
    />,
  );
  return { api, onOpenChange, view };
}

beforeEach(() => vi.clearAllMocks());

describe("PageSummaryDialog", () => {
  it("explains that the assistant isn't set up, as a warning, without calling the model", async () => {
    const { api } = await setup(false);

    expect(
      await screen.findByRole("heading", { name: "AI assistant isn't set up yet" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/administrator needs to connect/);
    expect(screen.queryByRole("link", { name: "Open AI settings" })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("sends an administrator to the AI settings when it is off", async () => {
    await setup(false, true);

    expect(await screen.findByRole("link", { name: "Open AI settings" })).toHaveAttribute(
      "href",
      "/admin/ai",
    );
  });

  it("asks for the summary as soon as it opens and renders the Markdown answer", async () => {
    vi.resetModules();
    const { api } = await import("@/lib/api-client");
    vi.mocked(api.post).mockResolvedValue({
      summary:
        "Intro with **snapshot id** and `crictl`.\n\n- Run `mount | grep <id>`\n- Then check:\n\n```\ncrictl inspect <id>\n```",
      cached: true,
      too_short: false,
    });
    await setup(true);

    const dialog = await screen.findByRole("dialog");
    expect((await within(dialog).findByText("snapshot id")).tagName).toBe("STRONG");
    expect(within(dialog).getByText("mount | grep <id>").tagName).toBe("CODE");
    expect(within(dialog).getByText("crictl inspect <id>").closest("pre")).not.toBeNull();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
    // No backtick or asterisk markup is left on screen.
    expect(dialog.textContent).not.toMatch(/\*\*|`/);
    expect(within(dialog).getByText(/Saved summary/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith(SUMMARY_URL);
  });

  it("opens a file's viewer on top of the summary, which stays open underneath", async () => {
    vi.resetModules();
    const { api } = await import("@/lib/api-client");
    const fileId = "11111111-1111-4111-8111-111111111111";
    vi.mocked(api.post).mockResolvedValue({
      summary: "- Slides are in **VTS_DevSecOps_CICD_v1.pptx**.\n- Other files: other.pdf",
      cached: false,
      too_short: false,
      attachments: [
        { id: fileId, filename: "VTS_DevSecOps_CICD_v1.pptx", content_type: "application/vnd.ms-powerpoint" },
      ],
    });
    const heard = vi.fn();
    window.addEventListener("wikihub:open-attachment-modal", heard);
    const { onOpenChange } = await setup(true);

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: "VTS_DevSecOps_CICD_v1.pptx" }));

    expect(heard).toHaveBeenCalledTimes(1);
    expect((heard.mock.calls[0]![0] as CustomEvent).detail).toEqual({ attachmentId: fileId });
    // The summary is not closed, so the viewer sits over it.
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    window.removeEventListener("wikihub:open-attachment-modal", heard);
  });

  it("makes a web address in the summary a link that opens in a new tab", async () => {
    vi.resetModules();
    const { api } = await import("@/lib/api-client");
    vi.mocked(api.post).mockResolvedValue({
      summary: "- Docs: http://tailieu.gpdn.net/pages/viewpage.action?pageId=20092480.",
      cached: false,
      too_short: false,
      attachments: [],
    });
    await setup(true);

    const link = await screen.findByRole("link", { name: /tailieu\.gpdn\.net/ });
    expect(link).toHaveAttribute("href", "http://tailieu.gpdn.net/pages/viewpage.action?pageId=20092480");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("starts in the page's own language and switches the summary when asked", async () => {
    vi.resetModules();
    const { api } = await import("@/lib/api-client");
    vi.mocked(api.post).mockImplementation(async (path: string) => ({
      summary: path.includes("lang=vi") ? "- Bản tiếng Việt" : "- Original",
      cached: false,
      too_short: false,
      attachments: [],
    }));
    await setup(true);

    const group = await screen.findByRole("radiogroup", { name: "Summary language" });
    expect(within(group).getByRole("radio", { name: "Page language" })).toBeChecked();
    expect(await screen.findByText("Original")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith(SUMMARY_URL); // no language asked for

    await userEvent.click(within(group).getByRole("radio", { name: "Tiếng Việt" }));

    expect(await screen.findByText("Bản tiếng Việt")).toBeInTheDocument();
    expect(api.post).toHaveBeenLastCalledWith(`${SUMMARY_URL}?lang=vi`);
    expect(within(group).getByRole("radio", { name: "Tiếng Việt" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Page language" })).not.toBeChecked();

    await userEvent.click(within(group).getByRole("radio", { name: "English" }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith(`${SUMMARY_URL}?lang=en`));

    // Back to the page's own language asks for no language at all.
    await userEvent.click(within(group).getByRole("radio", { name: "Page language" }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith(SUMMARY_URL));
  });

  it("keeps the current summary on screen, dimmed, while another language loads", async () => {
    vi.resetModules();
    const { api } = await import("@/lib/api-client");
    let finish!: (value: unknown) => void;
    vi.mocked(api.post)
      .mockResolvedValueOnce({ summary: "- Original", cached: false, too_short: false })
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)) as never);
    await setup(true);
    await screen.findByText("Original");

    await userEvent.click(screen.getByRole("radio", { name: "English" }));

    // Nothing is swapped for a bare loading line, so the dialog keeps its size.
    expect(screen.getByText("Original")).toBeInTheDocument();
    expect(screen.getByText("Summarizing…")).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("[aria-busy='true']")).not.toBeNull();

    finish({ summary: "- Translated", cached: false, too_short: false });
    expect(await screen.findByText("Translated")).toBeInTheDocument();
    expect(screen.queryByText("Original")).toBeNull();
    expect(screen.queryByText("Summarizing…")).toBeNull();
  });

  it("keeps the chosen language when the summary is asked for again", async () => {
    vi.resetModules();
    const { api } = await import("@/lib/api-client");
    vi.mocked(api.post).mockResolvedValue({ summary: "- A", cached: false, too_short: false });
    await setup(true);

    await screen.findByText("A");
    await userEvent.click(screen.getByRole("radio", { name: "English" }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith(`${SUMMARY_URL}?lang=en`));
    await userEvent.click(await screen.findByRole("button", { name: "Summarize again" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenLastCalledWith(`${SUMMARY_URL}?lang=en&refresh=true`),
    );
  });

  it("offers no language switch while the assistant isn't set up", async () => {
    await setup(false);

    await screen.findByRole("heading", { name: "AI assistant isn't set up yet" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("keeps the 'can miss details' caveat behind an info button", async () => {
    const { api } = await setup(true);
    vi.mocked(api.post).mockResolvedValue({ summary: "- A", cached: false, too_short: false });

    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("A");
    expect(within(dialog).queryByText(/It can miss details/)).toBeNull();
    expect(within(dialog).getAllByRole("button", { name: "More info" })).toHaveLength(1);
  });

  it("does not pop the info tooltip open just because the dialog opened", async () => {
    const { api } = await setup(true);
    vi.mocked(api.post).mockResolvedValue({ summary: "- A", cached: false, too_short: false });

    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("A");

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "More info" })).not.toHaveFocus();
    expect(dialog).toHaveFocus();
  });

  it("asks for a fresh summary when told to summarize again", async () => {
    vi.resetModules();
    const { api } = await import("@/lib/api-client");
    vi.mocked(api.post).mockResolvedValue({ summary: "- A", cached: false, too_short: false });
    await setup(true);

    await screen.findByText("A");
    await userEvent.click(screen.getByRole("button", { name: "Summarize again" }));

    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith(`${SUMMARY_URL}?refresh=true`));
  });

  it("explains a page that is too short instead of showing an empty list", async () => {
    vi.resetModules();
    const { api } = await import("@/lib/api-client");
    vi.mocked(api.post).mockResolvedValue({ summary: "", cached: false, too_short: true });
    await setup(true);

    expect(await screen.findByText(/too little text/)).toBeInTheDocument();
  });

  it("reports a failure without closing the dialog", async () => {
    vi.resetModules();
    const { api } = await import("@/lib/api-client");
    vi.mocked(api.post).mockRejectedValue(new Error("down"));
    await setup(true);

    expect(await screen.findByText(/couldn't summarize/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes from the Close button", async () => {
    const { onOpenChange } = await setup(false);

    // The corner "x" and the footer button share a name; use the footer one.
    const closers = await screen.findAllByRole("button", { name: "Close" });
    await userEvent.click(closers[closers.length - 1]!);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
