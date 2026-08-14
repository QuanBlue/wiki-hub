import { queryString, serverGet } from "@/lib/server-api";
import type { Group } from "@/types/api";

export function listGroups(query = ""): Promise<Group[]> {
  return serverGet<Group[]>(`/api/v1/groups${queryString({ q: query })}`);
}
