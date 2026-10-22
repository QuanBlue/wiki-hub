import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { SemanticSearchPanel } from "@/components/admin/semantic-search-panel";
import type {
  TuningSpec,
  EmbeddingModelsResult,
  EmbeddingSettings,
  OllamaStatus,
  SearchIndexStatus,
} from "@/lib/admin-ai";
import { api } from "@/lib/api-client";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const MODELS = "/api/v1/ai/embedding/models";

const SPECS: TuningSpec[] = [
  {
    key: "index_batch",
    label: "Pages per minute",
    default: 20,
    minimum: 1,
    maximum: 500,
    kind: "int",
    choices: [],
    ollama_only: false,
    restart: false,
  },
  {
    key: "embed_batch_size",
    label: "Passages per request",
    default: 16,
    minimum: 1,
    maximum: 128,
    kind: "int",
    choices: [],
    ollama_only: false,
    restart: false,
  },
  {
    key: "max_chunks_per_page",
    label: "Passages per page",
    default: 60,
    minimum: 1,
    maximum: 400,
    kind: "int",
    choices: [],
    ollama_only: false,
    restart: false,
  },
  {
    key: "embed_timeout_seconds",
    label: "Embedding timeout (seconds)",
    default: 180,
    minimum: 5,
    maximum: 1800,
    kind: "float",
    choices: [],
    ollama_only: false,
    restart: false,
  },
  {
    key: "query_timeout_seconds",
    label: "Search embedding timeout (seconds)",
    default: 4,
    minimum: 0.5,
    maximum: 60,
    kind: "float",
    choices: [],
    ollama_only: false,
    restart: false,
  },
  {
    key: "min_similarity",
    label: "Minimum similarity",
    default: 0.3,
    minimum: 0,
    maximum: 0.99,
    kind: "float",
    choices: [],
    ollama_only: false,
    restart: false,
  },
  {
    key: "margin",
    label: "Margin",
    default: 0.1,
    minimum: 0,
    maximum: 1,
    kind: "float",
    choices: [],
    ollama_only: false,
    restart: false,
  },
  {
    key: "ollama_memory_gb",
    label: "Ollama memory limit",
    default: 3,
    minimum: 1,
    maximum: 256,
    kind: "float",
    choices: [],
    ollama_only: true,
    restart: true,
  },
  {
    key: "ollama_cpus",
    label: "Ollama CPU cores",
    default: 0,
    minimum: 0,
    maximum: 256,
    kind: "int",
    choices: [],
    ollama_only: true,
    restart: true,
  },
  {
    key: "ollama_keep_alive",
    label: "Keep alive",
    default: "5m",
    minimum: null,
    maximum: null,
    kind: "choice",
    choices: ["0", "1m", "5m", "10m", "30m", "1h", "-1"],
    ollama_only: true,
    restart: true,
  },
];

const NO_OVERRIDES: Record<string, number | string | null> = Object.fromEntries(
  SPECS.map((s) => [s.key, null]),
);

function settings(over: Partial<EmbeddingSettings> = {}): EmbeddingSettings {
  return {
    source: "provider",
    base_url: "",
    api_key_preview: "",
    has_key: false,
    model: "",
    tuning: { ...NO_OVERRIDES },
    effective: Object.fromEntries(SPECS.map((s) => [s.key, s.default])),
    specs: SPECS,
    ...over,
  };
}

function ollama(over: Partial<OllamaStatus> = {}): OllamaStatus {
  return {
    state: "not_installed",
    controller_ok: true,
    docker_ok: true,
    image: "ollama/ollama:0.40.4",
    image_bytes: 0,
    memory_bytes: null,
    memory_limit: "3g",
    volume_present: false,
    models: [],
    available_models: [{ name: "bge-m3", note: "multilingual" }],
    host_cpus: 12,
    applied_memory_mb: null,
    applied_cpus: null,
    applied_keep_alive: null,
    restart_needed: false,
    step: "",
    model: "",
    percent: 0,
    overall: 0,
    message: "",
    current: 0,
    total: 0,
    error: "",
    ...over,
  };
}

