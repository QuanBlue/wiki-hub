import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreatePageDialog } from "@/components/pages/create-page-dialog";
import { SaveAsTemplateDialog } from "@/components/pages/save-as-template-dialog";
import { TemplateManager } from "@/components/templates/template-manager";
import { api } from "@/lib/api-client";
import type { PageTemplate } from "@/types/api";

const { push, toastSuccess, toastError } = vi.hoisted(() => ({
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function MockPreview({ content }: { content: string }) {
      return <div data-testid="template-preview-body">{content}</div>;
    },
}));

const mockedApi = vi.mocked(api);

const BUILTIN_TEMPLATE: PageTemplate = {
  id: "builtin:meeting-notes",
  scope: "builtin",
  is_builtin: true,
  space_id: null,
  space_key: null,
  name: "Meeting notes",
  description: "Agenda, attendees, decisions, and action items.",
  category: "Meetings",
  icon: "📝",
  content: "<h2>Agenda</h2><p>Topics</p>",
  content_format: "html",
  created_by_username: null,
  updated_by_username: null,
  created_at: null,
  updated_at: null,
};

const GLOBAL_TEMPLATE: PageTemplate = {
  id: "tpl-global-1",
  scope: "global",
  is_builtin: false,
  space_id: null,
  space_key: null,
  name: "Architecture RFC",
  description: "Proposal for system design changes.",
  category: "Engineering",
  icon: "📐",
  content: "<h2>Context</h2><p>Background</p>",
  content_format: "html",
  created_by_username: "admin",
  updated_by_username: "admin",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const SPACE_TEMPLATE: PageTemplate = {
  id: "tpl-space-1",
  scope: "space",
  is_builtin: false,
  space_id: "space-1",
  space_key: "ENG",
  name: "Service Runbook",
  description: "On-call recovery steps for ENG services.",
  category: "Operations",
  icon: "🛠️",
  content: "## Recovery Steps\n\n- Check dashboards",
  content_format: "markdown",
  created_by_username: "alice",
  updated_by_username: "alice",
  created_at: "2026-01-03T00:00:00Z",
  updated_at: "2026-01-04T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreatePageDialog with templates", () => {
  it("loads space templates, previews selection, and sends template_id and template_lang", async () => {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/api/v1/spaces/ENG/templates") {
        return [SPACE_TEMPLATE, GLOBAL_TEMPLATE, BUILTIN_TEMPLATE];
      }
      return { enabled: false, can_configure: false };
    });
    mockedApi.post.mockResolvedValue({
      id: "page-1",
      title: "Incident Runbook",
      slug: "incident-runbook",
    });

    const actor = userEvent.setup();
    render(<CreatePageDialog spaceKey="ENG" />);

    await actor.click(screen.getByRole("button", { name: "Create page" }));
    const dialog = await screen.findByRole("dialog");

    await within(dialog).findByRole("radio", { name: /Service Runbook/i });
    expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/spaces/ENG/templates", {
      query: { lang: "en" },
    });

    // Filter by Built-in scope
    await actor.click(within(dialog).getByRole("button", { name: "Built-in" }));
    expect(
      within(dialog).getByRole("radio", { name: /Meeting notes/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("radio", { name: /Service Runbook/i }),
    ).toBeNull();

    // Switch back to All and select Service Runbook
    await actor.click(within(dialog).getByRole("button", { name: "All" }));
    await actor.click(
      within(dialog).getByRole("radio", { name: /Service Runbook/i }),
    );

    expect(
      within(dialog).getByTestId("template-preview-body"),
    ).toHaveTextContent("Recovery Steps");

    await actor.type(
      within(dialog).getByLabelText("Title"),
      "Incident Runbook",
    );
    await actor.click(
      within(dialog).getByRole("button", { name: "Create page" }),
    );

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/api/v1/spaces/ENG/pages", {
        title: "Incident Runbook",
        content: "",
        parent_id: null,
        template_id: "tpl-space-1",
        template_lang: "en",
      }),
    );
  });

  it("allows clearing template back to blank page without sending template_id", async () => {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/api/v1/spaces/ENG/templates") {
        return [BUILTIN_TEMPLATE];
      }
      return { enabled: false, can_configure: false };
    });
    mockedApi.post.mockResolvedValue({
      id: "page-2",
      title: "Scratch",
      slug: "scratch",
    });

    const actor = userEvent.setup();
    render(<CreatePageDialog spaceKey="ENG" />);

    await actor.click(screen.getByRole("button", { name: "Create page" }));
    const dialog = await screen.findByRole("dialog");

    await actor.click(
      await within(dialog).findByRole("radio", { name: /Meeting notes/i }),
    );
    await actor.click(
      within(dialog).getByRole("button", { name: "Use blank page" }),
    );

    await actor.type(within(dialog).getByLabelText("Title"), "Scratch");
    await actor.type(within(dialog).getByLabelText("Content"), "Custom body");
    await actor.click(
      within(dialog).getByRole("button", { name: "Create page" }),
    );

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/api/v1/spaces/ENG/pages", {
        title: "Scratch",
        content: "Custom body",
        parent_id: null,
      }),
    );
  });
});

