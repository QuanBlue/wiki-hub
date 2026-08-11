import { serverGet } from "@/lib/server-api";
import type { SidebarPermissions, SidebarPermissionsRead } from "@/types/api";

/** The app shell needs this on the server so restricted entries never flash. */
export async function getSidebarPermissions(): Promise<SidebarPermissions> {
  const response = await serverGet<SidebarPermissionsRead>(
    "/api/v1/settings/sidebar-permissions",
  );
  return response.permissions;
}
