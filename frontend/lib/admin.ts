import { queryString, serverGet } from "@/lib/server-api";
import type { Page, SiteSettings, User } from "@/types/api";

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

export function getSiteSettings(): Promise<SiteSettings> {
  return serverGet<SiteSettings>("/api/v1/settings");
}