describe("SaveAsTemplateDialog", () => {
  it("submits a space template and hides the global scope when not a system admin", async () => {
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    mockedApi.post.mockResolvedValue(SPACE_TEMPLATE);

    const actor = userEvent.setup();
    render(
      <SaveAsTemplateDialog
        spaceKey="ENG"
        page={{ id: "page-42", title: "Weekly Sync" }}
        open
        onOpenChange={onOpenChange}
        canCreateGlobal={false}
        onSaved={onSaved}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Weekly Sync");
    expect(
      within(dialog).queryByRole("radio", { name: /Global/i }),
    ).toBeNull();

    await actor.type(
      within(dialog).getByLabelText("Description"),
      "Weekly engineering sync notes",
    );
    await actor.type(within(dialog).getByLabelText("Category"), "Meetings");
    await actor.click(
      within(dialog).getByRole("button", { name: "Save as template" }),
    );

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/spaces/ENG/pages/page-42/save-as-template",
        {
          name: "Weekly Sync",
          description: "Weekly engineering sync notes",
          category: "Meetings",
          scope: "space",
        },
      ),
    );
    expect(onSaved).toHaveBeenCalledWith(SPACE_TEMPLATE);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("allows system admins to save a page as a global template", async () => {
    const onOpenChange = vi.fn();
    mockedApi.post.mockResolvedValue(GLOBAL_TEMPLATE);

    const actor = userEvent.setup();
    render(
      <SaveAsTemplateDialog
        spaceKey="ENG"
        page={{ id: "page-99", title: "RFC Template" }}
        open
        onOpenChange={onOpenChange}
        canCreateGlobal
      />,
    );

    const dialog = await screen.findByRole("dialog");
    await actor.click(
      within(dialog).getByRole("radio", { name: /Global \(all spaces\)/i }),
    );
    await actor.click(
      within(dialog).getByRole("button", { name: "Save as template" }),
    );

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/spaces/ENG/pages/page-99/save-as-template",
        {
          name: "RFC Template",
          description: undefined,
          category: undefined,
          scope: "global",
        },
      ),
    );
  });
});

