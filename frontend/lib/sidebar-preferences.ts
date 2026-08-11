import "server-only";

import { cookies } from "next/headers";

const COLLAPSED_COOKIE = "wikihub_sidebar_collapsed";
const APP_WIDTH_COOKIE = "wikihub_sidebar_width";
const SPACE_WIDTH_COOKIE = "wikihub_space_sidebar_width";

function readWidth(
  value: string | undefined,
  fallback: number,
  minimum: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(520, Math.max(minimum, parsed))
    : fallback;
}

/**
 * Cookies are readable while rendering server components. Using them for the
 * initial snapshot means the HTML already matches the saved navigation state;
 * localStorage remains only the client-side preference store.
 */
export async function getSidebarPreferences(): Promise<{
  collapsed: boolean;
  appWidth: number;
  spaceWidth: number;
}> {
  const store = await cookies();
  return {
    collapsed: store.get(COLLAPSED_COOKIE)?.value === "true",
    appWidth: readWidth(store.get(APP_WIDTH_COOKIE)?.value, 256, 0),
    spaceWidth: readWidth(store.get(SPACE_WIDTH_COOKIE)?.value, 320, 200),
  };
}
