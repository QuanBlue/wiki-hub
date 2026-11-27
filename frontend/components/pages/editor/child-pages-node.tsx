"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import {
  ArrowUpDown,
  FileText,
  FolderTree,
  Search,
  Table2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  PAGE_STATUS_OPTIONS,
  PageStatusPill,
} from "@/components/pages/page-properties-bar";
import { useTranslation } from "@/lib/i18n/context";
import { formatDate } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import type { PageStatus, WikiPage } from "@/types/api";
import { useEditorSpacePageContext } from "./page-context";

type ViewMode = "table" | "tree";
type DepthMode = "direct" | "all";
type SortField = "title" | "updated_at" | "status";

function collectChildren(
  pages: WikiPage[],
  parentId: string | null,
  depth: DepthMode,
): Array<{ page: WikiPage; level: number }> {
  if (!parentId) return [];
  const byParent = new Map<string, WikiPage[]>();
  for (const p of pages) {
    if (!p.parent_id) continue;
    const list = byParent.get(p.parent_id) ?? [];
    list.push(p);
    byParent.set(p.parent_id, list);
  }
  const result: Array<{ page: WikiPage; level: number }> = [];
  const seen = new Set<string>();
  const walk = (pid: string, level: number) => {
    const kids = byParent.get(pid) ?? [];
    for (const child of kids) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push({ page: child, level });
      if (depth === "all") {
        walk(child.id, level + 1);
      }
    }
  };
  walk(parentId, 0);
  return result;
}