function index(over: Partial<SearchIndexStatus> = {}): SearchIndexStatus {
  return {
    available: true,
    enabled: true,
    total: 200,
    indexed: 200,
    error: null,
    ...over,
  };
}

function models(ids: string[]): EmbeddingModelsResult {
  return {
    ok: true,
    models: ids.map((id) => ({
      id,
      name: id,
      reasoning: false,
      image: false,
      embedding: true,
    })),
    error: null,
  };
}

/** Answer each request by its path. */
function serve(routes: {
  ollama?: OllamaStatus;
  index?: SearchIndexStatus;
  models?: EmbeddingModelsResult;
}) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === "/api/v1/ai/ollama") return routes.ollama ?? ollama();
    if (path === "/api/v1/ai/search-index") return routes.index ?? index();
    throw new Error(`unexpected GET ${path}`);
  });
  vi.mocked(api.post).mockImplementation(async (path: string) => {
    if (path === MODELS) return routes.models ?? models([]);
    throw new Error(`unexpected POST ${path}`);
  });
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.put).mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

async function pickModel(name: string | RegExp) {
  await userEvent.click(
    screen.getByRole("button", { name: "Embedding model" }),
  );
  await userEvent.click(await screen.findByRole("menuitemradio", { name }));
}

describe("SemanticSearchPanel with the active provider", () => {
  it("lists only the provider's embedding models and saves the one picked", async () => {
    serve({ models: models(["x/bge-m3"]) });
    vi.mocked(api.put).mockResolvedValue(settings({ model: "x/bge-m3" }));
    render(<SemanticSearchPanel initial={settings()} />);

    expect(screen.getByText(/Semantic search is off/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(MODELS, {
        source: "provider",
        base_url: "",
        api_key: "",
      }),
    );

    await pickModel("x/bge-m3");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/v1/ai/embedding", {
        source: "provider",
        base_url: "",
        model: "x/bge-m3",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Semantic search settings saved.",
    );
    // Saved: nothing left to save.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(),
    );
  });

  it("says so when the provider offers no embedding model", async () => {
    serve({ models: models([]) });
    render(<SemanticSearchPanel initial={settings()} />);

    expect(
      await screen.findByText(/lists no embedding models/),
    ).toBeInTheDocument();
  });

  it("shows why it cannot list the models, e.g. no provider is switched on", async () => {
    vi.mocked(api.get).mockResolvedValue(index());
    vi.mocked(api.post).mockResolvedValue({
      ok: false,
      models: [],
      error: "Switch on an AI provider first.",
    });
    render(<SemanticSearchPanel initial={settings()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Switch on an AI provider first.",
    );
  });

  it("clears a saved model the source does not offer as an embedding model, and says so", async () => {
    serve({ models: models(["x/bge-m3"]), index: index() });
    vi.mocked(api.put).mockResolvedValue(settings());
    render(<SemanticSearchPanel initial={settings({ model: "chat/glm" })} />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /“chat\/glm” is not an embedding model/,
    );
    expect(
      screen.getByRole("button", { name: "Embedding model" }),
    ).toHaveTextContent("Off - keyword search only");
    // The cleared state differs from what is saved, so it can be saved.
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/api/v1/ai/embedding",
        expect.objectContaining({ model: "" }),
      ),
    );
  });

  it("reports a failed save", async () => {
    serve({ models: models(["x/bge-m3"]) });
    vi.mocked(api.put).mockRejectedValue(
      new Error("This endpoint cannot create embeddings"),
    );
    render(<SemanticSearchPanel initial={settings()} />);
    await waitFor(() => expect(api.post).toHaveBeenCalled());

    await pickModel("x/bge-m3");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("SemanticSearchPanel with another endpoint", () => {
  it("needs an address and a key before the models can be fetched, then saves them with the model", async () => {
    serve({ models: models(["bge-m3"]) });
    vi.mocked(api.put).mockResolvedValue(
      settings({
        source: "custom",
        base_url: "http://embed.test/v1",
        has_key: true,
        api_key_preview: "sk-x****",
        model: "bge-m3",
      }),
    );
    render(<SemanticSearchPanel initial={settings()} />);

    await userEvent.click(
      screen.getByRole("radio", { name: /Another endpoint/ }),
    );
    const fetch = screen.getByRole("button", { name: "Fetch models" });
    expect(fetch).toBeDisabled();
    expect(
      screen.getByText("Enter the address and key, then fetch the models."),
    ).toBeInTheDocument();

    await userEvent.type(
      screen.getByLabelText("Endpoint address"),
      "http://embed.test/v1",
    );
    await userEvent.type(screen.getByLabelText("API key"), "sk-secret-key");
    await userEvent.click(fetch);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(MODELS, {
        source: "custom",
        base_url: "http://embed.test/v1",
        api_key: "sk-secret-key",
      }),
    );

    await pickModel("bge-m3");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/v1/ai/embedding", {
        source: "custom",
        base_url: "http://embed.test/v1",
        api_key: "sk-secret-key",
        model: "bge-m3",
      }),
    );
  });

  it("keeps the saved key when none is typed", async () => {
    serve({ models: models(["bge-m3", "other-embed"]) });
    vi.mocked(api.put).mockResolvedValue(
      settings({
        source: "custom",
        base_url: "http://e.test/v1",
        has_key: true,
        model: "other-embed",
      }),
    );
    render(
      <SemanticSearchPanel
        initial={settings({
          source: "custom",
          base_url: "http://e.test/v1",
          has_key: true,
          api_key_preview: "sk-adc****297a",
          model: "bge-m3",
        })}
      />,
    );

    expect(
      screen.getByText("Leave blank to keep the saved key (sk-adc****297a)."),
    ).toBeInTheDocument();
    // A saved endpoint lists its models on open, using the saved key (none is sent).
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(MODELS, {
        source: "custom",
        base_url: "http://e.test/v1",
        api_key: "",
      }),
    );

    await pickModel("other-embed");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const body = vi.mocked(api.put).mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(body).toEqual({
      source: "custom",
      base_url: "http://e.test/v1",
      model: "other-embed",
    });
    expect(body).not.toHaveProperty("api_key");
  });
});

