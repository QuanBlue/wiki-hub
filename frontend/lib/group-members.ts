import { api } from "@/lib/api-client";
import type { GroupMember, GroupUsage } from "@/types/api";

/** Client-safe group membership fetcher used by the interactive manager. */
export function listGroupMembers(id: string): Promise<GroupMember[]> {
  return api.get<GroupMember[]>(`/api/v1/groups/${encodeURIComponent(id)}/members`);
}

/** Every Space/Page this group is currently granted access to - backs the
 * Edit Group dialog's "Used in" tab, and what `delete_group`'s
 * `group_in_use` error refers to. */
export function getGroupUsage(id: string): Promise<GroupUsage> {
  return api.get<GroupUsage>(`/api/v1/groups/${encodeURIComponent(id)}/usage`);
}