function ChildPagesNodeView({
  node,
  editor,
  updateAttributes,
  deleteNode,
  selected,
}: NodeViewProps) {
  const { locale } = useTranslation();
  const isVi = locale === "vi";
  const ctx = useEditorSpacePageContext();
  const editable = editor.isEditable;

  const viewMode: ViewMode =
    node.attrs.viewMode === "tree" ? "tree" : "table";
  const depth: DepthMode = node.attrs.depth === "all" ? "all" : "direct";
  const savedFilterStatus = (node.attrs.filterStatus as string) || "";

  const [localSearch, setLocalSearch] = useState("");
  const [localStatusFilter, setLocalStatusFilter] = useState(savedFilterStatus);
  const [sortField, setSortField] = useState<SortField>("title");
  const [sortAsc, setSortAsc] = useState(true);

  const effectiveStatusFilter = editable ? savedFilterStatus : localStatusFilter;

  const rows = useMemo(() => {
    if (!ctx) return [];
    let items = collectChildren(ctx.pages, ctx.currentPageId, depth);
    if (effectiveStatusFilter) {
      items = items.filter(
        ({ page }) => page.properties?.status === effectiveStatusFilter,
      );
    }
    const q = localSearch.trim().toLowerCase();
    if (q) {
      items = items.filter(({ page }) => {
        const ownerName =
          page.properties?.owner?.full_name ||
          page.properties?.owner?.username ||
          "";
        return (
          page.title.toLowerCase().includes(q) ||
          ownerName.toLowerCase().includes(q)
        );
      });
    }
    if (viewMode === "table") {
      items = [...items].sort((a, b) => {
        let cmp = 0;
        if (sortField === "title") {
          cmp = a.page.title.localeCompare(b.page.title);
        } else if (sortField === "updated_at") {
          cmp = a.page.updated_at.localeCompare(b.page.updated_at);
        } else if (sortField === "status") {
          cmp = (a.page.properties?.status ?? "").localeCompare(
            b.page.properties?.status ?? "",
          );
        }
        return sortAsc ? cmp : -cmp;
      });
    }
    return items;
  }, [
    ctx,
    depth,
    effectiveStatusFilter,
    localSearch,
    viewMode,
    sortField,
    sortAsc,
  ]);

  const customKeys = useMemo(() => {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const { page } of rows) {
      for (const prop of page.properties?.custom ?? []) {
        if (prop.key && !seen.has(prop.key)) {
          seen.add(prop.key);
          keys.push(prop.key);
        }
      }
    }
    return keys.slice(0, 4);
  }, [rows]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  }

  return (
    <NodeViewWrapper
      className={cn(
        "border-border bg-surface my-4 rounded-lg border transition-colors",
        selected && editable && "ring-ring ring-2",
      )}
      contentEditable={false}
    >
      <div className="border-border/80 bg-surface-sunken/60 flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b px-3 py-2 text-xs">
        <div className="flex items-center gap-2 font-medium text-foreground">
          {viewMode === "table" ? (
            <Table2 className="text-primary size-3.5 shrink-0" />
          ) : (
            <FolderTree className="text-primary size-3.5 shrink-0" />
          )}
          <span>
            {isVi ? "Danh sách trang con" : "Child pages"}
          </span>
          <span className="bg-surface text-muted-foreground rounded-full px-1.5 py-0.25 text-[11px] tabular-nums">
            {rows.length}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {!editable ? (
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2" />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder={isVi ? "Lọc trang..." : "Filter..."}
                className="border-border bg-background text-foreground focus-visible:ring-ring h-6.5 w-32 rounded border pr-2 pl-6 text-[11px] focus-visible:ring-2 focus-visible:outline-none"
              />
            </div>
          ) : null}

          <select
            value={effectiveStatusFilter}
            onChange={(e) => {
              if (editable) {
                updateAttributes({ filterStatus: e.target.value });
              } else {
                setLocalStatusFilter(e.target.value);
              }
            }}
            aria-label={isVi ? "Lọc trạng thái" : "Filter by status"}
            className="border-border bg-background text-foreground hover:border-border-strong focus-visible:ring-ring h-6.5 rounded border px-1.5 text-[11px] focus-visible:ring-2 focus-visible:outline-none"
          >
            <option value="">{isVi ? "Mọi trạng thái" : "All statuses"}</option>
            {PAGE_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {isVi ? opt.labelVi : opt.labelEn}
              </option>
            ))}
          </select>

          {editable ? (
            <>
              <div className="border-border bg-background inline-flex overflow-hidden rounded border">
                <button
                  type="button"
                  onClick={() => updateAttributes({ viewMode: "table" })}
                  className={cn(
                    "cursor-pointer px-2 py-0.5 text-[11px] transition-colors hover:bg-surface-hover",
                    viewMode === "table"
                      ? "bg-primary-subtle text-primary font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {isVi ? "Bảng" : "Table"}
                </button>
                <button
                  type="button"
                  onClick={() => updateAttributes({ viewMode: "tree" })}
                  className={cn(
                    "border-border cursor-pointer border-l px-2 py-0.5 text-[11px] transition-colors hover:bg-surface-hover",
                    viewMode === "tree"
                      ? "bg-primary-subtle text-primary font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {isVi ? "Cây" : "Tree"}
                </button>
              </div>

              <div className="border-border bg-background inline-flex overflow-hidden rounded border">
                <button
                  type="button"
                  onClick={() => updateAttributes({ depth: "direct" })}
                  className={cn(
                    "cursor-pointer px-2 py-0.5 text-[11px] transition-colors hover:bg-surface-hover",
                    depth === "direct"
                      ? "bg-primary-subtle text-primary font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {isVi ? "1 cấp" : "Direct"}
                </button>
                <button
                  type="button"
                  onClick={() => updateAttributes({ depth: "all" })}
                  className={cn(
                    "border-border cursor-pointer border-l px-2 py-0.5 text-[11px] transition-colors hover:bg-surface-hover",
                    depth === "all"
                      ? "bg-primary-subtle text-primary font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {isVi ? "Toàn bộ" : "All"}
                </button>
              </div>

              <button
                type="button"
                onClick={deleteNode}
                className="text-muted-foreground hover:bg-danger/10 hover:text-danger cursor-pointer rounded p-1 transition-colors"
                title={isVi ? "Xóa khối" : "Remove block"}
              >
                <Trash2 className="size-3.5" />
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="p-3">
        {rows.length === 0 ? (
          <p className="text-muted-foreground py-3 text-center text-xs">
            {isVi
              ? "Chưa có trang con nào phù hợp."
              : "No matching child pages yet."}
          </p>
        ) : viewMode === "tree" ? (
          <ul className="space-y-1 text-sm">
            {rows.map(({ page, level }) => (
              <li
                key={page.id}
                style={{ paddingLeft: `${level * 18}px` }}
                className="hover:bg-surface-hover flex items-center justify-between gap-2 rounded-md px-2 py-1 transition-colors"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="text-muted-foreground size-3.5 shrink-0" />
                  {ctx ? (
                    <Link
                      href={`/spaces/${encodeURIComponent(ctx.spaceKey)}/pages/${encodeURIComponent(page.slug)}`}
                      className="text-foreground hover:text-primary truncate font-medium no-underline hover:underline"
                    >
                      {page.title}
                    </Link>
                  ) : (
                    <span className="truncate font-medium">{page.title}</span>
                  )}
                  {page.properties?.status ? (
                    <PageStatusPill
                      status={page.properties.status}
                      locale={locale}
                    />
                  ) : null}
                </div>
                <span className="text-muted-foreground shrink-0 text-[11px]">
                  {formatDate(page.updated_at, locale)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-border text-muted-foreground border-b">
                  <th className="py-1.5 pr-3 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort("title")}
                      className="hover:text-foreground inline-flex cursor-pointer items-center gap-1"
                    >
                      {isVi ? "Trang" : "Page"}
                      <ArrowUpDown className="size-3 opacity-60" />
                    </button>
                  </th>
                  <th className="px-2 py-1.5 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort("status")}
                      className="hover:text-foreground inline-flex cursor-pointer items-center gap-1"
                    >
                      {isVi ? "Trạng thái" : "Status"}
                      <ArrowUpDown className="size-3 opacity-60" />
                    </button>
                  </th>
                  <th className="px-2 py-1.5 font-medium">
                    {isVi ? "Phụ trách" : "Owner"}
                  </th>
                  {customKeys.map((k) => (
                    <th key={k} className="px-2 py-1.5 font-medium">
                      {k}
                    </th>
                  ))}
                  <th className="py-1.5 pl-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort("updated_at")}
                      className="hover:text-foreground inline-flex cursor-pointer items-center gap-1"
                    >
                      {isVi ? "Cập nhật" : "Updated"}
                      <ArrowUpDown className="size-3 opacity-60" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border/60 divide-y">
                {rows.map(({ page, level }) => {
                  const customMap = new Map(
                    (page.properties?.custom ?? []).map((c) => [c.key, c.value]),
                  );
                  return (
                    <tr
                      key={page.id}
                      className="hover:bg-surface-hover/60 transition-colors"
                    >
                      <td className="py-2 pr-3 font-medium">
                        <div
                          className="flex items-center gap-1.5"
                          style={{ paddingLeft: `${level * 14}px` }}
                        >
                          <FileText className="text-muted-foreground size-3.5 shrink-0" />
                          {ctx ? (
                            <Link
                              href={`/spaces/${encodeURIComponent(ctx.spaceKey)}/pages/${encodeURIComponent(page.slug)}`}
                              className="text-foreground hover:text-primary no-underline hover:underline"
                            >
                              {page.title}
                            </Link>
                          ) : (
                            <span>{page.title}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {page.properties?.status ? (
                          <PageStatusPill
                            status={page.properties.status as PageStatus}
                            locale={locale}
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-2 py-2">
                        {page.properties?.owner
                          ? page.properties.owner.full_name ||
                            page.properties.owner.username
                          : "—"}
                      </td>
                      {customKeys.map((k) => (
                        <td
                          key={k}
                          className="text-muted-foreground px-2 py-2"
                        >
                          {customMap.get(k) || "—"}
                        </td>
                      ))}
                      <td className="text-muted-foreground py-2 pl-2 text-right whitespace-nowrap">
                        {formatDate(page.updated_at, locale)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const ChildPagesNode = Node.create({
  name: "childPages",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      viewMode: {
        default: "table",
        parseHTML: (el) => el.getAttribute("data-view-mode") || "table",
        renderHTML: (attrs) => ({ "data-view-mode": attrs.viewMode || "table" }),
      },
      depth: {
        default: "direct",
        parseHTML: (el) => el.getAttribute("data-depth") || "direct",
        renderHTML: (attrs) => ({ "data-depth": attrs.depth || "direct" }),
      },
      filterStatus: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-filter-status") || "",
        renderHTML: (attrs) =>
          attrs.filterStatus
            ? { "data-filter-status": attrs.filterStatus }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="childPages"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "childPages" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChildPagesNodeView);
  },
});
