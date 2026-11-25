import { api } from "@/lib/api-client";
import type { Locale } from "@/lib/i18n/core";
import type {
  PageTemplate,
  PageTemplateCreatePayload,
  PageTemplateUpdatePayload,
  SavePageAsTemplatePayload,
} from "@/types/api";

export type GlobalTemplateScopeFilter = "all" | "global" | "builtin";

export async function listGlobalTemplates(options?: {
  scope?: GlobalTemplateScopeFilter;
  lang?: Locale;
}): Promise<PageTemplate[]> {
  const result = await api.get<PageTemplate[]>("/api/v1/templates", {
    query: {
      scope: options?.scope ?? "all",
      lang: options?.lang,
    },
  });
  return Array.isArray(result) ? result : [];
}

export function getTemplate(
  templateId: string,
  lang?: Locale,
): Promise<PageTemplate> {
  return api.get<PageTemplate>(
    `/api/v1/templates/${encodeURIComponent(templateId)}`,
    { query: { lang } },
  );
}

export function createGlobalTemplate(
  payload: PageTemplateCreatePayload,
): Promise<PageTemplate> {
  return api.post<PageTemplate>("/api/v1/templates", payload);
}

export function updateGlobalTemplate(
  templateId: string,
  payload: PageTemplateUpdatePayload,
): Promise<PageTemplate> {
  return api.patch<PageTemplate>(
    `/api/v1/templates/${encodeURIComponent(templateId)}`,
    payload,
  );
}

export function deleteGlobalTemplate(templateId: string): Promise<void> {
  return api.delete<void>(
    `/api/v1/templates/${encodeURIComponent(templateId)}`,
  );
}

export async function listSpaceTemplates(
  spaceKey: string,
  lang?: Locale,
): Promise<PageTemplate[]> {
  const result = await api.get<PageTemplate[]>(
    `/api/v1/spaces/${encodeURIComponent(spaceKey)}/templates`,
    { query: { lang } },
  );
  return Array.isArray(result) ? result : [];
}

export function createSpaceTemplate(
  spaceKey: string,
  payload: PageTemplateCreatePayload,
): Promise<PageTemplate> {
  return api.post<PageTemplate>(
    `/api/v1/spaces/${encodeURIComponent(spaceKey)}/templates`,
    payload,
  );
}

export function updateSpaceTemplate(
  spaceKey: string,
  templateId: string,
  payload: PageTemplateUpdatePayload,
): Promise<PageTemplate> {
  return api.patch<PageTemplate>(
    `/api/v1/spaces/${encodeURIComponent(spaceKey)}/templates/${encodeURIComponent(templateId)}`,
    payload,
  );
}

export function deleteSpaceTemplate(
  spaceKey: string,
  templateId: string,
): Promise<void> {
  return api.delete<void>(
    `/api/v1/spaces/${encodeURIComponent(spaceKey)}/templates/${encodeURIComponent(templateId)}`,
  );
}

export function savePageAsTemplate(
  spaceKey: string,
  pageId: string,
  payload: SavePageAsTemplatePayload,
): Promise<PageTemplate> {
  return api.post<PageTemplate>(
    `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(pageId)}/save-as-template`,
    payload,
  );
}