describe("TemplateManager", () => {
  it("shows built-in templates as read-only and supports create, edit, duplicate, and delete", async () => {
    mockedApi.get.mockResolvedValue([GLOBAL_TEMPLATE, BUILTIN_TEMPLATE]);
    mockedApi.post.mockResolvedValue({
      ...GLOBAL_TEMPLATE,
      id: "tpl-global-2",
      name: "Postmortem",
      category: "Operations",
      description: "Incident review",
      content: "<h2>Summary</h2>",
    });
    mockedApi.patch.mockResolvedValue({
      ...GLOBAL_TEMPLATE,
      name: "Architecture RFC v2",
    });
    mockedApi.delete.mockResolvedValue(undefined);

    const actor = userEvent.setup();
    render(<TemplateManager mode="global" />);

    await screen.findByText("Architecture RFC");
    expect(screen.getByText("Meeting notes")).toBeInTheDocument();

    // Built-in template is read-only: has Duplicate and Preview, but no Edit or Delete
    expect(
      screen.getByRole("button", { name: "Duplicate Meeting notes" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit Meeting notes" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Delete Meeting notes" }),
    ).toBeNull();

    // Create a new global template (defaults to Normal rich-text editor; can switch to HTML/Markdown)
    await actor.click(screen.getByRole("button", { name: "New template" }));
    const createDialog = await screen.findByRole("dialog");
    const formatSelect = within(createDialog).getByLabelText("Format");
    expect(formatSelect).toHaveValue("normal");
    expect(
      createDialog.querySelector(".wikihub-template-editor"),
    ).not.toBeNull();

    await actor.type(within(createDialog).getByLabelText("Name"), "Postmortem");
    await actor.type(
      within(createDialog).getByLabelText("Category"),
      "Operations",
    );
    await actor.type(
      within(createDialog).getByLabelText("Description"),
      "Incident review",
    );
    await actor.selectOptions(formatSelect, "html");
    await actor.type(
      within(createDialog).getByLabelText("Content"),
      "<h2>Summary</h2>",
    );
    await actor.click(
      within(createDialog).getByRole("button", { name: "Create template" }),
    );

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/api/v1/templates", {
        name: "Postmortem",
        description: "Incident review",
        category: "Operations",
        icon: "📄",
        content: "<h2>Summary</h2>",
        content_format: "html",
      }),
    );
    expect(await screen.findByText("Postmortem")).toBeInTheDocument();

    // Edit existing global template
    await actor.click(
      screen.getByRole("button", { name: "Edit Architecture RFC" }),
    );
    const editDialog = await screen.findByRole("dialog");
    const nameInput = within(editDialog).getByLabelText("Name");
    await actor.clear(nameInput);
    await actor.type(nameInput, "Architecture RFC v2");
    await actor.click(
      within(editDialog).getByRole("button", { name: "Save template" }),
    );

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        "/api/v1/templates/tpl-global-1",
        expect.objectContaining({ name: "Architecture RFC v2" }),
      ),
    );
    expect(await screen.findByText("Architecture RFC v2")).toBeInTheDocument();

    // Delete via ConfirmDialog
    await actor.click(
      screen.getByRole("button", { name: "Delete Architecture RFC v2" }),
    );
    const confirmDialog = await screen.findByRole("alertdialog");
    await actor.click(
      within(confirmDialog).getByRole("button", { name: "Delete template" }),
    );

    await waitFor(() =>
      expect(mockedApi.delete).toHaveBeenCalledWith(
        "/api/v1/templates/tpl-global-1",
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Architecture RFC v2")).toBeNull(),
    );
  });

  it("uses space endpoints in space mode and treats global templates as read-only", async () => {
    mockedApi.get.mockResolvedValue([SPACE_TEMPLATE, GLOBAL_TEMPLATE]);

    render(<TemplateManager mode="space" spaceKey="ENG" />);

    await screen.findByText("Service Runbook");
    expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/spaces/ENG/templates", {
      query: { lang: "en" },
    });

    expect(
      screen.getByRole("button", { name: "Edit Service Runbook" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Duplicate Service Runbook" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete Service Runbook" }),
    ).toBeInTheDocument();

    // Scope filter tabs split into All, Custom, Built-in
    const scopeGroup = screen.getByRole("group", { name: "Scope" });
    expect(
      within(scopeGroup).getByRole("button", { name: /All/i }),
    ).toBeInTheDocument();
    expect(
      within(scopeGroup).getByRole("button", { name: /Custom/i }),
    ).toBeInTheDocument();
    expect(
      within(scopeGroup).getByRole("button", { name: /Built-in/i }),
    ).toBeInTheDocument();

    // Global template in space mode is read-only
    expect(
      screen.queryByRole("button", { name: "Edit Architecture RFC" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Duplicate Architecture RFC" }),
    ).toBeInTheDocument();
  });
});
