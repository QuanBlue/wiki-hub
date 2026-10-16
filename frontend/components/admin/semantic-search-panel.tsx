"use client";

import {
  CircleAlert,
  CloudDownload,
  Cpu,
  Download,
  Loader2,
  ScanSearch,
  Server,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { OllamaCard, useOllama } from "@/components/admin/ollama-card";
import { OllamaModelLabel } from "@/components/admin/ollama-model-label";
import {
  changesFrom,
  draftFrom,
  problemWith,
  TuningFields,
  type TuningDraft,
} from "@/components/admin/tuning-fields";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  EmbeddingModelsResult,
  EmbeddingSettings,
  EmbeddingSource,
  OllamaStatus,
  SearchIndexStatus,
} from "@/lib/admin-ai";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

// Radix items cannot have an empty value, so "off" gets a marker.
const MODEL_OFF = "__off__";

/** A model name without the implicit ":latest" tag. */
const base = (name: string) => name.replace(/:latest$/, "");

type Models =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; ids: string[] }
  | { state: "error"; message: string };

/** A plain-language explanation for the HTTP status in an indexing error. */
function indexErrorKey(error: string): string {
  const status = /HTTP (\d{3})/.exec(error)?.[1];
  if (status === "401" || status === "403") return "adminAi.semanticErrorAuth";
  if (status === "404" || status === "400" || status === "422") {
    return "adminAi.semanticErrorUnsupported";
  }
  if (
    status === "429" ||
    status?.startsWith("5") ||
    /Timeout|Connect/.test(error)
  ) {
    return "adminAi.semanticErrorBusy";
  }
  return "adminAi.semanticErrorGeneric";
}

function NoteRow({ children, tone }: { children: ReactNode; tone?: "danger" }) {
  const Icon = tone === "danger" ? TriangleAlert : ScanSearch;
  return (
    <div className="border-border bg-surface-sunken flex items-start gap-2.5 rounded-xl border px-4 py-3">
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "danger" ? "text-danger" : "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </div>
  );
}

/** Whether semantic search is on and how far indexing has got (refreshed while it catches up). */
function IndexStatusNote({
  model,
  onFix,
}: {
  model: string;
  onFix: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SearchIndexStatus | null>(null);

  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const next = await api.get<SearchIndexStatus>(
          "/api/v1/ai/search-index",
        );
        if (cancelled) return;
        setStatus(next);
        if (next.enabled && next.indexed < next.total)
          timer = setTimeout(load, 15000);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [model]);

  if (!model) {
    return (
      <NoteRow>
        <p className="text-muted-foreground text-sm">
          {t("adminAi.semanticOff")}
        </p>
      </NoteRow>
    );
  }
  if (!status) return null;
  if (!status.available) {
    return (
      <NoteRow>
        <p className="text-muted-foreground text-sm">
          {t("adminAi.semanticUnavailable")}
        </p>
      </NoteRow>
    );
  }
  if (status.error) {
    return (
      <NoteRow tone="danger">
        <div role="alert" className="space-y-1">
          <p className="text-danger text-sm font-medium">
            {t("adminAi.semanticErrorTitle")}
          </p>
          <p className="text-muted-foreground text-sm">
            {t(indexErrorKey(status.error))}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("adminAi.semanticErrorReason")}{" "}
            <code className="bg-surface text-foreground border-border rounded border px-1 py-0.5 font-mono">
              {status.error.replace(/\.$/, "")}
            </code>
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onFix}>
          {t("adminAi.semanticErrorAction")}
        </Button>
      </NoteRow>
    );
  }
  if (status.indexed >= status.total) {
    return (
      <NoteRow>
        <p className="text-muted-foreground text-sm">
          {t("adminAi.semanticReady", { total: status.total })}
        </p>
      </NoteRow>
    );
  }
  const percent = Math.floor((status.indexed / status.total) * 100);
  return (
    <NoteRow>
      <div className="text-muted-foreground flex items-center justify-between gap-3 text-sm">
        <span>{t("adminAi.semanticIndexing")}</span>
        <span className="tabular-nums">
          {status.indexed}/{status.total} ({percent}%)
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("adminAi.semanticIndexingAria", { percent })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="bg-surface border-border h-2 overflow-hidden rounded-full border"
      >
        <div
          className="bg-info h-full duration-150 motion-safe:transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </NoteRow>
  );
}

