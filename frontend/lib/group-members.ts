import { api } from "@/lib/api-client";
import type { GroupMember } from "@/types/api";

/** Client-safe group membership fetcher used by the interactive manager. */
export function listGroupMembers(id: string): Promise<GroupMember[]> {
  return api.get<GroupMember[]>(`/api/v1/groups/${encodeURIComponent(id)}/members`);
}
