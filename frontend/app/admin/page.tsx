import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";

/**
 * /admin has no content of its own - land on the first section this visitor
 * can actually use. A `system_admin` (or superuser) always gets Users, same
 * as before; a `manage_users`/`manage_groups`-only admin (see
 * `app/admin/layout.tsx` for why those two, and only those two, reach here
 * at all without `system_admin`) would otherwise land on Users only to be
 * turned away by its own page-level check.
 */
export default async function AdminIndexPage() {
  const user = await getCurrentUser();
  const isSystemAdmin =
    user?.is_superuser || user?.global_permissions.includes("system_admin");

  if (isSystemAdmin || user?.global_permissions.includes("manage_users")) {
    redirect("/admin/users");
  }
  if (user?.global_permissions.includes("manage_groups")) {
    redirect("/admin/groups");
  }
  redirect("/admin/users");
}
