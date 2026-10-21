"use client";

import {
  ChevronDown,
  Cpu,
  Database,
  Gauge,
  Loader2,
  Network,
  RotateCcw,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  EmbeddingBenchmark,
  EmbeddingSource,
  TuningSpec,
} from "@/lib/admin-ai";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/** What the form holds per knob: `""` means "use the default". */
export type TuningDraft = Record<string, string>;

const GROUPS: {
  id: string;
  icon: LucideIcon;
  keys: string[];
  ollama?: boolean;
}[] = [
  {
    id: "indexing",
    icon: Database,
    keys: [
      "index_batch",
      "embed_batch_size",
      "max_chunks_per_page",
      "embed_timeout_seconds",
    ],
  },
  {
    id: "searching",
    icon: Search,
    keys: ["query_timeout_seconds", "min_similarity", "margin"],
  },
  {
    id: "graph",
    icon: Network,
    keys: ["graph_related_pages", "graph_min_similarity"],
  },
  {
    id: "ollama",
    icon: Cpu,
    keys: ["ollama_memory_gb", "ollama_cpus", "ollama_keep_alive"],
    ollama: true,
  },
];

/** The unit shown inside each number box (an i18n key); none for a 0-1 score. */
const UNITS: Record<string, string> = {
  index_batch: "pagesPerMinute",
  embed_batch_size: "passages",
  max_chunks_per_page: "passages",
  embed_timeout_seconds: "seconds",
  query_timeout_seconds: "seconds",
  graph_related_pages: "pages",
  ollama_memory_gb: "gb",
  ollama_cpus: "cores",
};

const DEFAULT_CHOICE = "__default__";

/** The draft for a settings row: what is saved, as text (`""` where the default applies). */
export function draftFrom(
  tuning: Record<string, number | string | null>,
): TuningDraft {
  const draft: TuningDraft = {};
  for (const [key, value] of Object.entries(tuning))
    draft[key] = value === null ? "" : String(value);
  return draft;
}

/** What to send to save: only the knobs that differ from what is saved, `null` to reset one. */
export function changesFrom(
  draft: TuningDraft,
  saved: Record<string, number | string | null>,
  specs: TuningSpec[],
): Record<string, number | string | null> | undefined {
  const changes: Record<string, number | string | null> = {};
  for (const spec of specs) {
    const text = (draft[spec.key] ?? "").trim();
    const before =
      saved[spec.key] === null || saved[spec.key] === undefined
        ? ""
        : String(saved[spec.key]);
    if (text === before) continue;
    if (text === "") changes[spec.key] = null;
    else changes[spec.key] = spec.kind === "choice" ? text : Number(text);
  }
  return Object.keys(changes).length ? changes : undefined;
}

