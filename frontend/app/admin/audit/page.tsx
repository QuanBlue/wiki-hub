import type { Metadata } from "next";
import { Suspense } from "react";

import {
  ListFilters,
  PaginationControls,
} from "@/components/admin/list-controls";
import { Badge } from "@/components/ui/badge";
import { listAuditActions, listAuditLogs } from "@/lib/admin";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** Colour the outcome, not just the words. */
function toneFor(action: string): "danger" | "warning" | "success" | "neutral" {
  if (action.includes("deleted")) return "danger";
  if (action.includes("deactivated") || action.includes("archived"))
    return "warning";
  if (action.includes("created")) return "success";
  return "neutral";
}

function summarise(details: Record<string, unknown>): string {
  const changes = details["changes"];
  if (changes && typeof changes === "object") {
    return Object.entries(
      changes as Record<string, { from?: unknown; to?: unknown }>,
    )
      .map(
        ([field, change]) =>
          `${field}: ${String(change.from)} → ${String(change.to)}`,
      )
      .join(", ");
  }
  const parts = Object.entries(details)
    .filter(([, value]) => typeof value !== "object")
    .map(([key, value]) => `${key}: ${String(value)}`);
  return parts.join(", ");
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : (value ?? "");
  };

  const q = single("q");
  const action = single("action");
  const offset = Number.parseInt(single("offset") || "0", 10) || 0;

  const [page, actions] = await Promise.all([
    listAuditLogs({ q, action, limit: PAGE_SIZE, offset }),
    listAuditActions(),
  ]);

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-sm">
        A record of privileged operations. Entries are written in the same
        transaction as the action itself and can never be edited or deleted.
      </p>

      <Suspense fallback={null}>
        <ListFilters
          searchValue={q}
          searchPlaceholder="Search actor or target…"
          filters={[
            {
              name: "action",
              label: "Action",
              value: action,
              options: actions.map((value) => ({
                value,
                label: value.replaceAll("_", " "),
              })),
            },
          ]}
        />
      </Suspense>

      <div className="border-border bg-surface overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-border border-b text-left">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {page.items.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="text-muted-foreground px-4 py-8 text-center"
                >
                  No audit entries match these filters.
                </td>
              </tr>
            ) : (
              page.items.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0"
                >
                  <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {entry.actor_username}
                    {/*
                      Without this the row reads "alice deleted the space" when
                      an administrator did it while impersonating alice — the
                      exact accountability gap impersonation would otherwise
                      open.
                    */}
                    {entry.impersonator_username ? (
                      <Badge
                        variant="warning"
                        className="ml-1.5"
                        title={`Performed by ${entry.impersonator_username} while impersonating ${entry.actor_username}`}
                      >
                        via {entry.impersonator_username}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={toneFor(entry.action)}>
                      {entry.action.replaceAll("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {entry.entity_label || "—"}
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      {entry.entity_type}
                    </span>
                  </td>
                  <td className="text-muted-foreground max-w-md truncate px-4 py-3">
                    {summarise(entry.details) || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Suspense fallback={null}>
        <PaginationControls
          total={page.total}
          limit={page.limit}
          offset={page.offset}
        />
      </Suspense>
    </div>
  );
}
