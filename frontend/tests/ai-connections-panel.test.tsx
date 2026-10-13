import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { AiConnectionsPanel } from "@/components/admin/ai-connections-panel";
import { api } from "@/lib/api-client";
import type { AiConnection, AiConnectionList, AiModelInfo } from "@/lib/admin-ai";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const BASE = "/api/v1/ai/connections";

function model(id: string, over: Partial<AiModelInfo> = {}): AiModelInfo {
  return { id, name: id, reasoning: false, image: false, ...over };
}

function connection(over: Partial<AiConnection> = {}): AiConnection {
  return {
    id: "c1",
    name: "Codev",
    base_url: "http://gw/v1",
    model: "a/one",
    api_key_preview: "sk-adc2****297a",
    is_active: true,
    last_checked_at: null,
    last_check_ok: null,
    created_at: "2026-10-13T08:00:00Z",
    ...over,
  };
}

function list(items: AiConnection[]) {
  return { items } satisfies AiConnectionList;
}

function row(name: string) {
  return within(screen.getByRole("table")).getByText(name).closest("tr") as HTMLElement;
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.delete).mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("AiConnectionsPanel table", () => {
  it("lists each connection with its masked key, model and status", () => {
    render(
      <AiConnectionsPanel
        initial={list([
          connection(),
          connection({ id: "c2", name: "Backup", model: "", is_active: false, api_key_preview: "****" }),
        ])}
      />,
    );

    const first = within(row("Codev"));
    expect(first.getByText("sk-adc2****297a")).toBeInTheDocument();
    expect(first.getByText("a/one")).toBeInTheDocument();
    expect(first.getByText("Active")).toBeInTheDocument();
    expect(first.getByText("Never")).toBeInTheDocument();
    const second = within(row("Backup"));
    expect(second.getByText("Inactive")).toBeInTheDocument();
    expect(second.getByText("No model")).toBeInTheDocument();
    // The name and the model stand out in the summary sentence.
    const banner = screen.getByText(/is the active connection/).closest("p") as HTMLElement;
    expect(banner).toHaveTextContent("Codev is the active connection - AI actions use a/one.");
    expect(within(banner).getByText("Codev").tagName).toBe("STRONG");
    expect(within(banner).getByText("a/one").tagName).toBe("CODE");
  });

  it("shows the model each connection uses in its own column", () => {
    render(
      <AiConnectionsPanel
        initial={list([connection(), connection({ id: "c2", name: "Other", model: "z/two", is_active: false })])}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Model" })).toBeInTheDocument();
    expect(within(row("Codev")).getByText("a/one")).toBeInTheDocument();
    expect(within(row("Other")).getByText("z/two")).toBeInTheDocument();
  });

  it("explains when nothing is active", () => {
    render(<AiConnectionsPanel initial={list([connection({ is_active: false })])} />);

    expect(screen.getByText(/No connection is active, so AI actions are off/)).toBeInTheDocument();
  });

  it("invites adding the first connection when none is saved", () => {
    render(<AiConnectionsPanel initial={list([])} />);

    expect(screen.getByText("No AI connection yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows whether the last check worked", () => {
    render(
      <AiConnectionsPanel
        initial={list([
          connection({ last_check_ok: true, last_checked_at: "2026-10-13T08:00:00Z" }),
          connection({ id: "c2", name: "Broken", is_active: false, last_check_ok: false }),
        ])}
      />,
    );

    expect(within(row("Codev")).getByText("Working")).toBeInTheDocument();
    expect(within(row("Broken")).getByText("Failing")).toBeInTheDocument();
  });
});

describe("AiConnectionsPanel activation", () => {
  it("keeps one connection active: activating another switches the first off", async () => {
    vi.mocked(api.post).mockResolvedValue(connection({ id: "c2", name: "Backup", is_active: true }));
    render(
      <AiConnectionsPanel
        initial={list([connection(), connection({ id: "c2", name: "Backup", is_active: false })])}
      />,
    );

    await userEvent.click(
      within(row("Backup")).getByRole("button", { name: /Make active/ }),
    );

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`${BASE}/c2/activate`));
    expect(toast.success).toHaveBeenCalledWith("Backup is now the active connection.");
    await waitFor(() => expect(within(row("Codev")).getByText("Inactive")).toBeInTheDocument());
    expect(within(row("Backup")).getByText("Active")).toBeInTheDocument();
  });

  it("switches the active connection off", async () => {
    vi.mocked(api.post).mockResolvedValue(connection({ is_active: false }));
    render(<AiConnectionsPanel initial={list([connection()])} />);

    await userEvent.click(within(row("Codev")).getByRole("button", { name: "Switch off" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`${BASE}/c1/deactivate`));
    await waitFor(() => expect(within(row("Codev")).getByText("Inactive")).toBeInTheDocument());
  });

  it("reports a failed switch", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("down"));
    render(<AiConnectionsPanel initial={list([connection({ is_active: false })])} />);

    await userEvent.click(within(row("Codev")).getByRole("button", { name: /Make active/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(within(row("Codev")).getByText("Inactive")).toBeInTheDocument();
  });
});

describe("AiConnectionsPanel add dialog", () => {
  it("adds a connection: checks it when a field is left, lets you pick the model, and can activate it", async () => {
    vi.mocked(api.post).mockImplementation(async (path: string) => {
      if (path === `${BASE}/test`) {
        return {
          ok: true,
          models: [
            model("a/one"),
            model("b/two", { name: "Two", reasoning: true, image: true }),
          ],
          error: null,
        };
      }
      return connection({ id: "c9", name: "New", model: "b/two", api_key_preview: "sk-new****cdef" });
    });
    render(<AiConnectionsPanel initial={list([connection()])} />);

    await userEvent.click(screen.getByRole("button", { name: "Add OpenAI Compatible" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.type(dialog.getByLabelText("Name"), "New");
    await userEvent.type(dialog.getByLabelText("Endpoint address"), "http://new/v1");
    await userEvent.type(dialog.getByLabelText("API key"), "sk-new-secret");
    await userEvent.tab();

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/test`, {
        base_url: "http://new/v1",
        api_key: "sk-new-secret",
        connection_id: null,
      }),
    );
    expect(await dialog.findByText(/2 model\(s\) found/)).toBeInTheDocument();
    // Each model is a card showing its id, name and what it can do.
    expect(dialog.getByRole("radio", { name: "b/two" }).closest("label")).toHaveAttribute(
      "title",
      "Two",
    );
    expect(dialog.getByText("Reasoning")).toBeInTheDocument();
    expect(dialog.getByText("Image")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("radio", { name: "b/two" }));
    expect(dialog.getByRole("radio", { name: "b/two" })).toBeChecked();
    // With a list to pick from there is no separate model field.
    expect(dialog.queryByLabelText("Model")).toBeNull();
    await userEvent.click(dialog.getByLabelText("Make this the active connection"));
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(BASE, {
        name: "New",
        base_url: "http://new/v1",
        model: "b/two",
        api_key: "sk-new-secret",
        activate: true,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Connection added.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(row("New")).getByText("sk-new****cdef")).toBeInTheDocument();
    expect(within(row("New")).getByText("Active")).toBeInTheDocument();
    // Activating the new one switched the previous one off.
    expect(within(row("Codev")).getByText("Inactive")).toBeInTheDocument();
  });

  it("makes the first connection active by itself, so there is no activate option", async () => {
    vi.mocked(api.post).mockImplementation(async (path: string) =>
      path === `${BASE}/test`
        ? { ok: true, models: [model("a/one")], error: null }
        : connection({ id: "c1", name: "First", is_active: true }),
    );
    render(<AiConnectionsPanel initial={list([])} />);

    await userEvent.click(screen.getByRole("button", { name: "Add OpenAI Compatible" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.queryByLabelText("Make this the active connection")).toBeNull();
    await userEvent.type(dialog.getByLabelText("Name"), "First");
    await userEvent.type(dialog.getByLabelText("Endpoint address"), "http://gw/v1");
    await userEvent.type(dialog.getByLabelText("API key"), "k");
    await userEvent.tab();
    await userEvent.click(await dialog.findByRole("radio", { name: "a/one" }));
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(within(row("First")).getByText("Active")).toBeInTheDocument());
    expect(vi.mocked(api.post).mock.calls.at(-1)![1]).toMatchObject({ activate: false });
  });

  it("only lets you save once the connection checked out and a model is chosen", async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, models: [model("a/one")], error: null });
    render(<AiConnectionsPanel initial={list([])} />);

    await userEvent.click(screen.getByRole("button", { name: "Add OpenAI Compatible" }));
    const dialog = within(await screen.findByRole("dialog"));
    const save = dialog.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Fetch models" })).toBeDisabled();
    expect(dialog.getByText("To save: check the connection and choose a model.")).toBeInTheDocument();

    await userEvent.type(dialog.getByLabelText("Name"), "X");
    await userEvent.type(dialog.getByLabelText("Endpoint address"), "http://x/v1");
    await userEvent.type(dialog.getByLabelText("API key"), "k");
    expect(save).toBeDisabled(); // typed, but not checked yet

    await userEvent.tab();
    await userEvent.click(await dialog.findByRole("radio", { name: "a/one" }));
    expect(save).toBeEnabled();

    // Changing the address or key throws the check away: it has to be run again.
    await userEvent.type(dialog.getByLabelText("API key"), "2");
    expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.tab();
    await userEvent.click(await dialog.findByRole("radio", { name: "a/one" }));
    expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("cannot be saved after a failed check", async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: false, models: [], error: "nope" });
    render(<AiConnectionsPanel initial={list([])} />);

    await userEvent.click(screen.getByRole("button", { name: "Add OpenAI Compatible" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.type(dialog.getByLabelText("Name"), "X");
    await userEvent.type(dialog.getByLabelText("Endpoint address"), "http://x/v1");
    await userEvent.type(dialog.getByLabelText("API key"), "k");
    await userEvent.tab();

    await dialog.findByRole("alert");
    expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows no model field before fetching, and cannot be saved when the endpoint lists none", async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, models: [], error: null });
    render(<AiConnectionsPanel initial={list([])} />);

    await userEvent.click(screen.getByRole("button", { name: "Add OpenAI Compatible" }));
    const dialog = within(await screen.findByRole("dialog"));
    // Models is empty until fetched, and the model is never typed.
    expect(dialog.queryByRole("radio")).toBeNull();
    expect(dialog.queryByLabelText("Model")).toBeNull();
    expect(dialog.queryByRole("textbox", { name: /model/i })).toBeNull();

    await userEvent.type(dialog.getByLabelText("Name"), "X");
    await userEvent.type(dialog.getByLabelText("Endpoint address"), "http://x/v1");
    await userEvent.type(dialog.getByLabelText("API key"), "k");
    await userEvent.tab();

    await dialog.findByText(/nothing to choose/);
    expect(dialog.queryByLabelText("Model")).toBeNull();
    expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows why a check failed inside the dialog, and does not ask again when a field is left unchanged", async () => {
    vi.mocked(api.post).mockResolvedValue({
      ok: false,
      models: [],
      error: "The endpoint rejected the API key.",
    });
    render(<AiConnectionsPanel initial={list([])} />);

    await userEvent.click(screen.getByRole("button", { name: "Add OpenAI Compatible" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.type(dialog.getByLabelText("Endpoint address"), "http://x/v1");
    await userEvent.type(dialog.getByLabelText("API key"), "bad");
    await userEvent.tab();

    expect(await dialog.findByRole("alert")).toHaveTextContent("The endpoint rejected the API key.");
    await userEvent.click(dialog.getByLabelText("Endpoint address"));
    await userEvent.tab();
    expect(api.post).toHaveBeenCalledTimes(1);

    await userEvent.click(dialog.getByRole("button", { name: "Fetch models" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  });

  it("says when the endpoint lists no models", async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, models: [], error: null });
    render(<AiConnectionsPanel initial={list([])} />);

    await userEvent.click(screen.getByRole("button", { name: "Add OpenAI Compatible" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.type(dialog.getByLabelText("Endpoint address"), "http://x/v1");
    await userEvent.type(dialog.getByLabelText("API key"), "k");
    await userEvent.tab();

    expect(await dialog.findByText(/lists no models/)).toBeInTheDocument();
  });
});

describe("AiConnectionsPanel edit and remove", () => {
  it("edits a connection: it checks itself on open, and the key is kept unless a new one is typed", async () => {
    vi.mocked(api.patch).mockResolvedValue(connection({ name: "Renamed" }));
    vi.mocked(api.post).mockResolvedValue({ ok: true, models: [model("a/one")], error: null });
    render(<AiConnectionsPanel initial={list([connection()])} />);

    await userEvent.click(within(row("Codev")).getByRole("button", { name: "Edit" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByLabelText("Name")).toHaveValue("Codev");
    expect(dialog.getByText("Leave blank to keep the saved key (sk-adc2****297a).")).toBeInTheDocument();
    expect(dialog.queryByLabelText("Make this the active connection")).toBeNull();

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/test`, {
        base_url: "http://gw/v1",
        api_key: "",
        connection_id: "c1",
      }),
    );
    expect(await dialog.findByRole("radio", { name: "a/one" })).toBeChecked();

    await userEvent.clear(dialog.getByLabelText("Name"));
    await userEvent.type(dialog.getByLabelText("Name"), "Renamed");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`${BASE}/c1`, {
        name: "Renamed",
        base_url: "http://gw/v1",
        model: "a/one",
      }),
    );
    await waitFor(() => expect(row("Renamed")).toBeInTheDocument());
  });

  it("needs a new pick when the saved model is no longer offered", async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, models: [model("b/two")], error: null });
    render(<AiConnectionsPanel initial={list([connection({ model: "gone/model" })])} />);

    await userEvent.click(within(row("Codev")).getByRole("button", { name: "Edit" }));
    const dialog = within(await screen.findByRole("dialog"));

    await dialog.findByRole("radio", { name: "b/two" });
    expect(dialog.getByText(/“gone\/model” isn't in this list/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(dialog.getByRole("radio", { name: "b/two" }));
    expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("asks before removing, and warns when it is the active one", async () => {
    vi.mocked(api.delete).mockResolvedValue(undefined);
    render(
      <AiConnectionsPanel
        initial={list([connection(), connection({ id: "c2", name: "Backup", is_active: false })])}
      />,
    );

    await userEvent.click(within(row("Codev")).getByRole("button", { name: "Remove" }));
    const confirm = within(await screen.findByRole("alertdialog"));
    expect(confirm.getByText(/It is the active connection/)).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(confirm.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${BASE}/c1`));
    await waitFor(() => expect(screen.queryByText("Codev")).toBeNull());
    expect(screen.getByText("Backup")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Connection removed.");
  });

  it("checks a saved connection now and refreshes the table", async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, models: [], error: null });
    vi.mocked(api.get).mockResolvedValue(
      list([connection({ last_check_ok: true, last_checked_at: "2026-10-13T08:00:00Z" })]),
    );
    render(<AiConnectionsPanel initial={list([connection()])} />);

    await userEvent.click(within(row("Codev")).getByRole("button", { name: "Check now" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`${BASE}/c1/check`));
    expect(toast.success).toHaveBeenCalledWith("The connection works.");
    expect(await within(row("Codev")).findByText("Working")).toBeInTheDocument();
  });
});
