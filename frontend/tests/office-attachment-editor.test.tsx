import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Events = {
  onDocumentReady?: () => void;
  onDocumentStateChange?: (event: { data?: boolean }) => void;
  onError?: (event: { data?: { errorDescription?: string } }) => void;
};

const SERVER = "https://office.example.test/";

let scripts: HTMLScriptElement[] = [];
let editors: { id: string; config: { events: Events }; destroyEditor: ReturnType<typeof vi.fn> }[] = [];

function installDocsApi() {
  (window as unknown as { DocsAPI?: unknown }).DocsAPI = {
    DocEditor: function (this: unknown, id: string, config: { events: Events }) {
      const editor = { id, config, destroyEditor: vi.fn() };
      editors.push(editor);
      return editor;
    },
  };
}

function stubConfig(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const spy = vi.fn(async () => response as Response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function mount(attachmentId = "att-1") {
  const { OfficeAttachmentEditor } = await import("@/components/pages/office-attachment-editor");
  return render(<OfficeAttachmentEditor attachmentId={attachmentId} filename="plan.docx" />);
}

beforeEach(() => {
  vi.resetModules();
  scripts = [];
  editors = [];
  delete (window as unknown as { DocsAPI?: unknown }).DocsAPI;
  vi.stubEnv("NEXT_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL", SERVER);
  vi.spyOn(document.head, "appendChild").mockImplementation(((node: Node) => {
    scripts.push(node as HTMLScriptElement);
    return node;
  }) as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const okConfig = () =>
  stubConfig({ ok: true, json: async () => ({ config: { document: {}, events: { onAppReady: vi.fn() } } }) });

describe("OfficeAttachmentEditor", () => {
  it("says so when the workspace has no document editor configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL", "");
    const fetchSpy = okConfig();
    await mount();

    expect(
      await screen.findByText("The workspace document editor is not configured."),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the editor cannot be opened", async () => {
    stubConfig({ ok: false, json: async () => ({ error: { message: "No access." } }) });
    await mount();

    expect(await screen.findByText("No access.")).toBeInTheDocument();
  });

  it("falls back to a general reason when the refusal is unreadable", async () => {
    stubConfig({
      ok: false,
      json: async () => {
        throw new Error("not json");
      },
    });
    await mount();

    expect(
      (await screen.findAllByText("Could not open the document editor.")).length,
    ).toBeGreaterThan(0);
  });

  it("falls back to a general reason when something other than an error is thrown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject("boom")));
    await mount();

    expect(
      (await screen.findAllByText("Could not open the document editor.")).length,
    ).toBeGreaterThan(0);
  });

  it("loads the editor script once, opens the document and follows its state", async () => {
    okConfig();
    await mount();
    await waitFor(() => expect(scripts).toHaveLength(1));
    expect(scripts[0]!.src).toBe(`${SERVER.replace(/\/+$/, "")}/web-apps/apps/api/documents/api.js`);

    installDocsApi();
    await act(async () => {
      scripts[0]!.onload?.(new Event("load"));
    });
    await waitFor(() => expect(editors).toHaveLength(1));
    expect(editors[0]!.id).toBe("onlyoffice-editor-att-1");
    expect(screen.getByText("Loading document editor…")).toBeInTheDocument();

    act(() => editors[0]!.config.events.onDocumentReady?.());
    expect(screen.getByText("plan.docx · Changes save automatically")).toBeInTheDocument();
    act(() => editors[0]!.config.events.onDocumentStateChange?.({ data: true }));
    expect(screen.getByText("Saving changes…")).toBeInTheDocument();
    act(() => editors[0]!.config.events.onDocumentStateChange?.({}));
    expect(screen.getByText("plan.docx · Changes save automatically")).toBeInTheDocument();
  });

  it("shows an error the editor reports, with its own words when it has them", async () => {
    okConfig();
    installDocsApi();
    await mount();
    await waitFor(() => expect(editors).toHaveLength(1));

    act(() => editors[0]!.config.events.onError?.({ data: { errorDescription: "File is locked." } }));
    expect(screen.getByText("File is locked.")).toBeInTheDocument();
  });

  it("uses a general message when the editor reports an error without details", async () => {
    okConfig();
    installDocsApi();
    await mount();
    await waitFor(() => expect(editors).toHaveLength(1));

    act(() => editors[0]!.config.events.onError?.({}));
    expect(screen.getByText("The document editor encountered an error.")).toBeInTheDocument();
  });

  it("shuts the editor down when it is removed, and ignores late events", async () => {
    okConfig();
    installDocsApi();
    const { unmount } = await mount();
    await waitFor(() => expect(editors).toHaveLength(1));
    const { config, destroyEditor } = editors[0]!;

    unmount();

    expect(destroyEditor).toHaveBeenCalled();
    config.events.onDocumentReady?.();
    config.events.onDocumentStateChange?.({ data: true });
    config.events.onError?.({});
  });

  it("reports a script that did not load, and one that loaded without the editor", async () => {
    okConfig();
    await mount();
    await waitFor(() => expect(scripts).toHaveLength(1));
    await act(async () => {
      scripts[0]!.onerror?.(new Event("error") as never);
    });
    expect(await screen.findByText("Could not load the document editor.")).toBeInTheDocument();
  });

  it("reports a script that loaded but did not start the editor", async () => {
    okConfig();
    await mount();
    await waitFor(() => expect(scripts).toHaveLength(1));
    await act(async () => {
      scripts[0]!.onload?.(new Event("load"));
    });
    expect(await screen.findByText("The document editor did not initialize.")).toBeInTheDocument();
  });

  it("shares one pending script between editors opened together", async () => {
    okConfig();
    const { OfficeAttachmentEditor } = await import("@/components/pages/office-attachment-editor");
    render(
      <>
        <OfficeAttachmentEditor attachmentId="a" filename="a.docx" />
        <OfficeAttachmentEditor attachmentId="b" filename="b.docx" />
      </>,
    );
    await waitFor(() => expect(scripts).toHaveLength(1));
    installDocsApi();
    await act(async () => {
      scripts[0]!.onload?.(new Event("load"));
    });

    await waitFor(() => expect(editors).toHaveLength(2));
    expect(scripts).toHaveLength(1);
  });
});