function SourceCard({
  selected,
  onSelect,
  icon: Icon,
  title,
  body,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: typeof Server;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "focus-visible:ring-ring flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
        selected
          ? "border-primary bg-surface-selected"
          : "border-border bg-surface hover:bg-surface-hover active:bg-surface-selected",
      )}
    >
      <span
        className={cn(
          "flex items-center gap-2 text-sm font-medium",
          selected && "text-primary",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        {title}
      </span>
      <span className="text-muted-foreground text-xs">{body}</span>
    </button>
  );
}

/**
 * Administration > AI assistant > Semantic search: where page text is turned into
 * vectors. One setting for the whole wiki, separate from the chat providers, so
 * changing the chat provider never changes (or rebuilds) the search index.
 */
export function SemanticSearchPanel({
  initial,
  visible = true,
}: {
  initial: EmbeddingSettings;
  /** The panel stays mounted while its tab is hidden; it does nothing until shown. */
  visible?: boolean;
}) {
  const { t, apiErrorText } = useTranslation();
  const [saved, setSaved] = useState(initial);
  const [source, setSource] = useState<EmbeddingSource>(initial.source);
  const [baseUrl, setBaseUrl] = useState(initial.base_url);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(initial.model);
  const [models, setModels] = useState<Models>({ state: "idle" });
  const [saving, setSaving] = useState(false);
  const [tuning, setTuning] = useState<TuningDraft>(() =>
    draftFrom(initial.tuning),
  );
  // The model being downloaded before it is saved as the embedding model.
  const [awaiting, setAwaiting] = useState("");
  const requestId = useRef(0);
  const ollama = useOllama(source === "ollama" && visible);

  const ollamaRunning = ollama.status?.state === "running";
  const hasKey = Boolean(apiKey) || (saved.has_key && source === "custom");

  const loadModels = useCallback(
    async (which: EmbeddingSource, url: string, key: string) => {
      const id = ++requestId.current;
      setModels({ state: "loading" });
      try {
        const result = await api.post<EmbeddingModelsResult>(
          "/api/v1/ai/embedding/models",
          {
            source: which,
            base_url: url,
            api_key: key,
          },
        );
        if (id !== requestId.current) return;
        setModels(
          result.ok
            ? { state: "ok", ids: result.models.map((m) => m.id) }
            : {
                state: "error",
                message: result.error ?? t("adminAi.semanticFetchFailed"),
              },
        );
      } catch (error) {
        if (id !== requestId.current) return;
        setModels({
          state: "error",
          message: apiErrorText(error, "adminAi.semanticFetchFailed"),
        });
      }
    },
    [apiErrorText, t],
  );

  // Models follow the source: the provider's and Ollama's list themselves (once Ollama
  // is running); another endpoint is fetched when asked, or once on open if it was saved.
  useEffect(() => {
    const wanted =
      visible &&
      (source === "provider" ||
        (source === "ollama" && ollamaRunning) ||
        (source === "custom" &&
          saved.has_key &&
          saved.base_url !== "" &&
          saved.source === "custom"));
    if (!wanted) return;
    const timer = setTimeout(
      () =>
        void loadModels(source, source === "custom" ? saved.base_url : "", ""),
      0,
    );
    return () => clearTimeout(timer);
    // Only when the source changes, Ollama comes up or the tab is shown; later fetches are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, ollamaRunning, visible]);

  const ids = models.state === "ok" ? models.ids : [];
  // Ollama lists a model pulled without a tag as "name:latest"; both spellings are the same model.
  const same = (a: string, b: string) => base(a) === base(b);
  // Recommended Ollama models that are not downloaded yet are offered in the same list.
  const notDownloaded =
    source === "ollama" && ollamaRunning && models.state === "ok"
      ? (ollama.status?.available_models ?? []).filter(
          (choice) =>
            !(ollama.status?.models ?? []).some((name) =>
              same(name, choice.name),
            ),
        )
      : [];
  const options = [...ids, ...notDownloaded.map((choice) => choice.name)];
  // A saved model the source no longer offers as an embedding model is treated as off - and said so.
  const dropped =
    models.state === "ok" &&
    model &&
    !(awaiting && same(awaiting, model)) &&
    !options.some((id) => same(id, model))
      ? model
      : "";
  const chosen = dropped ? "" : model;
  const selectedOption = options.find((id) => same(id, chosen)) ?? chosen;
  const needsDownload = notDownloaded.some((choice) =>
    same(choice.name, chosen),
  );

  const canFetchCustom = baseUrl.trim() !== "" && hasKey;
  const tuningChanges = changesFrom(tuning, saved.tuning, saved.specs);
  const tuningInvalid = saved.specs.some(
    (spec) => problemWith(spec, tuning[spec.key] ?? "", t) !== null,
  );
  const dirty =
    source !== saved.source ||
    !same(chosen, saved.model) ||
    tuningChanges !== undefined ||
    (source === "custom" &&
      (baseUrl.trim() !== saved.base_url || apiKey !== ""));
  const canSave =
    dirty &&
    !saving &&
    !awaiting &&
    // A model that is not downloaded yet is fetched, then saved, by the button beside it.
    !needsDownload &&
    !tuningInvalid &&
    (source !== "custom" || !chosen || (baseUrl.trim() !== "" && hasKey));

  async function download() {
    setSaving(true);
    try {
      ollama.setStatus(
        await api.post<OllamaStatus>("/api/v1/ai/ollama/enable", {
          model: selectedOption,
        }),
      );
      setAwaiting(selectedOption);
    } catch (error) {
      toast.error(apiErrorText(error, "adminAi.ollamaActionError"));
    } finally {
      setSaving(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    await persist();
  }

  async function persist() {
    setSaving(true);
    try {
      const result = await api.put<EmbeddingSettings>("/api/v1/ai/embedding", {
        source,
        base_url: source === "custom" ? baseUrl.trim() : "",
        ...(source === "custom" && apiKey ? { api_key: apiKey } : {}),
        model: chosen,
        ...(tuningChanges ? { tuning: tuningChanges } : {}),
      });
      setSaved(result);
      setModel(result.model);
      setTuning(draftFrom(result.tuning));
      setApiKey("");
      // A new Ollama memory/CPU/keep-alive only applies once it restarts: show that now.
      void ollama.refresh();
      toast.success(t("adminAi.semanticSaved"));
    } catch (error) {
      toast.error(apiErrorText(error, "adminAi.semanticSaveError"));
    } finally {
      setSaving(false);
    }
  }

  // After a download the choice is saved by itself, once Ollama reports the model as there.
  useEffect(() => {
    if (!awaiting || !ollama.status) return;
    const status = ollama.status;
    const timer = setTimeout(() => {
      if (
        status.state === "running" &&
        status.models.some((name) => same(name, awaiting))
      ) {
        setAwaiting("");
        void persist();
        // The model list was fetched before this download; show it as installed now.
        void loadModels("ollama", "", "");
      } else if (status.state !== "installing" && status.state !== "starting") {
        setAwaiting("");
      }
    }, 0);
    return () => clearTimeout(timer);
    // `persist` and `same` read the latest form values on every render; the status drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting, ollama.status]);

  function pick(next: EmbeddingSource) {
    if (next === source) return;
    setSource(next);
    setModel(next === saved.source ? saved.model : "");
    setModels({ state: "idle" });
  }

  const downloadButton =
    source === "ollama" && (needsDownload || awaiting) ? (
      <Button
        type="button"
        variant="primary"
        onClick={() => void download()}
        disabled={saving || Boolean(awaiting)}
      >
        {saving || awaiting ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Download aria-hidden />
        )}
        {awaiting
          ? t("adminAi.semanticDownloadingShort")
          : t("adminAi.saveDownload")}
      </Button>
    ) : null;

  const modelField = (
    <div className="space-y-1.5">
      <div className="flex items-end justify-between gap-3">
        <span className="flex items-center gap-1">
          <Label htmlFor="semantic-model">{t("adminAi.semanticModel")}</Label>
          <InfoTip>{t("adminAi.semanticModelHint")}</InfoTip>
        </span>
        {source === "custom" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={models.state === "loading" || !canFetchCustom}
            onClick={() => void loadModels("custom", baseUrl.trim(), apiKey)}
          >
            {models.state === "loading" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <CloudDownload aria-hidden />
            )}
            {models.state === "loading"
              ? t("adminAi.fetching")
              : t("adminAi.fetchModels")}
          </Button>
        ) : null}
      </div>
      <Select
        value={selectedOption || MODEL_OFF}
        onValueChange={(value) => setModel(value === MODEL_OFF ? "" : value)}
      >
        <SelectTrigger
          id="semantic-model"
          aria-label={t("adminAi.semanticModel")}
        >
          <SelectValue>
            {selectedOption || t("adminAi.embeddingOff")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="max-h-64">
          <SelectItem value={MODEL_OFF}>{t("adminAi.embeddingOff")}</SelectItem>
          {ids.map((id) => (
            <SelectItem key={id} value={id}>
              {source === "ollama" ? (
                <OllamaModelLabel name={id} downloaded />
              ) : (
                <span className="font-mono text-xs">{id}</span>
              )}
            </SelectItem>
          ))}
          {notDownloaded.map((choice) => (
            <SelectItem key={choice.name} value={choice.name}>
              <OllamaModelLabel name={choice.name} downloaded={false} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div aria-live="polite" className="text-xs">
        {models.state === "loading" ? (
          <p className="text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t("adminAi.checking")}
          </p>
        ) : models.state === "error" ? (
          <p role="alert" className="text-danger flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {models.message}
          </p>
        ) : dropped ? (
          <p role="status" className="text-warning">
            {t("adminAi.embeddingDropped", { model: dropped })}
          </p>
        ) : awaiting ? (
          <p role="status" className="text-muted-foreground">
            {t("adminAi.semanticDownloading", { model: awaiting })}
          </p>
        ) : needsDownload ? (
          <p className="text-muted-foreground">
            {t("adminAi.semanticWillDownload", {
              note:
                notDownloaded.find((choice) => same(choice.name, chosen))
                  ?.note ?? "",
            })}
          </p>
        ) : models.state === "ok" && options.length === 0 ? (
          <p className="text-muted-foreground">
            {source === "ollama"
              ? t("adminAi.semanticNoneOllama")
              : t("adminAi.embeddingNoneListed")}
          </p>
        ) : source === "custom" && models.state === "idle" ? (
          <p className="text-muted-foreground">
            {t("adminAi.semanticFetchFirst")}
          </p>
        ) : source === "ollama" && !ollamaRunning ? (
          <p className="text-muted-foreground">
            {t("adminAi.semanticEnableFirst")}
          </p>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">
          {t("adminAi.semanticHeading")}
        </h3>
        <p className="text-muted-foreground mt-0.5 max-w-2xl text-sm">
          {t("adminAi.semanticDescription")}
        </p>
      </div>

      <IndexStatusNote
        model={saved.model}
        onFix={() => document.getElementById("semantic-model")?.focus()}
      />

      <form onSubmit={save} className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <span id="semantic-source-label" className="text-sm font-medium">
              {t("adminAi.sourceLabel")}
            </span>
            <InfoTip>{t("adminAi.sourceHelp")}</InfoTip>
          </div>
          <div
            role="radiogroup"
            aria-labelledby="semantic-source-label"
            className="grid gap-3 sm:grid-cols-3"
          >
            <SourceCard
              selected={source === "provider"}
              onSelect={() => pick("provider")}
              icon={Waypoints}
              title={t("adminAi.sourceProvider")}
              body={t("adminAi.sourceProviderBody")}
            />
            <SourceCard
              selected={source === "custom"}
              onSelect={() => pick("custom")}
              icon={Server}
              title={t("adminAi.sourceCustom")}
              body={t("adminAi.sourceCustomBody")}
            />
            <SourceCard
              selected={source === "ollama"}
              onSelect={() => pick("ollama")}
              icon={Cpu}
              title={t("adminAi.sourceOllama")}
              body={t("adminAi.sourceOllamaBody")}
            />
          </div>
        </div>

        {source === "custom" ? (
          <div className="border-border bg-surface space-y-3 rounded-xl border p-4">
            <div className="space-y-1.5">
              <Label htmlFor="semantic-base-url">{t("adminAi.baseUrl")}</Label>
              <Input
                id="semantic-base-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="semantic-api-key">{t("adminAi.apiKey")}</Label>
              <PasswordInput
                id="semantic-api-key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={t("adminAi.apiKeyPlaceholder")}
                autoComplete="off"
              />
              {saved.has_key ? (
                <p className="text-muted-foreground text-xs">
                  {t("adminAi.apiKeyKeep", { preview: saved.api_key_preview })}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {source === "ollama" ? (
          <OllamaCard
            status={ollama.status}
            failed={ollama.failed}
            onChange={(next) => ollama.setStatus(next)}
            onRefresh={() => void ollama.refresh()}
            actions={downloadButton}
          >
            {modelField}
          </OllamaCard>
        ) : null}

        {source === "ollama" ? null : modelField}

        <TuningFields
          specs={saved.specs}
          draft={tuning}
          onChange={(key, value) =>
            setTuning((current) => ({ ...current, [key]: value }))
          }
          source={source}
          hostCpus={ollama.status?.host_cpus ?? 0}
          canBenchmark={saved.model !== ""}
        />

        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={!canSave}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {saving ? t("adminAi.saving") : t("adminAi.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
