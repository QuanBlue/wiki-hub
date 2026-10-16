import { serverGet } from "@/lib/server-api";

export type HostInfo = {
  cpus: number;
  /** 1, 5 and 15 minute load averages. */
  load: number[];
  memory_total: number;
  memory_used: number;
  memory_available: number;
  swap_total: number;
  swap_used: number;
  disk_total: number;
  disk_used: number;
  uptime_seconds: number;
  docker_version: string;
  os: string;
  kernel: string;
  containers_total: number;
  containers_running: number;
  images: number;
};

export type ContainerInfo = {
  id: string;
  name: string;
  image: string;
  /** `running`, `exited`, `restarting`, ... */
  state: string;
  status: string;
  /** The compose project; empty for one started by hand. */
  project: string;
  service: string;
  created: number;
  uptime_seconds: number | null;
  restarts: number;
  /** `healthy`, `unhealthy`, `starting` or empty. */
  health: string;
  cpu_percent: number | null;
  memory_bytes: number | null;
  memory_limit: number | null;
};

export type MonitorOverview = {
  docker_ok: boolean;
  host: HostInfo;
  containers: ContainerInfo[];
};

export type ContainerLogs = { lines: string[] };

/** The first reading, for the server render; `null` when the monitor cannot be reached. */
export async function getMonitorOverview(): Promise<MonitorOverview | null> {
  try {
    return await serverGet<MonitorOverview>("/api/v1/admin/monitor");
  } catch {
    return null;
  }
}