describe("SemanticSearchPanel with the self-hosted Ollama", () => {
  it("shows the Ollama card, with nothing to pick until it is running", async () => {
    serve({ ollama: ollama() });
    render(<SemanticSearchPanel initial={settings()} />);

    await userEvent.click(
      screen.getByRole("radio", { name: /Self-hosted \(Ollama\)/ }),
    );

    expect(await screen.findByText("Self-hosted Ollama")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Enable and download" }),
    ).toBeInTheDocument();
    // The search model is chosen inside the Ollama card once it runs; until then there is no second picker.
    expect(
      screen.queryByRole("button", { name: "Embedding model" }),
    ).toBeNull();
    // Ollama's models are not asked for while it is off.
    expect(api.post).not.toHaveBeenCalledWith(
      MODELS,
      expect.objectContaining({ source: "ollama" }),
    );
  });

  it("lists what Ollama has downloaded once it runs, and saves the choice", async () => {
    serve({
      ollama: ollama({ state: "running", models: ["bge-m3:latest"] }),
      models: models(["bge-m3:latest"]),
    });
    vi.mocked(api.put).mockResolvedValue(
      settings({ source: "ollama", model: "bge-m3:latest" }),
    );
    render(<SemanticSearchPanel initial={settings({ source: "ollama" })} />);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(MODELS, {
        source: "ollama",
        base_url: "",
        api_key: "",
      }),
    );
    await pickModel(/^bge-m3:latest/);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/v1/ai/embedding", {
        source: "ollama",
        base_url: "",
        model: "bge-m3:latest",
      }),
    );
  });

  it("marks each model in the list as downloaded or not, and explains it on hover", async () => {
    serve({
      ollama: ollama({
        state: "running",
        models: ["bge-m3:latest"],
        available_models: [
          { name: "bge-m3", note: "multilingual" },
          { name: "nomic-embed-text", note: "English" },
        ],
      }),
      models: models(["bge-m3:latest"]),
    });
    render(<SemanticSearchPanel initial={settings({ source: "ollama" })} />);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(MODELS, expect.anything()),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Embedding model" }),
    );
    const downloaded = await screen.findByRole("menuitemradio", {
      name: /^bge-m3:latest/,
    });
    expect(within(downloaded).getByText("downloaded")).toBeInTheDocument();
    const missing = screen.getByRole("menuitemradio", {
      name: /^nomic-embed-text/,
    });
    expect(within(missing).getByText("not downloaded")).toBeInTheDocument();

    await userEvent.hover(within(downloaded).getByLabelText("More info"));
    expect(
      (
        await screen.findAllByText(
          /Best choice for a wiki written in Vietnamese/,
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it("offers models not downloaded yet in the same list, and downloads then saves the pick", async () => {
    serve({ ollama: ollama({ state: "running" }), models: models([]) });
    vi.mocked(api.post).mockImplementation(async (path: string) => {
      if (path === MODELS) return models([]);
      if (path === "/api/v1/ai/ollama/enable")
        return ollama({ state: "running", models: ["bge-m3:latest"] });
      throw new Error(`unexpected POST ${path}`);
    });
    vi.mocked(api.put).mockResolvedValue(
      settings({ source: "ollama", model: "bge-m3" }),
    );
    render(<SemanticSearchPanel initial={settings({ source: "ollama" })} />);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(MODELS, expect.anything()),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Embedding model" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitemradio", {
        name: /bge-m3.*not downloaded/,
      }),
    );
    expect(screen.getByText(/Not downloaded yet/)).toBeInTheDocument();
    // The download button sits in the model field, inside the Ollama card; the form's own Save waits.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Download & use" }),
    );

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/ai/ollama/enable", {
        model: "bge-m3",
      }),
    );
    // Once Ollama reports the model as there, the choice is saved without another click.
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/v1/ai/embedding", {
        source: "ollama",
        base_url: "",
        model: "bge-m3",
      }),
    );
  });

  it("says Ollama has no embedding model yet when it runs empty", async () => {
    serve({
      ollama: ollama({ state: "running", available_models: [] }),
      models: models([]),
    });
    render(<SemanticSearchPanel initial={settings({ source: "ollama" })} />);

    expect(
      await screen.findByText("Ollama has no embedding model downloaded yet."),
    ).toBeInTheDocument();
  });
});