/** A message when a typed value is outside what the server will accept; `null` when fine. */
export function problemWith(
  spec: TuningSpec,
  text: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string | null {
  const value = text.trim();
  if (value === "" || spec.kind === "choice") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return t("adminAi.tuneNotANumber");
  if (spec.kind === "int" && !Number.isInteger(number))
    return t("adminAi.tuneNotAWholeNumber");
  const { minimum, maximum } = spec;
  if (
    (minimum !== null && number < minimum) ||
    (maximum !== null && number > maximum)
  ) {
    return t("adminAi.tuneOutOfRange", {
      min: minimum ?? "-",
      max: maximum ?? "-",
    });
  }
  return null;
}

function Field({
  spec,
  value,
  onChange,
  hostCpus,
}: {
  spec: TuningSpec;
  value: string;
  onChange: (value: string) => void;
  hostCpus: number;
}) {
  const { t } = useTranslation();
  const problem = problemWith(spec, value, t);
  const overridden = value.trim() !== "";
  const id = `tune-${spec.key}`;
  const label = t(`adminAi.tune_${spec.key}`);
  const unit = UNITS[spec.key];
  // The CPU limit cannot exceed the machine's cores, which only the server knows.
  const maximum =
    spec.key === "ollama_cpus" && hostCpus > 0 ? hostCpus : spec.maximum;

  return (
    <div className="min-w-0">
      <div className="mb-1 flex h-5 items-center gap-1">
        <Label
          htmlFor={id}
          className={cn(
            "truncate text-xs font-medium",
            overridden && "text-primary",
          )}
        >
          {label}
        </Label>
        <InfoTip>
          <span className="font-medium">
            {t(`adminAi.tuneShort_${spec.key}`)}
          </span>{" "}
          {t(`adminAi.tuneHelp_${spec.key}`)}
        </InfoTip>
        {overridden ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={t("adminAi.tuneReset", { name: label })}
            title={t("adminAi.tuneReset", { name: label })}
            className="text-muted-foreground hover:text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring ml-auto inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            <RotateCcw className="size-3" aria-hidden />
          </button>
        ) : null}
      </div>
      {spec.kind === "choice" ? (
        <Select
          value={value || DEFAULT_CHOICE}
          onValueChange={(next) =>
            onChange(next === DEFAULT_CHOICE ? "" : next)
          }
        >
          <SelectTrigger id={id} aria-label={label} className="h-8 text-sm">
            <SelectValue>
              {value
                ? t(`adminAi.tuneKeepAlive_${value}`)
                : t("adminAi.tuneDefaultValue", {
                    value: t(`adminAi.tuneKeepAlive_${spec.default}`),
                  })}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value={DEFAULT_CHOICE}>
              {t("adminAi.tuneDefaultValue", {
                value: t(`adminAi.tuneKeepAlive_${spec.default}`),
              })}
            </SelectItem>
            {spec.choices.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {t(`adminAi.tuneKeepAlive_${choice}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="relative">
          <Input
            id={id}
            inputMode="decimal"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t("adminAi.tuneDefaultValue", {
              value:
                spec.key === "ollama_cpus" && spec.default === 0
                  ? t("adminAi.tuneAllCores")
                  : String(spec.default),
            })}
            aria-invalid={Boolean(problem)}
            aria-describedby={problem ? `${id}-problem` : undefined}
            autoComplete="off"
            className={cn(
              "h-8 text-sm tabular-nums",
              unit && "pr-[4.5rem]",
              overridden && !problem && "border-primary/50",
              problem && "border-danger",
            )}
          />
          {unit ? (
            <span
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px]"
            >
              {t(`adminAi.tuneUnit_${unit}`)}
            </span>
          ) : null}
        </div>
      )}
      {problem ? (
        <p
          id={`${id}-problem`}
          role="alert"
          className="text-danger mt-1 text-xs"
        >
          {spec.key === "ollama_cpus" && maximum !== null
            ? t("adminAi.tuneOutOfRange", {
                min: spec.minimum ?? 0,
                max: maximum,
              })
            : problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Administration > AI assistant > Semantic search > Performance & tuning.
 *
 * Every number that used to live in an environment variable: how many pages are
 * indexed a minute, how big a request is, how patient to be with a slow CPU, how
 * close a match has to be - and, for the self-hosted Ollama, its memory, cores and
 * how long it keeps the model loaded. A blank field means "the default".
 */
export function TuningFields({
  specs,
  draft,
  onChange,
  source,
  hostCpus,
  canBenchmark,
}: {
  specs: TuningSpec[];
  draft: TuningDraft;
  onChange: (key: string, value: string) => void;
  source: EmbeddingSource;
  hostCpus: number;
  /** A saved model exists, so a speed test is meaningful. */
  canBenchmark: boolean;
}) {
  const { t, apiErrorText } = useTranslation();
  const [bench, setBench] = useState<
    EmbeddingBenchmark | { running: true } | null
  >(null);
  const byKey = new Map(specs.map((spec) => [spec.key, spec]));
  const groups = GROUPS.filter((group) => !group.ollama || source === "ollama");
  const changedIn = (keys: string[]) =>
    keys.filter((key) => byKey.has(key) && (draft[key] ?? "").trim() !== "")
      .length;
  const changed = changedIn(groups.flatMap((group) => group.keys));

  async function runBenchmark() {
    setBench({ running: true });
    try {
      setBench(
        await api.post<EmbeddingBenchmark>("/api/v1/ai/embedding/benchmark"),
      );
    } catch (error) {
      setBench({
        ok: false,
        error: apiErrorText(error, "adminAi.benchmarkError"),
        passages: 0,
        characters: 0,
        seconds: 0,
        seconds_per_passage: 0,
        batch_size: 0,
        estimated_minutes_per_100_pages: 0,
      });
    }
  }

  const running = bench !== null && "running" in bench;

  return (
    <details className="border-border bg-surface group rounded-xl border">
      <summary className="hover:bg-surface-hover focus-visible:ring-ring flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none">
        <span className="flex min-w-0 items-center gap-2">
          <Gauge
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
          {t("adminAi.tuneTitle")}
          {changed ? (
            <Badge variant="info" className="text-[10px]">
              {t("adminAi.tuneChanged", { count: changed })}
            </Badge>
          ) : (
            <span className="text-muted-foreground hidden truncate text-xs font-normal sm:inline">
              {t("adminAi.tuneAllDefaults")}
            </span>
          )}
        </span>
        <ChevronDown
          className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <div className="border-border space-y-4 border-t px-4 py-3">
        <p className="text-muted-foreground text-xs">
          {t("adminAi.tuneIntro")}
        </p>

        <div className="bg-surface-sunken flex flex-col gap-2 rounded-lg px-3 py-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs">
              {canBenchmark
                ? t("adminAi.benchmarkHint")
                : t("adminAi.benchmarkNeedsModel")}
            </p>
            {bench !== null && !("running" in bench) ? (
              bench.ok ? (
                <p role="status" className="text-foreground mt-1.5 text-sm">
                  {t("adminAi.benchmarkResult", {
                    passages: bench.passages,
                    seconds: bench.seconds,
                    each: bench.seconds_per_passage,
                    batch: bench.batch_size,
                    minutes: bench.estimated_minutes_per_100_pages,
                  })}
                </p>
              ) : (
                <p role="alert" className="text-danger mt-1.5 text-sm">
                  {bench.error}
                </p>
              )
            ) : null}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void runBenchmark()}
            disabled={!canBenchmark || running}
            className="shrink-0 self-start sm:self-center"
          >
            {running ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Gauge aria-hidden />
            )}
            {t("adminAi.benchmarkRun")}
          </Button>
        </div>

        {groups.map((group) => {
          const fields = group.keys
            .map((key) => byKey.get(key))
            .filter((spec): spec is TuningSpec => Boolean(spec));
          if (!fields.length) return null;
          const Icon = group.icon;
          const count = changedIn(group.keys);
          return (
            <fieldset
              key={group.id}
              className="border-border border-t pt-3 first-of-type:border-t-0 first-of-type:pt-0"
            >
              <legend className="sr-only">
                {t(`adminAi.tuneGroup_${group.id}`)}
              </legend>
              <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <Icon className="text-primary size-3.5 shrink-0" aria-hidden />
                <span className="text-foreground text-xs font-semibold tracking-[0.06em] uppercase">
                  {t(`adminAi.tuneGroup_${group.id}`)}
                </span>
                {count ? (
                  <Badge variant="info" className="text-[10px] font-medium">
                    {t("adminAi.tuneChanged", { count })}
                  </Badge>
                ) : null}
                {group.ollama ? (
                  <Badge variant="warning" className="text-[10px] font-medium">
                    {t("adminAi.tuneNeedsRestart")}
                  </Badge>
                ) : null}
                <span className="text-muted-foreground hidden min-w-0 truncate text-xs md:inline">
                  {t(`adminAi.tuneGroupHint_${group.id}`)}
                </span>
              </div>
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
                {fields.map((spec) => (
                  <Field
                    key={spec.key}
                    spec={spec}
                    value={draft[spec.key] ?? ""}
                    onChange={(value) => onChange(spec.key, value)}
                    hostCpus={hostCpus}
                  />
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </details>
  );
}
