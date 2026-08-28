"use client";

import {
  Archive,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  DatabaseBackup,
  Download,
  Eye,
  File,
  FileArchive,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type {
  StorageDeleteResult,
  StorageObject,
  StoragePresignedUrl,
} from "@/types/api";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/** Split an S3 key into path segments. */
function splitKey(key: string): string[] {
  return key.split("/").filter(Boolean);
}

// ---------------------------------------------------------------------------
// Tree node types
// ---------------------------------------------------------------------------

interface FolderNode {
  kind: "folder";
  name: string;
  path: string; // e.g. "attachments/page-id"
  children: TreeNode[];
  totalSize: number;
  totalFiles: number;
}

interface FileNode {
  kind: "file";
  name: string;
  path: string; // full S3 key
  size: number;
  etag: string | null;
  last_modified: string | null;
}

type TreeNode = FolderNode | FileNode;

function buildTree(objects: StorageObject[]): TreeNode[] {
  const root: FolderNode = {
    kind: "folder",
    name: "",
    path: "",
    children: [],
    totalSize: 0,
    totalFiles: 0,
  };

  for (const obj of objects) {
    const parts = splitKey(obj.key);
    if (parts.length === 0) continue;

    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      const childPath = parts.slice(0, i + 1).join("/");
      let child = current.children.find(
        (c): c is FolderNode => c.kind === "folder" && c.name === segment,
      );
      if (!child) {
        child = {
          kind: "folder",
          name: segment,
          path: childPath,
          children: [],
          totalSize: 0,
          totalFiles: 0,
        };
        current.children.push(child);
      }
      current = child;
    }

    const fileName = parts[parts.length - 1];
    current.children.push({
      kind: "file",
      name: fileName,
      path: obj.key,
      size: obj.size,
      etag: obj.etag,
      last_modified: obj.last_modified,
    });
  }

  // Propagate totals upward
  function propagate(node: FolderNode): void {
    node.totalSize = 0;
    node.totalFiles = 0;
    for (const child of node.children) {
      if (child.kind === "folder") {
        propagate(child);
        node.totalSize += child.totalSize;
        node.totalFiles += child.totalFiles;
      } else {
        node.totalSize += child.size;
        node.totalFiles += 1;
      }
    }
    // Sort: folders first, then alphabetically
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
  propagate(root);

  return root.children;
}

/** Filter tree to nodes whose path matches the search query. */
function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();
  const results: TreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === "folder") {
      const filtered = filterTree(node.children, query);
      if (filtered.length > 0 || node.name.toLowerCase().includes(q)) {
        results.push({ ...node, children: filtered });
      }
    } else {
      if (node.path.toLowerCase().includes(q)) results.push(node);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// File icon helper
// ---------------------------------------------------------------------------

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext))
    return <FileImage className="text-primary size-4 shrink-0" />;
  if (["zip", "tar", "gz"].includes(ext))
    return <FileArchive className="text-warning size-4 shrink-0" />;
  if (["txt", "md", "json", "csv"].includes(ext))
    return <FileText className="text-muted-foreground size-4 shrink-0" />;
  return <File className="text-muted-foreground size-4 shrink-0" />;
}

type PreviewKind = "image" | "text" | "unsupported";

function previewKind(name: string): PreviewKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg", "ico"].includes(ext)) {
    return "image";
  }
  if (
    [
      "txt", "md", "markdown", "json", "csv", "tsv", "log", "js", "jsx",
      "ts", "tsx", "css", "scss", "html", "xml", "yaml", "yml", "toml",
      "ini", "env", "conf", "lock", "map", "py", "rb", "go", "rs", "java", "kt", "sql", "sh",
      "bash", "zsh", "bat", "ps1", "graphql", "proto", "hcl", "tf", "dockerfile",
    ].includes(ext) || name.toLowerCase() === "dockerfile"
  ) {
    return "text";
  }
  return "unsupported";
}

// ---------------------------------------------------------------------------
// Tree row components
// ---------------------------------------------------------------------------

interface FileRowProps {
  node: FileNode;
  depth: number;
  onDelete: (key: string) => void;
  onDownload: (key: string, name: string) => void;
  onPreview: (node: FileNode) => void;
}

