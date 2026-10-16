"use client";

import {
  CheckCircle2,
  CircleAlert,
  Globe,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, describeApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";

type Provider = "gateway" | "tavily" | "brave" | "serper";

type WebSearchSettings = {
  enabled: boolean;
  provider: Provider;
  has_key: boolean;
  key_preview: string;
};

type WebSearchTest = { ok: boolean; error: string | null; results: number };

const PROVIDERS: Provider[] = ["gateway", "tavily", "brave", "serper"];
const URL = "/api/v1/ai/web-search";

/**
 * Admin > AI assistant > Web search: whether the chat may look things up on the internet,
 * and with which search service. Off until an administrator turns it on. The panel says
 * plainly what leaves the building, and each option explains how it differs from the rest.
 */
export function WebSearchPanel() {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<WebSearchSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<Provider>("gateway");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [test, setTest] = useState<WebSearchTest | null>(null);
  const [failed, setFailed] = useState(false);

  const adopt = useCallback((settings: WebSearchSettings) => {
    setSaved(settings);
    setEnabled(settings.enabled);
    setProvider(settings.provider);
    setKey("");
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get<WebSearchSettings>(URL)
      .then((settings) => {
        if (alive) adopt(settings);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [adopt]);

  const body = () => ({
    enabled,
    provider,
    ...(key.trim() ? { api_key: key.trim() } : {}),
  });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("save");
    try {
      adopt(await api.put<WebSearchSettings>(URL, body()));
      setTest(null);
      toast.success(t("adminAi.webSaved"));
    } catch (error) {
      toast.error(describeApiError(error, t("adminAi.webSaveError")));
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy("test");
    setTest(null);
    try {
      setTest(await api.post<WebSearchTest>(`${URL}/test`, body()));
    } catch (error) {
      setTest({
        ok: false,
        error: describeApiError(error, t("adminAi.webTestError")),
        results: 0,
      });
    } finally {
      setBusy(null);
    }
  };

  if (failed) {
    return (
      <p className="text-danger text-sm" role="alert">
        {t("adminAi.webLoadError")}
      </p>
    );
  }
  if (!saved) {
    return (
      <p className="text-muted-foreground flex items-center text-sm">
        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
        {t("adminAi.webLoading")}
      </p>
    );
  }

  const ownKey = provider !== "gateway";
  const hasKey = !ownKey || saved.has_key || key.trim().length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">{t("adminAi.webTitle")}</h3>
        <p className="text-muted-foreground mt-0.5 max-w-2xl text-sm">
          {t("adminAi.webIntro")}
        </p>
      </div>

      <form onSubmit={save} className="space-y-4">
        <div className="border-border bg-surface flex items-start justify-between gap-3 rounded-xl border p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="accent-primary mt-1 size-4 cursor-pointer"
            />
            <span>
              <span className="block text-sm font-medium">
                {t("adminAi.webEnable")}
              </span>
              <span className="text-muted-foreground block text-xs">
                {t("adminAi.webEnableHint")}
              </span>
            </span>
          </label>
          <InfoTip>{t("adminAi.webEnableHelp")}</InfoTip>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <Label htmlFor="web-provider">{t("adminAi.webProvider")}</Label>
            <InfoTip>{t("adminAi.webProviderHelp")}</InfoTip>
          </div>
          <Select
            value={provider}
            onValueChange={(value) => {
              setProvider(value as Provider);
              setTest(null);
            }}
          >
            <SelectTrigger id="web-provider" className="w-full sm:w-80">
              <SelectValue>{t(`adminAi.webProvider_${provider}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {PROVIDERS.map((id) => (
                <SelectItem key={id} value={id}>
                  <span className="flex flex-col gap-0.5 py-0.5">
                    <span className="text-sm">
                      {t(`adminAi.webProvider_${id}`)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t(`adminAi.webProvider_${id}_body`)}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground max-w-2xl text-xs">
            {t(`adminAi.webProvider_${provider}_help`)}
          </p>
        </div>

        {ownKey ? (
          <div className="border-border bg-surface space-y-1.5 rounded-xl border p-4">
            <div className="flex items-center gap-1">
              <Label htmlFor="web-key">{t("adminAi.webKey")}</Label>
              <InfoTip>{t("adminAi.webKeyHelp")}</InfoTip>
            </div>
            <PasswordInput
              id="web-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
              placeholder={
                saved.has_key
                  ? saved.key_preview
                  : t("adminAi.webKeyPlaceholder")
              }
            />
            <p className="text-muted-foreground text-xs">
              {saved.has_key
                ? t("adminAi.webKeyKept")
                : t("adminAi.webKeyHint")}
            </p>
          </div>
        ) : null}

        <div className="border-border bg-surface-sunken flex gap-3 rounded-xl border p-4 text-sm">
          <ShieldCheck
            className="text-primary mt-0.5 size-4 shrink-0"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="font-medium">{t("adminAi.webPrivacyTitle")}</p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-xs">
              <li>{t("adminAi.webPrivacy1")}</li>
              <li>{t("adminAi.webPrivacy2")}</li>
              <li>{t("adminAi.webPrivacy3")}</li>
            </ul>
          </div>
        </div>

        <div aria-live="polite" className="text-xs">
          {test ? (
            test.ok ? (
              <p role="status" className="text-success flex items-center gap-2">
                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                {t("adminAi.webTestOk", { count: test.results })}
              </p>
            ) : (
              <p role="status" className="text-danger flex items-start gap-2">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {test.error ?? t("adminAi.webTestError")}
              </p>
            )
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy !== null || !hasKey}
            onClick={() => void runTest()}
          >
            {busy === "test" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Globe aria-hidden />
            )}
            {t("adminAi.webTest")}
          </Button>
          <Button type="submit" variant="primary" disabled={busy !== null}>
            {busy === "save" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : null}
            {t("common.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
