"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api, ApiError } from "@/lib/api-client";

interface BulkSelectionContextValue {
  active: boolean;
  selected: Set<string>;
  toggle: (id: string) => void;
  clear: () => void;
  setActive: (active: boolean) => void;
  /** Replaces the selection outright with exactly these ids - not a union
   * with whatever was already selected. `SelectionHeaderCell`'s "select
   * all" checkbox is the only caller: it always means "every selectable row
   * on this page", not "everything selected so far plus these". */
  selectAll: (ids: string[]) => void;
}

const BulkSelectionContext = createContext<BulkSelectionContextValue | null>(null);

/**
 * Shared "Select" mode for an admin list: a toggle button next to the
 * search box turns on a checkbox per row and a bulk delete bar, the way
 * both the People directory and the Groups directory need it. One Provider
 * per page - `SelectModeButton` sits next to the search box, checkboxes sit
 * in the table rows, `BulkDeleteBar` sits wherever a full-width banner
 * fits - all three read the same selection through context so they can live
 * in otherwise-unrelated parts of the page tree (a server-rendered table's
 * rows, in the People directory's case).
 */
export function BulkSelectionProvider({ children }: { children: ReactNode }) {
  const [active, setActiveState] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function setActive(next: boolean) {
    setActiveState(next);
    if (!next) setSelected(new Set());
  }
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clear() {
    setSelected(new Set());
  }
  function selectAll(ids: string[]) {
    setSelected(new Set(ids));
  }

  return (
    <BulkSelectionContext.Provider
      value={{ active, selected, toggle, clear, setActive, selectAll }}
    >
      {children}
    </BulkSelectionContext.Provider>
  );
}

function useBulkSelection(): BulkSelectionContextValue {
  const context = useContext(BulkSelectionContext);
  if (!context) throw new Error("useBulkSelection must be used inside BulkSelectionProvider");
  return context;
}

/** `<col>` for the checkbox column, for a `table-fixed` table with its own
 * static `<colgroup>` (a plain `<table>` sizes itself around whatever `<th>`s
 * are actually present, but `table-fixed` maps `<col>`s to columns purely by
 * position - one becoming a static Server Component prop and the other a
 * Select-mode toggle would silently misalign every column after the first
 * table refresh outside Select mode). Render this ahead of the rest of the
 * `<colgroup>`, matching where `SelectionHeaderCell`/`SelectionCell` sit in
 * the `<thead>`/`<tbody>`. */
export function SelectionColumn() {
  const { active } = useBulkSelection();
  if (!active) return null;
  return <col className="w-9" />;
}

export function SelectModeButton() {
  const { active, selected, setActive } = useBulkSelection();
  return (
    <Button type="button" variant={active ? "secondary" : "ghost"} onClick={() => setActive(!active)}>
      {active ? `Cancel${selected.size ? ` (${selected.size})` : ""}` : "Select"}
    </Button>
  );
}

/** Header cell for the checkbox column - rendered only in Select mode, so
 * outside it the table's own leftmost column (Group/User) still lines up
 * with the header row above it instead of leaving a reserved gutter.
 *
 * Pass every selectable id on the current page (skip protected/default/self
 * rows the same way each row's own `SelectionCell` does) and this doubles as
 * a "select all" checkbox: checked once every one of them is selected,
 * indeterminate for a partial selection, and clicking it selects all of
 * them (or clears the selection entirely, if they're all already checked) -
 * a fast way to select everything without a click per row. Omit `ids` (or
 * pass none) to fall back to a plain header cell with no checkbox, for a
 * table with nothing on the page eligible to select. */
export function SelectionHeaderCell({ ids = [] }: { ids?: string[] }) {
  const { active, selected, selectAll, clear } = useBulkSelection();
  if (!active) return null;
  if (ids.length === 0) {
    return (
      <th className="w-9 px-3 py-3">
        <span className="sr-only">Select</span>
      </th>
    );
  }
  const selectedCount = ids.filter((id) => selected.has(id)).length;
  const allSelected = selectedCount === ids.length;
  return (
    <th className="w-9 px-3 py-3">
      <input
        type="checkbox"
        className="border-border text-primary size-4 cursor-pointer rounded"
        checked={allSelected}
        ref={(el) => {
          if (el) el.indeterminate = selectedCount > 0 && !allSelected;
        }}
        onChange={() => (allSelected ? clear() : selectAll(ids))}
        aria-label="Select all rows on this page"
        title="Select all"
      />
    </th>
  );
}

export function SelectionCell({
  id,
  disabled,
  title,
}: {
  id: string;
  disabled?: boolean;
  title?: string;
}) {
  const { active, selected, toggle } = useBulkSelection();
  if (!active) return null;
  return (
    <td className="w-9 px-3 py-3">
      <input
        type="checkbox"
        className="border-border text-primary size-4 cursor-pointer rounded disabled:cursor-not-allowed disabled:opacity-40"
        checked={selected.has(id)}
        disabled={disabled}
        title={title}
        onChange={() => toggle(id)}
        aria-label="Select row"
      />
    </td>
  );
}

/**
 * The bulk action bar: appears once at least one row is checked, deletes
 * every selected id through the same single-item DELETE endpoint the row
 * actions already use (`${deleteEndpointBase}/${id}`), one request per id -
 * there is no dedicated bulk-delete endpoint, and a plain loop lets each
 * item's own guards (protected, self, "last admin", ...) reject just that
 * one instead of failing the whole batch.
 */
export function BulkDeleteBar({
  deleteEndpointBase,
  itemNoun,
  confirmNote,
}: {
  deleteEndpointBase: string;
  itemNoun: string;
  confirmNote?: string;
}) {
  const { active, selected, clear, setActive } = useBulkSelection();
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  if (!active || selected.size === 0) return null;

  async function handleDelete() {
    setPending(true);
    const ids = Array.from(selected);
    let succeeded = 0;
    const failures: string[] = [];
    for (const id of ids) {
      try {
        await api.delete<void>(`${deleteEndpointBase}/${id}`);
        succeeded += 1;
      } catch (error) {
        failures.push(error instanceof ApiError ? error.message : "Unknown error");
      }
    }
    setPending(false);
    setConfirmOpen(false);
    if (succeeded > 0) {
      toast.success(`Deleted ${succeeded} ${itemNoun}${succeeded === 1 ? "" : "s"}.`);
    }
    if (failures.length > 0) {
      toast.error(
        `Could not delete ${failures.length} ${itemNoun}${failures.length === 1 ? "" : "s"}: ${failures[0]}`,
      );
    }
    clear();
    setActive(false);
    router.refresh();
  }

  return (
    <div className="border-border bg-primary-subtle/30 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
      <span className="text-sm font-medium">
        {selected.size} {itemNoun}
        {selected.size === 1 ? "" : "s"} selected
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={pending}>
          Clear
        </Button>
        <Button type="button" size="sm" variant="danger" onClick={() => setConfirmOpen(true)} disabled={pending}>
          Delete selected
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmOpen(false);
        }}
        title={`Delete ${selected.size} ${itemNoun}${selected.size === 1 ? "" : "s"}?`}
        description={confirmNote ?? "This cannot be undone."}
        confirmLabel="Delete selected"
        destructive
        pending={pending}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
