"use client";

import { ChevronDown, Gauge, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";

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

const GROUPS: { id: string; keys: string[]; ollama?: boolean }[] = [
  {
    id: "indexing",
    keys: [
      "index_batch",
      "embed_batch_size",
      "max_chunks_per_page",
      "embed_timeout_seconds",
    ],
  },
  {
    id: "searching",
    keys: ["query_timeout_seconds", "min_similarity", "margin"],
  },
  {
    id: "ollama",
    keys: ["ollama_memory_gb", "ollama_cpus", "ollama_keep_alive"],
    ollama: true,
  },
];

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
  // The CPU limit cannot exceed the machine's cores, which only the server knows.
  const maximum =
    spec.key === "ollama_cpus" && hostCpus > 0 ? hostCpus : spec.maximum;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{label}</Label>
        <InfoTip>{t(`adminAi.tuneHelp_${spec.key}`)}</InfoTip>
        {spec.restart ? (
          <span className="text-muted-foreground border-border rounded border px-1 text-[10px]">
            {t("adminAi.tuneNeedsRestart")}
          </span>
        ) : null}
        {overridden ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={t("adminAi.tuneReset", { name: label })}
            title={t("adminAi.tuneReset", { name: label })}
            className="text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring ml-auto inline-flex size-6 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            <RotateCcw className="size-3.5" aria-hidden />
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
          <SelectTrigger id={id} aria-label={label}>
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
          className={cn(problem && "border-danger")}
        />
      )}
      {problem ? (
        <p id={`${id}-problem`} role="alert" className="text-danger text-xs">
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

  return (
    <details className="border-border bg-surface group rounded-xl border">
      <summary className="hover:bg-surface-hover focus-visible:ring-ring flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none">
        <span className="flex items-center gap-2">
          <Gauge className="text-muted-foreground size-4" aria-hidden />
          {t("adminAi.tuneTitle")}
        </span>
        <ChevronDown
          className="text-muted-foreground size-4 transition-transform duration-150 group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <div className="border-border space-y-5 border-t px-4 py-4">
        <p className="text-muted-foreground text-sm">
          {t("adminAi.tuneIntro")}
        </p>

        {GROUPS.filter((group) => !group.ollama || source === "ollama").map(
          (group) => {
            const fields = group.keys
              .map((key) => byKey.get(key))
              .filter((spec): spec is TuningSpec => Boolean(spec));
            return (
              <fieldset key={group.id} className="space-y-3">
                <legend className="text-muted-foreground mb-1 text-xs font-semibold tracking-[0.06em] uppercase">
                  {t(`adminAi.tuneGroup_${group.id}`)}
                </legend>
                <div className="grid gap-4 sm:grid-cols-2">
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
          },
        )}

        <div className="border-border space-y-2 border-t pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void runBenchmark()}
              disabled={!canBenchmark || (bench !== null && "running" in bench)}
            >
              {bench !== null && "running" in bench ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Gauge aria-hidden />
              )}
              {t("adminAi.benchmarkRun")}
            </Button>
            <p className="text-muted-foreground text-xs">
              {canBenchmark
                ? t("adminAi.benchmarkHint")
                : t("adminAi.benchmarkNeedsModel")}
            </p>
          </div>
          {bench !== null && !("running" in bench) ? (
            bench.ok ? (
              <p role="status" className="text-sm">
                {t("adminAi.benchmarkResult", {
                  passages: bench.passages,
                  seconds: bench.seconds,
                  each: bench.seconds_per_passage,
                  batch: bench.batch_size,
                  minutes: bench.estimated_minutes_per_100_pages,
                })}
              </p>
            ) : (
              <p role="alert" className="text-danger text-sm">
                {bench.error}
              </p>
            )
          ) : null}
        </div>
      </div>
    </details>
  );
}
