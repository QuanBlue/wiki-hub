import type { Metadata } from "next";

import { SpaceRowActions } from "@/components/admin/space-row-actions";
import { Badge } from "@/components/ui/badge";
import { listSpaces } from "@/lib/spaces";

export const metadata: Metadata = { title: "Spaces" };
export const dynamic = "force-dynamic";

export default async function AdminSpacesPage() {
  const spaces = await listSpaces(true);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Spaces</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Review and manage documentation spaces. Permanent deletion is available only here.
        </p>
      </div>

      <div className="border-border bg-surface overflow-x-auto rounded-xl border shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border bg-surface-sunken text-muted-foreground border-b text-left">
              <th className="px-4 py-3 font-medium">Space</th>
              <th className="px-4 py-3 font-medium">Members</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {spaces.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted-foreground px-4 py-8 text-center">
                  No spaces yet.
                </td>
              </tr>
            ) : (
              spaces.map((space) => (
                <tr
                  key={space.id}
                  className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0"
                >
                  <td className="px-4 py-3">
                    <span className="mr-2" aria-hidden>{space.icon || "▦"}</span>
                    <span className="font-medium">{space.name}</span>
                    <span className="text-muted-foreground ml-2">{space.key}</span>
                  </td>
                  <td className="text-muted-foreground px-4 py-3">{space.member_count}</td>
                  <td className="px-4 py-3">
                    <Badge variant={space.status === "active" ? "success" : "warning"}>
                      {space.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3"><SpaceRowActions space={space} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
