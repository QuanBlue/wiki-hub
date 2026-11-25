"use client";

import {
  Copy,
  Eye,
  LayoutGrid,
  LayoutTemplate,
  List,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { TemplateIcon } from "@/components/templates/template-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, inputClassName } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { markdownToHtml } from "@/lib/markdown-html";
import {
  createGlobalTemplate,
  createSpaceTemplate,
  deleteGlobalTemplate,
  deleteSpaceTemplate,
  listGlobalTemplates,
  listSpaceTemplates,
  updateGlobalTemplate,
  updateSpaceTemplate,
} from "@/lib/templates";
import { cn } from "@/lib/utils";
import type {
  PageContentFormat,
  PageTemplate,
  PageTemplateScope,
} from "@/types/api";

const TemplatePreviewBody = dynamic(
  () =>
    import("@/components/pages/rich-text-editor").then(
      (mod) => mod.RichTextContent,
    ),
  { ssr: false },
);

type ScopeFilter = "all" | PageTemplateScope;

interface EditorFormState {
  id: string | null;
  name: string;
  description: string;
  category: string;
  icon: string;
  content: string;
  contentFormat: PageContentFormat;
}

const EMPTY_FORM: EditorFormState = {
  id: null,
  name: "",
  description: "",
  category: "",
  icon: "📄",
  content: "",
  contentFormat: "html",
};

function renderPreviewHtml(content: string, format: PageContentFormat): string {
  if (!content.trim()) return "";
  return format === "markdown" ? markdownToHtml(content) : content;
}

function formatCategoryLabel(category: string): string {
  const trimmed = category.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function TemplateManager({
  mode,
  spaceKey,
}: {
  mode: "global" | "space";
  spaceKey?: string;
}) {
  const { t, locale } = useTranslation();
  const [templates, setTemplates] = useState<PageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<"write" | "preview">("write");
  const [form, setForm] = useState<EditorFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [previewTemplate, setPreviewTemplate] = useState<PageTemplate | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<PageTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    const request =
      mode === "space" && spaceKey
        ? listSpaceTemplates(spaceKey, locale)
        : listGlobalTemplates({ scope: "all", lang: locale });
    void request
      .then((items) => {
        if (active) setTemplates(items);
      })
      .catch((error) => {
        if (active) {
          toast.error(describeApiError(error, t("templates.loadError")));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locale, mode, spaceKey, t]);

  const canEditTemplate = useCallback(
    (template: PageTemplate): boolean => {
      if (template.is_builtin) return false;
      if (mode === "global") return template.scope === "global";
      return template.scope === "space";
    },
    [mode],
  );

  const scopeOptions: ScopeFilter[] = useMemo(
    () =>
      mode === "space"
        ? ["all", "space", "global", "builtin"]
        : ["all", "global", "builtin"],
    [mode],
  );

  const scopeCounts = useMemo(() => {
    const counts: Record<ScopeFilter, number> = {
      all: templates.length,
      space: 0,
      global: 0,
      builtin: 0,
    };
    for (const item of templates) {
      counts[item.scope] += 1;
    }
    return counts;
  }, [templates]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of templates) {
      if (scopeFilter !== "all" && item.scope !== scopeFilter) continue;
      const cat = item.category.trim().toLowerCase();
      if (!cat) continue;
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [scopeFilter, templates]);

  const activeCategory =
    categoryFilter === "all" || categories.some(([cat]) => cat === categoryFilter)
      ? categoryFilter
      : "all";

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return templates.filter((item) => {
      if (scopeFilter !== "all" && item.scope !== scopeFilter) return false;
      if (
        activeCategory !== "all" &&
        item.category.trim().toLowerCase() !== activeCategory
      ) {
        return false;
      }
      if (!query) return true;
      return (
        item.name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query)
      );
    });
  }, [activeCategory, search, scopeFilter, templates]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditorTab("write");
    setEditorOpen(true);
  }

  function openEdit(template: PageTemplate) {
    setForm({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      icon: template.icon || "📄",
      content: template.content,
      contentFormat: template.content_format,
    });
    setEditorTab("write");
    setEditorOpen(true);
  }

  function openDuplicate(template: PageTemplate) {
    setForm({
      id: null,
      name: `${template.name}${t("templates.duplicateSuffix")}`.slice(0, 120),
      description: template.description,
      category: template.category,
      icon: template.icon || "📄",
      content: template.content,
      contentFormat: template.content_format,
    });
    setPreviewTemplate(null);
    setEditorTab("write");
    setEditorOpen(true);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = form.name.trim();
    if (!trimmedName || saving) return;

    setSaving(true);
    const payload = {
      name: trimmedName,
      description: form.description.trim(),
      category: form.category.trim(),
      icon: form.icon.trim() || "📄",
      content: form.content,
      content_format: form.contentFormat,
    };

    try {
      if (form.id) {
        const updated =
          mode === "space" && spaceKey
            ? await updateSpaceTemplate(spaceKey, form.id, payload)
            : await updateGlobalTemplate(form.id, payload);
        setTemplates((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        toast.success(t("templates.updatedToast", { name: updated.name }));
      } else {
        const created =
          mode === "space" && spaceKey
            ? await createSpaceTemplate(spaceKey, payload)
            : await createGlobalTemplate(payload);
        setTemplates((current) => [created, ...current]);
        toast.success(t("templates.createdToast", { name: created.name }));
      }
      setEditorOpen(false);
    } catch (error) {
      toast.error(describeApiError(error, t("templates.saveError")));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      if (mode === "space" && spaceKey) {
        await deleteSpaceTemplate(spaceKey, deleteTarget.id);
      } else {
        await deleteGlobalTemplate(deleteTarget.id);
      }
      setTemplates((current) =>
        current.filter((item) => item.id !== deleteTarget.id),
      );
      toast.success(t("templates.deletedToast", { name: deleteTarget.name }));
      setDeleteTarget(null);
    } catch (error) {
      toast.error(describeApiError(error, t("templates.deleteError")));
    } finally {
      setDeleting(false);
    }
  }

  function scopeLabel(scope: ScopeFilter): string {
    switch (scope) {
      case "space":
        return t("templates.scopeSpace");
      case "global":
        return t("templates.scopeGlobal");
      case "builtin":
        return t("templates.scopeBuiltin");
      default:
        return t("templates.scopeAll");
    }
  }

  function scopeBadgeVariant(scope: PageTemplateScope) {
    switch (scope) {
      case "space":
        return "info" as const;
      case "global":
        return "success" as const;
      case "builtin":
        return "neutral" as const;
    }
  }

  return (
    <div className="space-y-4">
      {/* Single calm toolbar matching WikiHub Administration screens */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("templates.searchPlaceholder")}
              aria-label={t("templates.searchPlaceholder")}
              className="pr-8 pl-8"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label={t("templates.clearSearch")}
                className="text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>

          {!loading && categories.length > 1 ? (
            <select
              aria-label={t("templates.categoryLabel")}
              value={activeCategory}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className={cn(
                inputClassName,
                "h-8 w-auto min-w-36 cursor-pointer py-0 pr-7 text-xs",
              )}
            >
              <option value="all">{t("templates.allCategories")}</option>
              {categories.map(([cat, count]) => (
                <option key={cat} value={cat}>
                  {formatCategoryLabel(cat)} ({count})
                </option>
              ))}
            </select>
          ) : null}

          <div
            role="group"
            aria-label={t("templates.scopeLabel")}
            className="border-border bg-surface-sunken inline-flex items-center gap-0.5 rounded-md border p-0.5"
          >
            {scopeOptions.map((option) => {
              const selected = scopeFilter === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setScopeFilter(option)}
                  className={cn(
                    "focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    selected
                      ? "bg-surface text-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <span>{scopeLabel(option)}</span>
                  <span className="text-muted-foreground text-[11px] tabular-nums">
                    {scopeCounts[option]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div
            role="group"
            aria-label="View layout"
            className="border-border bg-surface-sunken hidden items-center gap-0.5 rounded-md border p-0.5 sm:inline-flex"
          >
            <button
              type="button"
              aria-pressed={viewMode === "list"}
              aria-label={t("templates.listView")}
              title={t("templates.listView")}
              onClick={() => setViewMode("list")}
              className={cn(
                "focus-visible:ring-ring flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                viewMode === "list"
                  ? "bg-surface text-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <List className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "grid"}
              aria-label={t("templates.gridView")}
              title={t("templates.gridView")}
              onClick={() => setViewMode("grid")}
              className={cn(
                "focus-visible:ring-ring flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                viewMode === "grid"
                  ? "bg-surface text-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <LayoutGrid className="size-3.5" aria-hidden />
            </button>
          </div>

          <Button type="button" variant="primary" size="sm" onClick={openCreate}>
            <Plus aria-hidden />
            {t("templates.newTemplate")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div
          role="status"
          className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("templates.loading")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="border-border bg-surface-sunken flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center">
          <span className="bg-surface text-muted-foreground border-border mb-3 flex size-10 items-center justify-center rounded-full border">
            <LayoutTemplate className="size-5" aria-hidden />
          </span>
          <p className="text-foreground text-sm font-semibold">
            {t("templates.emptyTitle")}
          </p>
          <p className="text-muted-foreground mt-1 max-w-sm text-xs">
            {t("templates.emptyDescription")}
          </p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="mt-4"
            onClick={openCreate}
          >
            <Plus aria-hidden />
            {t("templates.newTemplate")}
          </Button>
        </div>
      ) : viewMode === "list" ? (
        <div className="border-border bg-surface overflow-x-auto rounded-xl border shadow-xs">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-border bg-surface-sunken/60 text-muted-foreground border-b text-xs font-medium">
                <th className="px-4 py-2.5 font-medium">
                  {t("templates.nameLabel")}
                </th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">
                  {t("templates.categoryLabel")}
                </th>
                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">
                  {t("templates.scopeLabel")}
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {filtered.map((template) => {
                const editable = canEditTemplate(template);
                return (
                  <tr
                    key={template.id}
                    className="hover:bg-surface-hover/50 transition-colors duration-150"
                  >
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="bg-surface-sunken border-border text-muted-foreground flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border"
                          aria-hidden
                        >
                          <TemplateIcon icon={template.icon} className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setPreviewTemplate(template)}
                            className="text-foreground hover:text-primary focus-visible:ring-ring block max-w-full cursor-pointer truncate rounded text-left text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                          >
                            {template.name}
                          </button>
                          {template.description ? (
                            <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
                              {template.description}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="text-muted-foreground hidden px-4 py-3 text-xs whitespace-nowrap md:table-cell">
                      {template.category
                        ? formatCategoryLabel(template.category)
                        : t("templates.noCategory")}
                    </td>
                    <td className="hidden px-4 py-3 whitespace-nowrap sm:table-cell">
                      <Badge variant={scopeBadgeVariant(template.scope)}>
                        {scopeLabel(template.scope)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`${t("templates.previewAction")} ${template.name}`}
                          title={t("templates.previewAction")}
                          onClick={() => setPreviewTemplate(template)}
                        >
                          <Eye className="size-3.5" aria-hidden />
                        </Button>
                        {editable ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={`${t("templates.editAction")} ${template.name}`}
                              title={t("templates.editAction")}
                              onClick={() => openEdit(template)}
                            >
                              <Pencil className="size-3.5" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-danger hover:bg-danger-bg hover:text-danger size-7"
                              aria-label={`${t("templates.deleteAction")} ${template.name}`}
                              title={t("templates.deleteAction")}
                              onClick={() => setDeleteTarget(template)}
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            aria-label={`${t("templates.duplicateAction")} ${template.name}`}
                            title={t("templates.duplicateAction")}
                            onClick={() => openDuplicate(template)}
                          >
                            <Copy className="size-3.5" aria-hidden />
                            {t("templates.duplicateAction")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((template) => {
            const editable = canEditTemplate(template);
            return (
              <div
                key={template.id}
                className="border-border bg-surface hover:border-border-strong flex flex-col justify-between rounded-lg border p-4 transition-[border-color,box-shadow] duration-150 hover:shadow-xs"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="bg-surface-sunken border-border text-muted-foreground flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border"
                        aria-hidden
                      >
                        <TemplateIcon icon={template.icon} className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-foreground truncate text-sm font-semibold">
                          <button
                            type="button"
                            onClick={() => setPreviewTemplate(template)}
                            className="hover:text-primary focus-visible:ring-ring cursor-pointer truncate rounded text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                          >
                            {template.name}
                          </button>
                        </h3>
                        <p className="text-muted-foreground truncate text-xs">
                          {template.category
                            ? formatCategoryLabel(template.category)
                            : t("templates.noCategory")}
                        </p>
                      </div>
                    </div>
                    <Badge variant={scopeBadgeVariant(template.scope)}>
                      {scopeLabel(template.scope)}
                    </Badge>
                  </div>

                  {template.description ? (
                    <p className="text-muted-foreground line-clamp-2 text-xs leading-5">
                      {template.description}
                    </p>
                  ) : null}
                </div>

                <div className="border-border mt-4 flex items-center justify-between gap-2 border-t pt-2.5">
                  <span className="text-muted-foreground truncate text-[11px]">
                    {!editable
                      ? t("templates.readOnly")
                      : template.updated_by_username
                        ? t("templates.updatedBy", {
                            username: template.updated_by_username,
                          })
                        : template.created_by_username
                          ? t("templates.createdBy", {
                              username: template.created_by_username,
                            })
                          : ""}
                  </span>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`${t("templates.previewAction")} ${template.name}`}
                      title={t("templates.previewAction")}
                      onClick={() => setPreviewTemplate(template)}
                    >
                      <Eye className="size-3.5" aria-hidden />
                    </Button>

                    {editable ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`${t("templates.editAction")} ${template.name}`}
                          title={t("templates.editAction")}
                          onClick={() => openEdit(template)}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-danger hover:bg-danger-bg hover:text-danger size-7"
                          aria-label={`${t("templates.deleteAction")} ${template.name}`}
                          title={t("templates.deleteAction")}
                          onClick={() => setDeleteTarget(template)}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        aria-label={`${t("templates.duplicateAction")} ${template.name}`}
                        title={t("templates.duplicateAction")}
                        onClick={() => openDuplicate(template)}
                      >
                        <Copy className="size-3.5" aria-hidden />
                        {t("templates.duplicateAction")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit modal */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent
          className="max-w-3xl"
          title={
            form.id ? t("templates.editTitle") : t("templates.createTitle")
          }
          description={
            form.id
              ? t("templates.editDescription")
              : t("templates.createDescription")
          }
        >
          <form onSubmit={handleSave} className="space-y-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="template-form-name">
                  {t("templates.nameLabel")}
                </Label>
                <input
                  id="template-form-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className={inputClassName}
                  placeholder={t("templates.namePlaceholder")}
                  maxLength={120}
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1.5 sm:w-24">
                <Label htmlFor="template-form-icon">
                  {t("templates.iconLabel")}
                </Label>
                <input
                  id="template-form-icon"
                  value={form.icon}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, icon: event.target.value }))
                  }
                  className={cn(inputClassName, "text-center")}
                  placeholder={t("templates.iconPlaceholder")}
                  maxLength={16}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="template-form-category">
                  {t("templates.categoryLabel")}
                </Label>
                <input
                  id="template-form-category"
                  value={form.category}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      category: event.target.value,
                    }))
                  }
                  className={inputClassName}
                  placeholder={t("templates.categoryPlaceholder")}
                  maxLength={60}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="template-form-format">
                  {t("templates.formatLabel")}
                </Label>
                <select
                  id="template-form-format"
                  value={form.contentFormat}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      contentFormat: event.target.value as PageContentFormat,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="html">{t("templates.formatHtml")}</option>
                  <option value="markdown">
                    {t("templates.formatMarkdown")}
                  </option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="template-form-description">
                {t("templates.descriptionLabel")}
              </Label>
              <input
                id="template-form-description"
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                className={inputClassName}
                placeholder={t("templates.descriptionPlaceholder")}
                maxLength={500}
              />
            </div>

            <div className="space-y-2">
              <div className="border-border flex items-center justify-between border-b">
                <Label htmlFor="template-form-content" className="pb-2">
                  {t("templates.contentLabel")}
                </Label>
                <div className="flex gap-1">
                  {(["write", "preview"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      aria-pressed={editorTab === tab}
                      onClick={() => setEditorTab(tab)}
                      className={cn(
                        "focus-visible:ring-ring -mb-px cursor-pointer rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                        editorTab === tab
                          ? "border-primary text-primary"
                          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground border-transparent",
                      )}
                    >
                      {tab === "write"
                        ? t("templates.writeTab")
                        : t("templates.previewTab")}
                    </button>
                  ))}
                </div>
              </div>

              {editorTab === "write" ? (
                <textarea
                  id="template-form-content"
                  value={form.content}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      content: event.target.value,
                    }))
                  }
                  className={cn(
                    inputClassName,
                    "min-h-56 resize-y py-2 font-mono text-xs leading-6",
                  )}
                  placeholder={t("templates.contentPlaceholder")}
                  maxLength={200000}
                />
              ) : (
                <div className="border-border bg-surface-sunken wh-scroll min-h-56 max-h-80 overflow-y-auto rounded-md border px-4 py-3">
                  {form.content.trim() ? (
                    <TemplatePreviewBody
                      content={renderPreviewHtml(
                        form.content,
                        form.contentFormat,
                      )}
                    />
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      {t("templates.previewEmpty")}
                    </p>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditorOpen(false)}
                disabled={saving}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={saving || !form.name.trim()}
              >
                {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {saving
                  ? t("templates.saving")
                  : form.id
                    ? t("templates.saveAction")
                    : t("templates.createAction")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Preview modal */}
      <Dialog
        open={previewTemplate !== null}
        onOpenChange={(next) => !next && setPreviewTemplate(null)}
      >
        {previewTemplate ? (
          <DialogContent
            className="max-w-3xl"
            title={
              <span className="flex items-center gap-2">
                <TemplateIcon icon={previewTemplate.icon} className="size-4" />
                <span>{previewTemplate.name}</span>
              </span>
            }
            description={
              previewTemplate.description || t("templates.previewTitle")
            }
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={scopeBadgeVariant(previewTemplate.scope)}>
                  {scopeLabel(previewTemplate.scope)}
                </Badge>
                {previewTemplate.category ? (
                  <Badge variant="subtle">{previewTemplate.category}</Badge>
                ) : null}
                {!canEditTemplate(previewTemplate) ? (
                  <Badge variant="neutral">{t("templates.readOnly")}</Badge>
                ) : null}
              </div>

              <div className="border-border bg-surface-sunken wh-scroll max-h-[55vh] min-h-40 overflow-y-auto rounded-md border px-5 py-4">
                {previewTemplate.content.trim() ? (
                  <TemplatePreviewBody
                    content={renderPreviewHtml(
                      previewTemplate.content,
                      previewTemplate.content_format,
                    )}
                  />
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t("templates.previewEmpty")}
                  </p>
                )}
              </div>

              <DialogFooter>
                {canEditTemplate(previewTemplate) ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const target = previewTemplate;
                      setPreviewTemplate(null);
                      openEdit(target);
                    }}
                  >
                    <Pencil aria-hidden />
                    {t("templates.editAction")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => openDuplicate(previewTemplate)}
                  >
                    <Copy aria-hidden />
                    {t("templates.duplicateAction")}
                  </Button>
                )}
              </DialogFooter>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
        title={t("templates.deleteTitle")}
        description={t("templates.deleteDescription", {
          name: deleteTarget?.name ?? "",
        })}
        confirmLabel={
          deleting ? t("templates.deleting") : t("templates.deleteConfirm")
        }
        cancelLabel={t("common.cancel")}
        destructive
        pending={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
