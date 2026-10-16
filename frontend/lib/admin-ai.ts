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

export type SearchIndexStatus = {
  /** `false` when the database has no pgvector. */
  available: boolean;
  /** `false` until the active connection has an embedding model. */
  enabled: boolean;
  total: number;
  indexed: number;
  /** Why indexing last stopped, when it did. */
  error?: string | null;
};

export type AiModelInfo = {
  id: string;
  name: string;
  reasoning: boolean;
  image: boolean;
  /** An embedding model (text to vectors), not a chat model. */
  embedding?: boolean;
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
  name: "selection-explain" | "selection-translate" | "writing" | "suggestions",
): Promise<AiSkill> {
  return serverGet<AiSkill>(`/api/v1/ai/skills/${name}`);
}

export type EmbeddingSource = "provider" | "custom" | "ollama";

/** One tunable knob, as the server describes it (label, default, bounds). */
export type TuningSpec = {
  key: string;
  label: string;
  default: number | string;
  minimum: number | null;
  maximum: number | null;
  kind: "int" | "float" | "choice";
  choices: string[];
  /** Only matters for the self-hosted Ollama. */
  ollama_only: boolean;
  /** Takes effect only after Ollama restarts. */
  restart: boolean;
};

export type EmbeddingBenchmark = {
  ok: boolean;
  error: string | null;
  passages: number;
  characters: number;
  seconds: number;
  seconds_per_passage: number;
  batch_size: number;
  estimated_minutes_per_100_pages: number;
};

/** Where semantic search gets embeddings - one setting for the whole wiki. */
export type EmbeddingSettings = {
  source: EmbeddingSource;
  /** The other endpoint's address (used when `source` is `custom`). */
  base_url: string;
  /** Its key with the middle hidden; the key itself is never sent. */
  api_key_preview: string;
  has_key: boolean;
  /** Empty when semantic search is off. */
  model: string;
  /** What an administrator changed; `null` for a knob means "the default". */
  tuning: Record<string, number | string | null>;
  /** The values in effect (overrides over defaults). */
  effective: Record<string, number | string>;
  specs: TuningSpec[];
};

export type EmbeddingModelsResult = {
  ok: boolean;
  /** Only models that can create embeddings. */
  models: AiModelInfo[];
  error: string | null;
};

export type OllamaState =
  | "not_installed"
  | "stopped"
  | "installing"
  | "starting"
  | "running"
  | "error"
  | "controller_down"
  | "docker_unavailable";

export type OllamaStatus = {
  state: OllamaState;
  controller_ok: boolean;
  docker_ok: boolean;
  image: string;
  image_bytes: number;
  memory_bytes: number | null;
  cpu_percent?: number | null;
  /** What happened to the last download while Ollama itself is fine (cancelled, refused). */
  notice?: string;
  memory_limit: string;
  volume_present: boolean;
  /** Models Ollama has downloaded. */
  models: string[];
  /** The embedding models WikiHub offers to download. */
  available_models: { name: string; note: string }[];
  /** Cores on the machine, to bound the CPU setting. */
  host_cpus: number;
  /** What the running container was created with. */
  applied_memory_mb: number | null;
  applied_cpus: number | null;
  applied_keep_alive: string | null;
  /** The saved Ollama settings differ from what runs: restart to apply. */
  restart_needed: boolean;
  /** While installing: `image`, `start`, `ready` or `model`. */
  step: string;
  percent: number;
  overall: number;
  message: string;
  model: string;
  current: number;
  total: number;
  error: string;
};

export function getEmbeddingSettings(): Promise<EmbeddingSettings> {
  return serverGet<EmbeddingSettings>("/api/v1/ai/embedding");
}
