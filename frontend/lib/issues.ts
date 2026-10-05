import { serverGet } from "@/lib/server-api";
import type { Issue, Page } from "@/types/api";

/** The signed-in user's own issues, newest first. */
export function listMyIssues(
  limit = 20,
  offset = 0,
): Promise<Page<Issue>> {
  return serverGet<Page<Issue>>(
    `/api/v1/issues/mine?limit=${limit}&offset=${offset}`,
  );
}
