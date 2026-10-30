import { serverGet } from "@/lib/server-api";
import type {
  AnnouncementRead,
  SidebarPermissions,
  SidebarPermissionsRead,
  SystemAnnouncement,
} from "@/types/api";

/** The app shell needs this on the server so restricted entries never flash. */
export async function getSidebarPermissions(): Promise<SidebarPermissions> {
  const response = await serverGet<SidebarPermissionsRead>(
    "/api/v1/settings/sidebar-permissions",
  );
  return response.permissions;
}

/** Active top-of-page system announcement, fetched on SSR to avoid layout shift. */
export async function getSystemAnnouncement(): Promise<SystemAnnouncement | null> {
  try {
    const response = await serverGet<AnnouncementRead>(
      "/api/v1/settings/announcement",
    );
    return response?.announcement ?? null;
  } catch {
    return null;
  }
}
