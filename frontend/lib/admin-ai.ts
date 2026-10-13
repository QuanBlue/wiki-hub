import { serverGet } from "@/lib/server-api";

export type AiConnection = {
  id: string;
  name: string;
  base_url: string;
  model: string;
  /** The key with its middle hidden; the key itself is never sent. */
  api_key_preview: string;
  is_active: boolean;
  last_checked_at: string | null;
  /** `null` until the connection has been checked. */
  last_check_ok: boolean | null;
  created_at: string;
};

export type AiConnectionList = {
  items: AiConnection[];
};

export type AiModelInfo = {
  id: string;
  name: string;
  reasoning: boolean;
  image: boolean;
};

export type AiTestResult = {
  ok: boolean;
  models: AiModelInfo[];
  error: string | null;
};

export function getAiConnections(): Promise<AiConnectionList> {
  return serverGet<AiConnectionList>("/api/v1/ai/connections");
}

export type AiSkill = {
  /** The saved custom instructions; empty when the built-in ones apply. */
  instructions: string;
  default_instructions: string;
  is_custom: boolean;
};

export function getAiSummarySkill(): Promise<AiSkill> {
  return serverGet<AiSkill>("/api/v1/ai/skills/summary");
}

export function getAiPageDraftSkill(): Promise<AiSkill> {
  return serverGet<AiSkill>("/api/v1/ai/skills/page-draft");
}

export function getAiSkill(
  name: "selection-explain" | "selection-translate",
): Promise<AiSkill> {
  return serverGet<AiSkill>(`/api/v1/ai/skills/${name}`);
}
