import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TuningFields,
  type TuningDraft,
} from "@/components/admin/tuning-fields";
import type { TuningSpec } from "@/lib/admin-ai";
import { ApiError, api } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const spec = (over: Partial<TuningSpec> & { key: string }): TuningSpec => ({
  label: over.key,
  default: 0,
  minimum: null,
  maximum: null,
  kind: "int",
  choices: [],
  ollama_only: false,
  restart: false,
  ...over,
});

const SPECS: TuningSpec[] = [
  spec({ key: "index_batch", default: 20, minimum: 1, maximum: 500 }),
  spec({
    key: "ollama_cpus",
    default: 0,
    minimum: 0,
    maximum: 64,
    ollama_only: true,
  }),
  spec({
    key: "ollama_keep_alive",
    default: "5m",
    kind: "choice",
    choices: ["5m", "30m", "-1"],
    ollama_only: true,
    restart: true,
  }),
];

async function openSection(actor: ReturnType<typeof userEvent.setup>) {
  await actor.click(screen.getByText("Performance & tuning"));
}

function Form({
  canBenchmark = true,
  hostCpus = 4,
}: {
  canBenchmark?: boolean;
  hostCpus?: number;
}) {
  const [draft, setDraft] = useState<TuningDraft>({});
  return (
    <TuningFields
      specs={SPECS}
      draft={draft}
      onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
      source="ollama"
      hostCpus={hostCpus}
      canBenchmark={canBenchmark}
    />
  );
}

beforeEach(() => vi.clearAllMocks());

describe("TuningFields", () => {
  it("picks a choice, shows it, and goes back to the default one", async () => {
    const actor = userEvent.setup();
    render(<Form />);
    await openSection(actor);
    const field = screen.getByRole("button", {
      name: /Keep the model loaded/i,
    });

    await actor.click(field);
    await actor.click(
      await screen.findByRole("menuitemradio", { name: /30 min/i }),
    );
    expect(field).toHaveTextContent(/30 min/i);

    await actor.click(field);
    await actor.click(
      await screen.findAllByRole("menuitemradio").then((items) => items[0]),
    );
    expect(field).not.toHaveTextContent(/30 min/i);
  });

  it("limits the CPU cores to what the machine has, and says so", async () => {
    const actor = userEvent.setup();
    render(<Form hostCpus={4} />);
    await openSection(actor);

    const cores = screen.getByRole("textbox", { name: /Ollama CPU cores/i });
    await actor.type(cores, "70");

    expect(
      within(screen.getByRole("alert")).getByText(/4/),
    ).toBeInTheDocument();
    expect(cores).toHaveAttribute("aria-invalid", "true");
  });

  it("explains a value that is not a number, or not whole", async () => {
    const actor = userEvent.setup();
    render(<Form />);
    await openSection(actor);
    const batch = screen.getByRole("textbox", { name: /Pages per minute/i });

    await actor.type(batch, "abc");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await actor.clear(batch);
    await actor.type(batch, "2.5");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the result of a speed test", async () => {
    vi.mocked(api.post).mockResolvedValue({
      ok: true,
      error: null,
      passages: 8,
      characters: 5600,
      seconds: 2.4,
      seconds_per_passage: 0.3,
      batch_size: 16,
      estimated_minutes_per_100_pages: 2.5,
    });
    const actor = userEvent.setup();
    render(<Form />);
    await openSection(actor);

    await actor.click(screen.getByRole("button", { name: /Test speed/i }));

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/api/v1/ai/embedding/benchmark");
  });

  it("says why a speed test failed, whether the server answered or not", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      ok: false,
      error: "The model did not answer.",
      passages: 0,
      characters: 0,
      seconds: 0,
      seconds_per_passage: 0,
      batch_size: 0,
      estimated_minutes_per_100_pages: 0,
    });
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(503, "service_unavailable", "The AI service is down."),
    );
    const actor = userEvent.setup();
    render(<Form />);
    await openSection(actor);
    const run = screen.getByRole("button", { name: /Test speed/i });

    await actor.click(run);
    expect(
      await screen.findByText("The model did not answer."),
    ).toBeInTheDocument();

    await actor.click(run);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /down|could not|error/i,
      ),
    );
  });

  it("cannot run a speed test before a model is saved", async () => {
    const actor = userEvent.setup();
    render(<Form canBenchmark={false} />);
    await openSection(actor);

    expect(screen.getByRole("button", { name: /Test speed/i })).toBeDisabled();
  });
});
