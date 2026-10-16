import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { OllamaCard } from "@/components/admin/ollama-card";
import type { OllamaStatus } from "@/lib/admin-ai";
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

function status(over: Partial<OllamaStatus> = {}): OllamaStatus {
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
    available_models: [
      { name: "bge-m3", note: "multilingual, 1024 dims" },
      { name: "nomic-embed-text", note: "English-focused" },
    ],
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

function renderCard(s: OllamaStatus | null, extra: { failed?: boolean } = {}) {
  const onChange = vi.fn();
  const onRefresh = vi.fn();
  render(
    <OllamaCard
      status={s}
      failed={extra.failed ?? false}
      onChange={onChange}
      onRefresh={onRefresh}
    />,
  );
  return { onChange, onRefresh };
}

beforeEach(() => {
  vi.mocked(api.post).mockReset();
  vi.mocked(api.delete).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("OllamaCard", () => {
  it("explains what enabling costs, then enables with the chosen model", async () => {
    vi.mocked(api.post).mockResolvedValue(
      status({ state: "installing", step: "image" }),
    );
    const { onChange } = renderCard(status());

    expect(screen.getByText("Not installed")).toBeInTheDocument();
    expect(
      screen.getByText(/costs nothing while it is off/),
    ).toBeInTheDocument();
    expect(screen.getByText(/about 4 GB for Ollama/)).toBeInTheDocument();
    expect(
      screen.getByText(/the only part with access to Docker/),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Enable and download" }),
    );

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/ai/ollama/enable", {
        model: "bge-m3",
      }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ state: "installing" }),
    );
  });

  it("lets the model to download be chosen from the curated list", async () => {
    vi.mocked(api.post).mockResolvedValue(status({ state: "installing" }));
    renderCard(status());

    await userEvent.click(
      screen.getByRole("button", { name: "Model to download" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "nomic-embed-text" }),
    );
    expect(screen.getByText("English-focused")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Enable and download" }),
    );

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/ai/ollama/enable", {
        model: "nomic-embed-text",
      }),
    );
  });

  it("shows each install step, the bytes of the current one and an overall bar", () => {
    renderCard(
      status({
        state: "installing",
        step: "model",
        model: "bge-m3",
        percent: 40,
        overall: 79,
        current: 480 * 1024 * 1024,
        total: 1200 * 1024 * 1024,
      }),
    );

    const steps = within(
      screen.getByRole("list", { name: "Self-hosted Ollama" }),
    );
    expect(steps.getByText("Download Ollama")).toBeInTheDocument();
    expect(steps.getByText("Start Ollama")).toBeInTheDocument();
    expect(steps.getByText("Wait until it answers")).toBeInTheDocument();
    expect(steps.getByText("Download bge-m3")).toBeInTheDocument();
    expect(steps.getByText("480.0 MB / 1.17 GB · 40%")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "79");
    expect(
      screen.getByText(/the install continues in the background/),
    ).toBeInTheDocument();
    // Nothing to enable while it is installing.
    expect(
      screen.queryByRole("button", { name: "Enable and download" }),
    ).toBeNull();
  });

  it("cancels an install in progress", async () => {
    vi.mocked(api.post).mockResolvedValue(
      status({ state: "error", error: "Cancelled." }),
    );
    const { onChange } = renderCard(
      status({ state: "installing", step: "image", overall: 10 }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/ai/ollama/cancel"),
    );
    expect(onChange).toHaveBeenCalled();
  });

  it("shows what is running, how much memory it uses, and offers the other models", () => {
    renderCard(
      status({
        state: "running",
        models: ["bge-m3:latest"],
        memory_bytes: 800 * 1024 * 1024,
        cpu_percent: 150,
      }),
    );

    expect(screen.getByText("Running")).toBeInTheDocument();
    // The models are listed (with their tags) in the panel's single dropdown, not here.
    expect(screen.queryByText("Downloaded models")).toBeNull();
    expect(screen.getByText(/800\.0 MB \/ 3 GB/)).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Memory in use" }),
    ).toHaveAttribute("aria-valuenow", "26");
    expect(screen.getByText("26%")).toBeInTheDocument();
    expect(screen.getByText("1.5 of 12 cores")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "CPU in use" }),
    ).toHaveAttribute("aria-valuenow", "13");
    // Choosing and downloading a model lives in the panel's single model list, not here.
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Model to download" }),
    ).toBeNull();
  });

  it("tells what happened to the last download, and lets it be dismissed", async () => {
    renderCard(
      status({
        state: "running",
        models: ["bge-m3:latest"],
        notice: "Downloading snowflake-arctic-embed2 was cancelled.",
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Downloading snowflake-arctic-embed2 was cancelled.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/was cancelled/)).toBeNull();
  });

  it("offers nothing to download once every model is there", () => {
    renderCard(
      status({
        state: "running",
        models: ["bge-m3:latest", "nomic-embed-text:latest"],
      }),
    );

    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("asks before disabling, explains what happens, and then disables", async () => {
    vi.mocked(api.post).mockResolvedValue(
      status({ state: "stopped", volume_present: true }),
    );
    const { onChange } = renderCard(
      status({ state: "running", models: ["bge-m3:latest"] }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Disable" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText(/freeing its memory/)).toBeInTheDocument();
    expect(dialog.getByText(/searches use keywords only/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.click(dialog.getByRole("button", { name: "Disable" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/ai/ollama/disable"),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ state: "stopped" }),
    );
  });

  it("keeps it running when the disable prompt is cancelled", async () => {
    renderCard(status({ state: "running", models: ["bge-m3:latest"] }));

    await userEvent.click(screen.getByRole("button", { name: "Disable" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    expect(api.post).not.toHaveBeenCalled();
  });

  it("offers to delete the downloaded models only while it is off, after a confirmation", async () => {
    vi.mocked(api.delete).mockResolvedValue(status({ state: "not_installed" }));
    renderCard(status({ state: "stopped", volume_present: true }));

    expect(screen.getByText("Installed, off")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete downloaded models" }),
    );
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText(/frees the disk space/)).toBeInTheDocument();
    await userEvent.click(
      dialog.getByRole("button", { name: "Delete downloaded models" }),
    );

    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith("/api/v1/ai/ollama/models"),
    );
  });

  it("reports a failed install and retries it", async () => {
    vi.mocked(api.post).mockResolvedValue(status({ state: "installing" }));
    renderCard(status({ state: "error", error: "no space left on device" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "no space left on device",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/ai/ollama/enable", {
        model: "bge-m3",
      }),
    );
  });

  it.each([
    ["controller_down", "The Ollama controller is not running."],
    ["docker_unavailable", "Docker is not reachable from the controller."],
  ] as const)("explains %s and offers to look again", async (state, error) => {
    const { onRefresh } = renderCard(
      status({ state, error, controller_ok: state !== "controller_down" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(error);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRefresh).toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Enable and download" }),
    ).toBeNull();
  });

  it("says so while it is starting, loading or unreachable", () => {
    const { unmount } = render(
      <OllamaCard
        status={status({ state: "starting" })}
        failed={false}
        onChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText("Ollama is starting…")).toBeInTheDocument();
    unmount();

    const loading = render(
      <OllamaCard
        status={null}
        failed={false}
        onChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText("Checking Ollama…")).toBeInTheDocument();
    loading.unmount();

    render(
      <OllamaCard
        status={null}
        failed
        onChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Could not read the state of Ollama."),
    ).toBeInTheDocument();
  });

  it("reports an action that fails", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("boom"));
    renderCard(status());

    await userEvent.click(
      screen.getByRole("button", { name: "Enable and download" }),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

describe("OllamaCard applying saved settings", () => {
  it("offers a restart when the saved settings differ, and restarts with an installed model", async () => {
    vi.mocked(api.post).mockResolvedValue(status({ state: "installing" }));
    renderCard(
      status({
        state: "running",
        models: ["bge-m3:latest"],
        restart_needed: true,
        applied_memory_mb: 3072,
        applied_cpus: 0,
        applied_keep_alive: "5m",
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved settings differ from what is running (now: 3.0 GB memory, all cores, model kept 5 minutes).",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Restart to apply" }),
    );

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/ai/ollama/enable", {
        model: "bge-m3",
      }),
    );
  });

  it("says nothing about a restart when nothing differs", () => {
    renderCard(
      status({
        state: "running",
        models: ["bge-m3:latest"],
        restart_needed: false,
      }),
    );

    expect(
      screen.queryByRole("button", { name: "Restart to apply" }),
    ).toBeNull();
  });
});
