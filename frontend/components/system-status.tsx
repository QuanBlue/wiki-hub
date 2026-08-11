import { AlertCircle, CheckCircle2, CircleSlash } from "lucide-react";

import type {
  DependencyStatus,
  InstanceInfo,
  ReadinessResponse,
} from "@/types/api";

const DEPENDENCY_LABELS: Record<string, string> = {
  database: "PostgreSQL",
  redis: "Redis",
  object_storage: "Object storage (S3/MinIO)",
};

function StatusIcon({ status }: { status: DependencyStatus }) {
  if (status === "ok") {
    return <CheckCircle2 className="text-success size-4" aria-hidden />;
  }
  return <AlertCircle className="text-danger size-4" aria-hidden />;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function SystemStatus({
  instance,
  readiness,
}: {
  instance: InstanceInfo | null;
  readiness: ReadinessResponse | null;
}) {
  if (!instance && !readiness) {
    return (
      <section className="border-border bg-danger-bg rounded-lg border p-4">
        <h2 className="text-danger flex items-center gap-2 font-medium">
          <CircleSlash className="size-4" />
          API unreachable
        </h2>
        <p className="text-muted-foreground mt-1">
          The WikiHub API did not respond. Start the stack with{" "}
          <code className="bg-surface-sunken rounded px-1 py-0.5 font-mono text-xs">
            docker compose up -d
          </code>{" "}
          and reload this page.
        </p>
      </section>
    );
  }

  const checks = Object.entries(readiness?.checks ?? {});

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="border-border bg-surface rounded-lg border p-4">
        <h2 className="font-medium">Dependencies</h2>
        {checks.length === 0 ? (
          <p className="text-muted-foreground mt-2">
            The readiness probe reported a degraded state without details.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {checks.map(([name, status]) => (
              <li key={name} className="flex items-center gap-2">
                <StatusIcon status={status} />
                <span className="flex-1">
                  {DEPENDENCY_LABELS[name] ?? name}
                </span>
                <span className="text-muted-foreground font-mono text-xs">
                  {status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {instance && (
        <section className="border-border bg-surface rounded-lg border p-4">
          <h2 className="font-medium">Instance</h2>
          <dl className="mt-3 space-y-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-mono text-xs">{instance.version}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Environment</dt>
              <dd className="font-mono text-xs">{instance.environment}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Max upload</dt>
              <dd className="font-mono text-xs">
                {formatBytes(instance.max_upload_size_bytes)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Import formats</dt>
              <dd className="font-mono text-xs">
                {instance.features.imports.join(", ")}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Export formats</dt>
              <dd className="font-mono text-xs">
                {instance.features.exports.join(", ")}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