describe("SemanticSearchPanel indexing status", () => {
  it("says semantic search is ready when everything is indexed", async () => {
    serve({
      index: index({ total: 200, indexed: 200 }),
      models: models(["m"]),
    });
    render(<SemanticSearchPanel initial={settings({ model: "m" })} />);

    expect(
      await screen.findByText(
        "Semantic search is ready - all 200 pages are indexed.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a progress bar while pages are being indexed", async () => {
    serve({ index: index({ total: 200, indexed: 50 }), models: models(["m"]) });
    render(<SemanticSearchPanel initial={settings({ model: "m" })} />);

    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("50/200 (25%)")).toBeInTheDocument();
  });

  it("counts the attached files whose words were read", async () => {
    serve({
      index: index({
        total: 200,
        indexed: 200,
        files_read: 12,
        files_waiting: 3,
      }),
      models: models(["m"]),
    });
    render(<SemanticSearchPanel initial={settings({ model: "m" })} />);
    expect(
      await screen.findByText("Attached files: 12 read, 3 waiting"),
    ).toBeInTheDocument();
  });

  it("says roughly how long the rest will take, and not while paused", async () => {
    serve({
      index: index({ total: 200, indexed: 50, eta_seconds: 4500 }),
      models: models(["m"]),
    });
    const { unmount } = render(
      <SemanticSearchPanel initial={settings({ model: "m" })} />,
    );
    expect(
      await screen.findByText("· about 1 h 15 min left"),
    ).toBeInTheDocument();
    unmount();

    serve({
      index: index({
        total: 200,
        indexed: 50,
        eta_seconds: 4500,
        paused: true,
      }),
      models: models(["m"]),
    });
    render(<SemanticSearchPanel initial={settings({ model: "m" })} />);
    await screen.findByText("Indexing is paused.");
    expect(screen.queryByText(/min left/)).not.toBeInTheDocument();
  });

  it("keeps the indexing note current while paused, without a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      serve({
        index: index({ total: 3003, indexed: 3000, paused: true }),
        models: models(["m"]),
      });
      render(<SemanticSearchPanel initial={settings({ model: "m" })} />);
      expect(
        await screen.findByText("Indexing is paused."),
      ).toBeInTheDocument();

      // Pages were added meanwhile: the note shows them within a minute.
      serve({
        index: index({ total: 3010, indexed: 3003, paused: true }),
        models: models(["m"]),
      });
      await vi.advanceTimersByTimeAsync(61_000);
      expect(await screen.findByText("3003/3010 (99%)")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses indexing to free the server, and resumes it", async () => {
    serve({ index: index({ total: 200, indexed: 50 }), models: models(["m"]) });
    vi.mocked(api.put).mockImplementation(
      async (_path: string, body?: unknown) =>
        index({
          total: 200,
          indexed: 50,
          paused: (body as { paused: boolean }).paused,
        }),
    );
    render(<SemanticSearchPanel initial={settings({ model: "m" })} />);

    await userEvent.click(await screen.findByRole("button", { name: "Pause" }));

    expect(api.put).toHaveBeenCalledWith("/api/v1/ai/search-index/pause", {
      paused: true,
    });
    expect(await screen.findByText("Indexing is paused.")).toBeInTheDocument();
    expect(
      screen.getByText(/Pages already indexed are still found/),
    ).toBeInTheDocument();
    expect(screen.getByText("50/200 (25%)")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(api.put).toHaveBeenLastCalledWith("/api/v1/ai/search-index/pause", {
      paused: false,
    });
    expect(
      await screen.findByText("Indexing pages for semantic search…"),
    ).toBeInTheDocument();
  });

  it("opens on a paused index with a Resume button", async () => {
    serve({
      index: index({ total: 200, indexed: 80, paused: true }),
      models: models(["m"]),
    });
    render(<SemanticSearchPanel initial={settings({ model: "m" })} />);

    expect(
      await screen.findByRole("button", { name: "Resume" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pause" }),
    ).not.toBeInTheDocument();
  });

  it("says when pausing fails, and leaves things as they were", async () => {
    serve({ index: index({ total: 200, indexed: 50 }), models: models(["m"]) });
    vi.mocked(api.put).mockRejectedValue(new Error("down"));
    render(<SemanticSearchPanel initial={settings({ model: "m" })} />);

    await userEvent.click(await screen.findByRole("button", { name: "Pause" }));

    expect(toast.error).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("explains why indexing stopped, in words, with the reason and a way to fix it", async () => {
    serve({
      index: index({
        indexed: 0,
        error: "Could not create embeddings (HTTP 404).",
      }),
      models: models(["m"]),
    });
    render(<SemanticSearchPanel initial={settings({ model: "m" })} />);

    const alert = within(await screen.findByRole("alert"));
    expect(
      alert.getByText("Semantic search can't index pages yet"),
    ).toBeInTheDocument();
    expect(
      alert.getByText(/doesn't support embeddings with this model/),
    ).toBeInTheDocument();
    expect(
      alert.getByText("Could not create embeddings (HTTP 404)"),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Change embedding model" }),
    );
    expect(
      screen.getByRole("button", { name: "Embedding model" }),
    ).toHaveFocus();
  });

  it.each([
    ["Could not create embeddings (HTTP 401).", /rejected the API key/],
    ["Could not create embeddings (HTTP 503).", /busy or unreachable/],
    ["Could not create embeddings (ConnectError).", /busy or unreachable/],
    ["Something else.", /could not create embeddings/],
  ])("words the error for %s", async (error, expected) => {
    serve({ index: index({ indexed: 0, error }), models: models(["m"]) });
    render(<SemanticSearchPanel initial={settings({ model: "m" })} />);

    expect(
      await within(await screen.findByRole("alert")).findByText(expected),
    ).toBeInTheDocument();
  });

  it("says when the database has no pgvector", async () => {
    serve({
      index: index({ available: false, indexed: 0 }),
      models: models(["m"]),
    });
    render(<SemanticSearchPanel initial={settings({ model: "m" })} />);

    expect(
      await screen.findByText(/needs the pgvector database extension/),
    ).toBeInTheDocument();
  });
});

describe("SemanticSearchPanel while its tab is hidden", () => {
  it("does nothing until it is shown", async () => {
    serve({ models: models(["m"]) });
    const { rerender } = render(
      <SemanticSearchPanel initial={settings()} visible={false} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.post).not.toHaveBeenCalled();

    rerender(<SemanticSearchPanel initial={settings()} visible />);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
  });
});

describe("SemanticSearchPanel tuning", () => {
  it("keeps the knobs in a collapsed section, with defaults as placeholders", async () => {
    serve({ models: models([]) });
    render(<SemanticSearchPanel initial={settings()} />);

    expect(screen.getByText("Performance & tuning")).toBeInTheDocument();
    expect(screen.getByLabelText("Pages per minute")).toHaveAttribute(
      "placeholder",
      "Default: 20",
    );
    expect(screen.getByLabelText("Minimum similarity")).toHaveAttribute(
      "placeholder",
      "Default: 0.3",
    );
    expect(
      screen.getByLabelText("Margin below the best match"),
    ).toHaveAttribute("placeholder", "Default: 0.1");
    // The Ollama knobs only exist for the Ollama source.
    expect(screen.queryByLabelText("Ollama memory limit")).toBeNull();
  });

  it("shows the Ollama knobs only for the self-hosted source", async () => {
    serve({ ollama: ollama(), models: models([]) });
    render(<SemanticSearchPanel initial={settings()} />);

    await userEvent.click(
      screen.getByRole("radio", { name: /Self-hosted \(Ollama\)/ }),
    );
    expect(
      await screen.findByLabelText("Ollama memory limit"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Ollama CPU cores")).toHaveAttribute(
      "placeholder",
      "Default: all cores",
    );
    expect(
      screen.getByText("Applies after Ollama restarts"),
    ).toBeInTheDocument();
    // Choice knobs are a dropdown of the fixed times.
    await userEvent.click(
      screen.getByRole("button", { name: "Keep the model loaded for" }),
    );
    expect(
      await screen.findByRole("menuitemradio", { name: "30 minutes" }),
    ).toBeInTheDocument();
  });

  it("saves only what was changed, and resets a knob to its default with null", async () => {
    serve({ models: models([]) });
    vi.mocked(api.put).mockResolvedValue(
      settings({ tuning: { ...NO_OVERRIDES, index_batch: 5, margin: 0.2 } }),
    );
    render(<SemanticSearchPanel initial={settings()} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Pages per minute"), "5");
    await userEvent.type(
      screen.getByLabelText("Margin below the best match"),
      "0.2",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/v1/ai/embedding", {
        source: "provider",
        base_url: "",
        model: "",
        tuning: { index_batch: 5, margin: 0.2 },
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Pages per minute")).toHaveValue("5"),
    );

    vi.mocked(api.put).mockResolvedValue(
      settings({ tuning: { ...NO_OVERRIDES, margin: 0.2 } }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Reset Pages per minute to its default",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(vi.mocked(api.put).mock.calls.at(-1)![1]).toEqual({
        source: "provider",
        base_url: "",
        model: "",
        tuning: { index_batch: null },
      }),
    );
  });

  it("refuses an out-of-range or non-numeric value before it is sent", async () => {
    serve({ models: models([]) });
    render(<SemanticSearchPanel initial={settings()} />);
    const field = screen.getByLabelText("Pages per minute");

    await userEvent.type(field, "9999");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a value from 1 to 500.",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, "2.5");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a whole number.",
    );

    await userEvent.clear(field);
    await userEvent.type(field, "abc");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number.");

    await userEvent.clear(field);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("times a few passages and says how long indexing would take", async () => {
    serve({ models: models(["m"]) });
    vi.mocked(api.post).mockImplementation(async (path: string) => {
      if (path === "/api/v1/ai/embedding/benchmark") {
        return {
          ok: true,
          error: null,
          passages: 8,
          characters: 5600,
          seconds: 3.2,
          seconds_per_passage: 0.4,
          batch_size: 16,
          estimated_minutes_per_100_pages: 3.3,
        };
      }
      return models(["m"]);
    });
    render(<SemanticSearchPanel initial={settings({ model: "m" })} />);

    await userEvent.click(screen.getByRole("button", { name: "Test speed" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "8 passages in 3.2 s (0.4 s each, 16 per request). Indexing 100 pages of about 5 passages would take roughly 3.3 min.",
    );
  });

  it("needs a saved model before the speed test, and says what went wrong when it fails", async () => {
    serve({ models: models([]) });
    const { unmount } = render(<SemanticSearchPanel initial={settings()} />);
    expect(screen.getByRole("button", { name: "Test speed" })).toBeDisabled();
    expect(
      screen.getByText("Save an embedding model first, then test its speed."),
    ).toBeInTheDocument();
    unmount();

    vi.mocked(api.post).mockImplementation(async (path: string) => {
      if (path === "/api/v1/ai/embedding/benchmark") {
        return {
          ok: false,
          error: "Could not create embeddings (HTTP 500).",
          passages: 0,
          characters: 0,
          seconds: 0,
          seconds_per_passage: 0,
          batch_size: 0,
          estimated_minutes_per_100_pages: 0,
        };
      }
      return models(["m"]);
    });
    render(<SemanticSearchPanel initial={settings({ model: "m" })} />);
    await userEvent.click(screen.getByRole("button", { name: "Test speed" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not create embeddings (HTTP 500).",
    );
  });
});

describe("SemanticSearchPanel when things go wrong", () => {
  it("shows nothing about indexing when the status cannot be read", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/api/v1/ai/search-index") throw new Error("down");
      throw new Error(`unexpected GET ${path}`);
    });
    vi.mocked(api.post).mockResolvedValue(models([]));
    render(
      <SemanticSearchPanel
        initial={settings({ source: "provider", model: "x/bge-m3" })}
      />,
    );

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/api/v1/ai/search-index"),
    );
    expect(screen.queryByText(/pages are ready/i)).toBeNull();
  });

  it("asks for the indexing status again when the tab is shown again", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/api/v1/ai/search-index") return index();
      return ollama();
    });
    vi.mocked(api.post).mockResolvedValue(models([]));
    render(
      <SemanticSearchPanel
        initial={settings({ source: "provider", model: "x/bge-m3" })}
      />,
    );
    const asked = () =>
      vi
        .mocked(api.get)
        .mock.calls.filter(([path]) => path === "/api/v1/ai/search-index")
        .length;
    await waitFor(() => expect(asked()).toBeGreaterThan(0));
    const before = asked();

    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(asked()).toBeGreaterThan(before));
  });

  it("says why the models could not be listed when the request itself fails", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/api/v1/ai/search-index") return index();
      return ollama();
    });
    vi.mocked(api.post).mockRejectedValue(new Error("Network down"));
    render(<SemanticSearchPanel initial={settings()} />);

    expect(
      await screen.findByText(/Network down|could not|fetch/i),
    ).toBeInTheDocument();
  });

  it("reports a download that could not be started", async () => {
    serve({ ollama: ollama({ state: "running" }), models: models([]) });
    vi.mocked(api.post).mockImplementation(async (path: string) => {
      if (path === MODELS) return models([]);
      throw new Error("The controller is not reachable.");
    });
    render(<SemanticSearchPanel initial={settings({ source: "ollama" })} />);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(MODELS, expect.anything()),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Embedding model" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitemradio", {
        name: /bge-m3.*not downloaded/,
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Download & use" }),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.put).not.toHaveBeenCalled();
  });

  it("stops waiting for a download that Ollama says is not under way and has not delivered", async () => {
    serve({ ollama: ollama({ state: "running" }), models: models([]) });
    vi.mocked(api.post).mockImplementation(async (path: string) => {
      if (path === MODELS) return models([]);
      if (path === "/api/v1/ai/ollama/enable")
        return ollama({ state: "running", models: [] });
      throw new Error(`unexpected POST ${path}`);
    });
    render(<SemanticSearchPanel initial={settings({ source: "ollama" })} />);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(MODELS, expect.anything()),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Embedding model" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitemradio", {
        name: /bge-m3.*not downloaded/,
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Download & use" }),
    );

    // Nothing was delivered, so nothing is saved on the person's behalf.
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/ai/ollama/enable", {
        model: "bge-m3",
      }),
    );
    expect(api.put).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download & use" }),
      ).toBeEnabled(),
    );
  });
});
