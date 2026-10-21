"use client";

import { Languages, Loader2, MessageSquare, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, describeApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type AiLimits = {
  requests_per_hour: number | null;
  translate_requests_per_hour: number | null;
  default_requests_per_hour: number;
  default_translate_requests_per_hour: number;
};

type Key = "requests_per_hour" | "translate_requests_per_hour";

const URL = "/api/v1/ai/limits";
const MINIMUM = 1;
const MAXIMUM = 100_000;

const FIELDS: {
  key: Key;
  icon: typeof MessageSquare;
  fallback: keyof AiLimits;
}[] = [
  {
    key: "requests_per_hour",
    icon: MessageSquare,
    fallback: "default_requests_per_hour",
  },
  {
    key: "translate_requests_per_hour",
    icon: Languages,
    fallback: "default_translate_requests_per_hour",
  },
];

/** `""` (the default), or a whole number in range; anything else is a problem to show. */
function problemWith(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  const number = Number(value);
  return !Number.isInteger(number) || number < MINIMUM || number > MAXIMUM;
}

/**
 * Admin > AI assistant > Usage limits: how many AI calls one person may make an hour, so one
 * busy user (or a script) cannot use up the provider's quota for everyone. Empty means the
 * default from the server's environment. Applies within half a minute, without a restart.
 */
export function AiLimitsPanel() {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<AiLimits | null>(null);
  const [draft, setDraft] = useState<Record<Key, string>>({
    requests_per_hour: "",
    translate_requests_per_hour: "",
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const adopt = useCallback((limits: AiLimits) => {
    setSaved(limits);
    setDraft({
      requests_per_hour: limits.requests_per_hour?.toString() ?? "",
      translate_requests_per_hour:
        limits.translate_requests_per_hour?.toString() ?? "",
    });
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get<AiLimits>(URL)
      .then((limits) => {
        if (alive) adopt(limits);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [adopt]);

  if (failed) {
    return (
      <p className="text-danger text-sm" role="alert">
        {t("adminAi.limitsLoadError")}
      </p>
    );
  }
  if (!saved) {
    return (
      <p className="text-muted-foreground flex items-center text-sm">
        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
        {t("adminAi.limitsLoading")}
      </p>
    );
  }

  const invalid = FIELDS.some(({ key }) => problemWith(draft[key]));
  const changed = FIELDS.some(
    ({ key }) => draft[key].trim() !== (saved[key]?.toString() ?? ""),
  );

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid) return;
    setBusy(true);
    try {
      const body = Object.fromEntries(
        FIELDS.map(({ key }) => [
          key,
          draft[key].trim() ? Number(draft[key]) : null,
        ]),
      );
      adopt(await api.put<AiLimits>(URL, body));
      toast.success(t("adminAi.limitsSaved"));
    } catch (error) {
      toast.error(describeApiError(error, t("adminAi.limitsSaveError")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">{t("adminAi.limitsTitle")}</h3>
        <p className="text-muted-foreground mt-0.5 max-w-2xl text-sm">
          {t("adminAi.limitsIntro")}
        </p>
      </div>

      <form onSubmit={save} className="space-y-4">
        <div className="border-border bg-surface divide-border divide-y rounded-xl border">
          {FIELDS.map(({ key, icon: Icon, fallback }) => {
            const id = `ai-limit-${key}`;
            const value = draft[key];
            const problem = problemWith(value);
            const overridden = value.trim() !== "";
            return (
              <div
                key={key}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-6"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="bg-primary-subtle text-primary mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <Label
                        htmlFor={id}
                        className={cn(overridden && "text-primary")}
                      >
                        {t(`adminAi.limits_${key}`)}
                      </Label>
                      <InfoTip>{t(`adminAi.limitsHelp_${key}`)}</InfoTip>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {t(`adminAi.limitsShort_${key}`)}
                    </p>
                  </div>
                </div>
                <div className="w-full shrink-0 sm:w-56">
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <Input
                        id={id}
                        inputMode="numeric"
                        value={value}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        placeholder={t("adminAi.tuneDefaultValue", {
                          value: saved[fallback] as number,
                        })}
                        aria-invalid={problem}
                        aria-describedby={problem ? `${id}-problem` : undefined}
                        autoComplete="off"
                        className={cn(
                          "h-8 pr-16 text-sm tabular-nums",
                          overridden && !problem && "border-primary/50",
                          problem && "border-danger",
                        )}
                      />
                      <span
                        aria-hidden
                        className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px]"
                      >
                        {t("adminAi.limitsUnit")}
                      </span>
                    </div>
                    {overridden ? (
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({ ...current, [key]: "" }))
                        }
                        aria-label={t("adminAi.tuneReset", {
                          name: t(`adminAi.limits_${key}`),
                        })}
                        title={t("adminAi.tuneReset", {
                          name: t(`adminAi.limits_${key}`),
                        })}
                        className="text-muted-foreground hover:text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                      </button>
                    ) : (
                      <span className="size-8 shrink-0" aria-hidden />
                    )}
                  </div>
                  {problem ? (
                    <p
                      id={`${id}-problem`}
                      role="alert"
                      className="text-danger mt-1 text-xs"
                    >
                      {t("adminAi.tuneOutOfRange", {
                        min: MINIMUM,
                        max: MAXIMUM,
                      })}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end">
          <Button type="submit" disabled={busy || invalid || !changed}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t("adminAi.limitsSave")}
          </Button>
        </div>
      </form>
    </div>
  );
}
