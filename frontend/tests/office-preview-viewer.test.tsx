import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Events = {
  onDocumentReady?: () => void;
  onError?: (event: { data?: { errorDescription?: string } }) => void;
};

const SERVER = "https://office.example.test/";

const m = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiFetch: m.apiFetch }));

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

async function mount(storageKey = "avatars/ada.docx") {
  const { OfficePreviewViewer } = await import("@/components/admin/office-preview-viewer");
  return render(<OfficePreviewViewer storageKey={storageKey} filename="ada.docx" />);
}

beforeEach(() => {
  vi.resetModules();
  scripts = [];
  editors = [];
  delete (window as unknown as { DocsAPI?: unknown }).DocsAPI;
  m.apiFetch.mockReset().mockResolvedValue({ config: { document: {}, events: {} } });
  vi.stubEnv("NEXT_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL", SERVER);
  vi.spyOn(document.head, "appendChild").mockImplementation(((node: Node) => {
    scripts.push(node as HTMLScriptElement);
    return node;
  }) as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OfficePreviewViewer", () => {
  it("says so when no document viewer is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL", "");
    await mount();

    expect(await screen.findByText("The document viewer is not configured.")).toBeInTheDocument();
    expect(m.apiFetch).not.toHaveBeenCalled();
  });

  it("asks for a view-only configuration of the stored object, then mounts the viewer", async () => {
    installDocsApi();
    await mount();

    await waitFor(() => expect(editors).toHaveLength(1));
    expect(m.apiFetch).toHaveBeenCalledWith(
      "/api/v1/storage/office-preview/config?key=avatars%2Fada.docx",
    );
    // The storage key is not a valid element id as it is.
    expect(editors[0]!.id).toBe("onlyoffice-preview-avatars_ada_docx");
    expect(screen.getByLabelText("Preview of ada.docx")).toHaveAttribute(
      "id",
      "onlyoffice-preview-avatars_ada_docx",
    );
    expect(screen.getByText("Loading preview…")).toBeInTheDocument();

    act(() => editors[0]!.config.events.onDocumentReady?.());
    expect(screen.queryByText("Loading preview…")).toBeNull();
  });

  it("shows an error the viewer reports, and a general one when it gives no details", async () => {
    installDocsApi();
    await mount();
    await waitFor(() => expect(editors).toHaveLength(1));

    act(() => editors[0]!.config.events.onError?.({ data: { errorDescription: "File is damaged." } }));
    expect(screen.getByText("File is damaged.")).toBeInTheDocument();
  });

  it("uses a general message when the viewer reports an error without details", async () => {
    installDocsApi();
    await mount();
    await waitFor(() => expect(editors).toHaveLength(1));

    act(() => editors[0]!.config.events.onError?.({}));
    expect(screen.getByText("The document viewer encountered an error.")).toBeInTheDocument();
  });

  it("shows why the preview could not be opened, or a general reason", async () => {
    m.apiFetch.mockRejectedValueOnce(new Error("Not allowed."));
    const first = await mount();
    expect(await screen.findByText("Not allowed.")).toBeInTheDocument();
    first.unmount();

    m.apiFetch.mockRejectedValueOnce("boom");
    await mount();
    expect(await screen.findByText("Could not open the document preview.")).toBeInTheDocument();
  });

  it("shuts the viewer down when it is removed, and ignores late events", async () => {
    installDocsApi();
    const { unmount } = await mount();
    await waitFor(() => expect(editors).toHaveLength(1));
    const { config, destroyEditor } = editors[0]!;

    unmount();

    expect(destroyEditor).toHaveBeenCalled();
    config.events.onDocumentReady?.();
    config.events.onError?.({});
  });

  it("loads the viewer script, and reports when it cannot be loaded", async () => {
    await mount();
    await waitFor(() => expect(scripts).toHaveLength(1));
    expect(scripts[0]!.src).toBe("https://office.example.test/web-apps/apps/api/documents/api.js");

    await act(async () => {
      scripts[0]!.onerror?.(new Event("error") as never);
    });

    expect(await screen.findByText("Could not load the document viewer.")).toBeInTheDocument();
  });

  it("reports a script that loaded without starting the viewer", async () => {
    await mount();
    await waitFor(() => expect(scripts).toHaveLength(1));

    await act(async () => {
      scripts[0]!.onload?.(new Event("load"));
    });

    expect(await screen.findByText("The document viewer did not initialize.")).toBeInTheDocument();
  });

  it("opens the viewer once the script has loaded", async () => {
    await mount();
    await waitFor(() => expect(scripts).toHaveLength(1));
    installDocsApi();

    await act(async () => {
      scripts[0]!.onload?.(new Event("load"));
    });

    await waitFor(() => expect(editors).toHaveLength(1));
  });
});