function FileRow({ node, depth, onDelete, onDownload, onPreview }: FileRowProps) {
  return (
    <div
      className="border-border hover:bg-surface-hover flex items-center gap-2 border-b px-3 py-2 text-sm last:border-0"
      style={{ paddingLeft: `${depth * 20 + 12}px` }}
    >
      <FileIcon name={node.name} />
      <button
        type="button"
        className="text-foreground hover:text-primary min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-xs font-normal transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={`Preview ${node.path}`}
        onClick={() => onPreview(node)}
      >
        {node.name}
      </button>
      <span className="text-muted-foreground w-20 shrink-0 text-right text-xs tabular-nums">
        {formatBytes(node.size)}
      </span>
      <span className="text-muted-foreground hidden w-36 shrink-0 text-right text-xs sm:block">
        {formatDate(node.last_modified)}
      </span>
      <button
        aria-label={`Preview ${node.name}`}
        title="Preview"
        className="text-muted-foreground hover:text-foreground hover:bg-surface-selected focus-visible:ring-ring shrink-0 cursor-pointer rounded p-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => onPreview(node)}
      >
        <Eye className="size-3.5" />
      </button>
      <button
        aria-label={`Download ${node.name}`}
        title="Download"
        className="text-muted-foreground hover:text-foreground hover:bg-surface-selected focus-visible:ring-ring shrink-0 cursor-pointer rounded p-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => onDownload(node.path, node.name)}
      >
        <Download className="size-3.5" />
      </button>
      <button
        aria-label={`Delete ${node.name}`}
        title="Delete"
        className="text-muted-foreground hover:text-danger hover:bg-danger-bg focus-visible:ring-ring shrink-0 cursor-pointer rounded p-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => onDelete(node.path)}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

interface FolderRowProps {
  node: FolderNode;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onDelete: (key: string) => void;
  onDownload: (key: string, name: string) => void;
  onPreview: (node: FileNode) => void;
}

function FolderRow({
  node,
  depth,
  expanded,
  onToggle,
  onDelete,
  onDownload,
  onPreview,
}: FolderRowProps) {
  return (
    <>
      <button
        className="border-border hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 border-b px-3 py-2 text-left text-sm transition-colors duration-150 last:border-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
        )}
        {expanded ? (
          <FolderOpen className="text-primary size-4 shrink-0" />
        ) : (
          <Folder className="text-primary size-4 shrink-0" />
        )}
        <span
          className="min-w-0 flex-1 truncate font-normal text-foreground"
          title={node.path}
        >
          {node.name}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs font-normal tabular-nums">
          {node.totalFiles} file{node.totalFiles !== 1 ? "s" : ""} ·{" "}
          {formatBytes(node.totalSize)}
        </span>
      </button>
      {expanded &&
        node.children.map((child) =>
          child.kind === "folder" ? (
            <FolderRowWrapper
              key={child.path}
              node={child}
              depth={depth + 1}
              onDelete={onDelete}
              onDownload={onDownload}
              onPreview={onPreview}
            />
          ) : (
            <FileRow
              key={child.path}
              node={child}
              depth={depth + 1}
              onDelete={onDelete}
              onDownload={onDownload}
              onPreview={onPreview}
            />
          ),
        )}
    </>
  );
}

function FolderRowWrapper({
  node,
  depth,
  onDelete,
  onDownload,
  onPreview,
}: {
  node: FolderNode;
  depth: number;
  onDelete: (key: string) => void;
  onDownload: (key: string, name: string) => void;
  onPreview: (node: FileNode) => void;
}) {
  // Every folder starts collapsed, top level included - a fresh page load
  // with hundreds/thousands of attachments auto-expanded was an unreadable
  // wall of rows.
  const [expanded, setExpanded] = useState(false);
  return (
    <FolderRow
      node={node}
      depth={depth}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      onDelete={onDelete}
      onDownload={onDownload}
      onPreview={onPreview}
    />
  );
}

// ---------------------------------------------------------------------------
// Kind metadata - shared between the overview breakdown and the type filter
// ---------------------------------------------------------------------------

const KIND_ORDER: StorageObject["kind"][] = [
  "page_attachment",
  "avatar",
  "import_archive",
  "document_import",
  "backup_archive",
  "backup_export",
  "other",
];

