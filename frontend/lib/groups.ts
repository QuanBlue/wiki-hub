import { queryString, serverGet } from "@/lib/server-api";
import { api } from "@/lib/api-client";
import type { Group, GroupMember } from "@/types/api";

export function listGroups(query = ""): Promise<Group[]> {
  return serverGet<Group[]>(`/api/v1/groups${queryString({ q: query })}`);
}

export function listGroupMembers(id: string): Promise<GroupMember[]> {
  return api.get<GroupMember[]>(`/api/v1/groups/${encodeURIComponent(id)}/members`);
}
