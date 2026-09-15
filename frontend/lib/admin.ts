import { queryString, serverGet } from "@/lib/server-api";
import type { AdminAccount, Page, SiteSettings, User } from "@/types/api";

export interface UserQuery {
  q?: string;
  status?: string;
  role?: string;
  limit?: number;
  offset?: number;
}

export function listUsers(query: UserQuery = {}): Promise<Page<User>> {
  return serverGet<Page<User>>(
    `/api/v1/users${queryString({
      q: query.q,
      status: query.status,
      role: query.role,
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
    })}`,
  );
}

/**
 * Admin assignment controls need the complete people directory, not just the
 * first API page. Keep the API's bounded page size and fetch successive pages
 * so larger workspaces do not silently omit people from owner/member pickers.
 */
export async function listAllUsers(): Promise<User[]> {
  const users: User[] = [];
  const limit = 200;
  let offset = 0;

  while (true) {
    const page = await listUsers({ limit, offset });
    users.push(...page.items);
    if (users.length >= page.total || page.items.length < limit) return users;
    offset += page.items.length;
  }
}

export function getSiteSettings(): Promise<SiteSettings> {
  return serverGet<SiteSettings>("/api/v1/settings");
}

/** Every account that currently holds system_admin, however it got there -
 * see `AdminAccount.admin_source`. Registered ahead of `GET /{user_id}` on
 * the backend, so this literal path is safe to call directly. */
export function listAdministrators(): Promise<AdminAccount[]> {
  return serverGet<AdminAccount[]>("/api/v1/users/administrators");
}

/** Every account with at least one Global Access override, with
 * `global_permission_overrides` actually populated - unlike `listUsers`'s
 * own rows, which never carry it (see `_read_user`'s docstring on the
 * backend). Also registered ahead of `GET /{user_id}`. */
export function listPermissionOverrideUsers(): Promise<User[]> {
  return serverGet<User[]>("/api/v1/users/permission-overrides");
}