const KIND_META: Record<StorageObject["kind"], { label: string; icon: typeof FileText }> = {
  page_attachment: { label: "Page files", icon: FileText },
  avatar: { label: "Avatars", icon: UserRound },
  import_archive: { label: "Confluence imports", icon: FileArchive },
  document_import: { label: "Document imports", icon: FileText },
  // The two halves of full backup: the archive an admin uploaded to restore
  // from, and the archive an export job produced. Both were previously
  // "Other objects", which is why a restore upload that had landed in the
  // bucket looked to an admin like it had never been stored at all.
  backup_archive: { label: "Restore archives", icon: Archive },
  backup_export: { label: "Backup exports", icon: DatabaseBackup },
  other: { label: "Other objects", icon: File },
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

type FilterOption = {
  id: string;
  label: string;
};

function MultiFilter({
  label,
  allLabel,
  selected,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  selected: string[];
  options: FilterOption[];
  onChange: (selected: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const matchingOptions = useMemo(
    () =>
      options.filter((option) =>
        option.label.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [options, search],
  );
  const selectedLabel =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((option) => option.id === selected[0])?.label ?? allLabel
        : `${selected.length} selected`;

  function toggle(id: string) {
    onChange(
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-muted-foreground px-1 text-[11px] font-medium">
        {label}
      </p>
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) setSearch("");
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="border-border bg-surface hover:border-border-strong focus-visible:ring-ring flex h-10 w-40 cursor-pointer items-center justify-between gap-2 rounded-md border px-3 text-left text-sm transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            aria-label={`Filter by ${label.toLowerCase()}`}
          >
            <span className="truncate">{selectedLabel}</span>
            <ChevronDown className="text-muted-foreground size-4 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-72 p-2"
          onCloseAutoFocus={() => setSearch("")}
        >
          <div
            className="border-border border-b pb-2"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="h-8 pl-8 text-xs"
                aria-label={`Search ${label.toLowerCase()} options`}
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            <label className="hover:bg-surface-hover flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors duration-150">
              <input
                type="checkbox"
                checked={selected.length === 0}
                onChange={() => onChange([])}
                className="accent-primary size-4 cursor-pointer"
              />
              <span className="font-medium">{allLabel}</span>
            </label>
            {matchingOptions.map((option) => (
              <label
                key={option.id}
                className="hover:bg-surface-hover flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors duration-150"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option.id)}
                  onChange={() => toggle(option.id)}
                  className="accent-primary size-4 cursor-pointer"
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {selected.includes(option.id) ? (
                  <Check className="text-primary size-4 shrink-0" aria-hidden />
                ) : null}
              </label>
            ))}
            {matchingOptions.length === 0 ? (
              <p className="text-muted-foreground px-2 py-3 text-xs">
                No matching options.
              </p>
            ) : null}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function StoragePanel() {
  const [objects, setObjects] = useState<StorageObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilters, setKindFilters] = useState<string[]>([]);
  const [spaceFilters, setSpaceFilters] = useState<string[]>([]);
  const [pageFilters, setPageFilters] = useState<string[]>([]);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewNode, setPreviewNode] = useState<FileNode | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const fetchObjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<StorageObject[]>("/api/v1/storage");
      setObjects(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load storage objects.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch objects when the storage panel mounts
    void fetchObjects();
  }, [fetchObjects]);

  useEffect(() => {
    if (!previewNode) return;

    let active = true;
    const kind = previewKind(previewNode.name);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset preview state for the newly selected object
    setPreviewUrl(null);
    setPreviewText(null);
    setPreviewError(null);
    setPreviewLoading(kind !== "unsupported");

    if (kind === "unsupported") return;

    void (async () => {
      try {
        const { url } = await apiFetch<StoragePresignedUrl>(
          `/api/v1/storage/presign?key=${encodeURIComponent(previewNode.path)}&inline=true`,
        );
        if (!active) return;
        if (kind === "image") {
          setPreviewUrl(url);
        } else {
          const response = await fetch(url);
          if (!response.ok) throw new Error("Could not load the file content.");
          setPreviewText(await response.text());
        }
      } catch (err) {
        if (active) {
          setPreviewError(
            err instanceof Error ? err.message : "Could not load the preview.",
          );
        }
      } finally {
        if (active) setPreviewLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [previewNode]);

  const spaces = useMemo(
    () =>
      Array.from(
        new Map(
          objects
            .filter((object) => object.space_id && object.space_name)
            .map((object) => [
              object.space_id as string,
              { id: object.space_id as string, name: object.space_name as string },
            ]),
        ).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [objects],
  );
  const pages = useMemo(
    () =>
      Array.from(
        new Map(
          objects
            .filter(
              (object) =>
                object.page_id &&
                object.page_title &&
                (spaceFilters.length === 0 ||
                  (object.space_id !== null &&
                    spaceFilters.includes(object.space_id))),
            )
            .map((object) => [
              object.page_id as string,
              { id: object.page_id as string, title: object.page_title as string },
            ]),
        ).values(),
      ).sort((a, b) => a.title.localeCompare(b.title)),
    [objects, spaceFilters],
  );
  const scopedObjects = useMemo(
    () =>
      objects.filter(
        (object) =>
          (kindFilters.length === 0 || kindFilters.includes(object.kind)) &&
          (spaceFilters.length === 0 ||
            (object.space_id !== null &&
              spaceFilters.includes(object.space_id))) &&
          (pageFilters.length === 0 ||
            (object.page_id !== null && pageFilters.includes(object.page_id))),
      ),
    [kindFilters, objects, pageFilters, spaceFilters],
  );
  const tree = useMemo(() => buildTree(scopedObjects), [scopedObjects]);
  const filtered = useMemo(() => filterTree(tree, query), [tree, query]);

  const totalSize = useMemo(
    () => objects.reduce((sum, o) => sum + o.size, 0),
    [objects],
  );

  /** Per-kind counts/sizes for the overview grid, always in KIND_ORDER. */
  const breakdown = useMemo(() => {
    const byKind = new Map<StorageObject["kind"], { count: number; size: number }>(
      KIND_ORDER.map((kind) => [kind, { count: 0, size: 0 }]),
    );
    for (const object of objects) {
      const entry = byKind.get(object.kind);
      if (!entry) continue;
      entry.count += 1;
      entry.size += object.size;
    }
    return byKind;
  }, [objects]);

  async function handleDownload(key: string, name: string) {
    try {
      const { url } = await apiFetch<StoragePresignedUrl>(
        `/api/v1/storage/presign?key=${encodeURIComponent(key)}`,
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not generate download URL.",
      );
    }
  }

  async function handleDelete() {
    if (!deleteKey) return;
    setDeleting(true);
    try {
      const result = await apiFetch<StorageDeleteResult>(
        `/api/v1/storage?key=${encodeURIComponent(deleteKey)}`,
        { method: "DELETE" },
      );
      setObjects((prev) => prev.filter((o) => o.key !== deleteKey));
      const extra: string[] = [];
      if (result.archive_cleared) extra.push("archive hash cleared");
      if (result.attachment_deleted) extra.push("attachment record removed");
      toast.success(
        `Deleted ${deleteKey.split("/").pop()}` +
          (extra.length ? ` (${extra.join(", ")})` : ""),
      );
      setDeleteKey(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not delete the object.",
      );
    } finally {
      setDeleting(false);
    }
  }

  function toggleKindFilter(kind: StorageObject["kind"]) {
    setKindFilters((current) =>
      current.includes(kind)
        ? current.filter((value) => value !== kind)
        : [...current, kind],
    );
  }

  return (
    <>
      {loading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="border-border bg-surface-raised h-11 animate-pulse rounded-lg border"
            />
          ))}
        </div>
      ) : error ? null : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {/* Total: always resets the type filter back to "all". */}
          <button
            type="button"
            onClick={() => setKindFilters([])}
            aria-pressed={kindFilters.length === 0}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-left shadow-sm transition-colors duration-150 cursor-pointer",
              kindFilters.length === 0
                ? "border-primary bg-primary/5 ring-primary/20 ring-1"
                : "border-border bg-surface-raised hover:bg-surface-hover",
            )}
          >
            <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full">
              <Boxes className="size-3.5" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="text-muted-foreground block text-[10px] font-medium uppercase tracking-[0.06em]">
                Total
              </span>
              <span className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-sm font-semibold whitespace-nowrap tabular-nums">
                  {formatBytes(totalSize)}
                </span>
                <span className="text-muted-foreground whitespace-nowrap text-[11px] tabular-nums">
                  {objects.length} object{objects.length === 1 ? "" : "s"}
                </span>
              </span>
            </span>
          </button>

          {/* Per-kind breakdown: doubles as a shortcut for the Type filter. */}
          {KIND_ORDER.map((kind) => {
            const { label, icon: Icon } = KIND_META[kind];
            const stats = breakdown.get(kind) ?? { count: 0, size: 0 };
            const active = kindFilters.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKindFilter(kind)}
                aria-pressed={active}
                title={`Filter by ${label}`}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-left shadow-sm transition-colors duration-150 cursor-pointer",
                  active
                    ? "border-primary bg-primary/5 ring-primary/20 ring-1"
                    : "border-border bg-surface-raised hover:bg-surface-hover",
                )}
              >
                <span className="bg-surface-sunken text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="text-muted-foreground block truncate text-[10px] font-medium uppercase tracking-[0.06em]">
                    {label}
                  </span>
                  <span className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-sm font-semibold whitespace-nowrap tabular-nums">
                      {formatBytes(stats.size)}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap text-[11px] tabular-nums">
                      {stats.count} object{stats.count === 1 ? "" : "s"}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex flex-wrap gap-2">
          <MultiFilter
            label="Type"
            allLabel="All types"
            selected={kindFilters}
            onChange={setKindFilters}
            options={KIND_ORDER.map((kind) => ({ id: kind, label: KIND_META[kind].label }))}
          />
          <MultiFilter
            label="Space"
            allLabel="All spaces"
            selected={spaceFilters}
            onChange={(selected) => {
              setSpaceFilters(selected);
              setPageFilters([]);
            }}
            options={spaces.map((space) => ({
              id: space.id,
              label: space.name,
            }))}
          />
          <MultiFilter
            label="Page"
            allLabel="All pages"
            selected={pageFilters}
            onChange={setPageFilters}
            options={pages.map((page) => ({
              id: page.id,
              label: page.title,
            }))}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-muted-foreground px-1 text-[11px] font-medium">
            Search
          </p>
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by path or filename..."
              className="pl-9"
              aria-label="Filter storage objects"
            />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground px-1 text-[11px] font-medium">
            Actions
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => void fetchObjects()}
            aria-label="Refresh storage list"
          >
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Tree */}
      <div className="border-border bg-surface mt-4 overflow-hidden rounded-xl border shadow-sm">
        {/* Column headers */}
        <div className="border-border bg-surface-sunken flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
          <span className="flex-1">Name / Path</span>
          <span className="w-20 shrink-0 text-right">Size</span>
          <span className="hidden w-36 shrink-0 text-right sm:block">
            Last modified
          </span>
          {/* action buttons placeholder */}
          <span className="w-24 shrink-0" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm">
            <Loader2 className="text-primary size-5 animate-spin" />
            Loading storage objects…
          </div>
        ) : error ? (
          <div className="text-danger py-12 text-center text-sm">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center text-sm">
            {query ? "No objects match your filter." : "The bucket is empty."}
          </div>
        ) : (
          <div>
            {filtered.map((node) =>
              node.kind === "folder" ? (
                <FolderRowWrapper
                  key={node.path}
                  node={node}
                  depth={0}
                  onDelete={setDeleteKey}
                  onDownload={handleDownload}
                  onPreview={setPreviewNode}
                />
              ) : (
                <FileRow
                  key={node.path}
                  node={node}
                  depth={0}
                  onDelete={setDeleteKey}
                  onDownload={handleDownload}
                  onPreview={setPreviewNode}
                />
              ),
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteKey !== null} onOpenChange={() => setDeleteKey(null)}>
        <DialogContent
          title="Delete object?"
          description={
            deleteKey
              ? `${deleteKey}\n\nThis action is permanent. The file will be removed from S3, and any database record referencing this object will also be deleted.`
              : undefined
          }
        >
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setDeleteKey(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={previewNode !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewNode(null);
        }}
      >
        <DialogContent
          title={previewNode?.name ?? "File preview"}
          description={previewNode?.path}
          className="max-w-4xl"
        >
          {previewNode && previewKind(previewNode.name) === "unsupported" ? (
            <div className="bg-surface-sunken border-border rounded-lg border border-dashed px-6 py-12 text-center">
              <FileArchive className="text-muted-foreground mx-auto size-8" />
              <p className="mt-3 text-sm font-medium">Preview is not available</p>
              <p className="text-muted-foreground mt-1 text-sm">
                This file type cannot be viewed in WikiHub. Download it to open it with a compatible application.
              </p>
            </div>
          ) : previewLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
              <Loader2 className="text-primary size-5 animate-spin" />
              Loading preview…
            </div>
          ) : previewError ? (
            <div className="border-danger/30 bg-danger/10 text-danger rounded-lg border px-4 py-8 text-center text-sm">
              {previewError}
            </div>
          ) : previewUrl ? (
            <div className="bg-surface-sunken flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg p-4">
              <img
                src={previewUrl}
                alt={previewNode?.name ?? "Object preview"}
                className="max-h-[64vh] max-w-full object-contain"
              />
            </div>
          ) : previewText !== null ? (
            <pre className="bg-surface-sunken border-border max-h-[70vh] overflow-auto rounded-lg border p-4 font-mono text-xs leading-6 whitespace-pre-wrap">
              {previewText}
            </pre>
          ) : null}
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={!previewNode}
              onClick={() => {
                if (previewNode) {
                  void handleDownload(previewNode.path, previewNode.name);
                }
              }}
            >
              <Download className="size-4" />
              Download file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
