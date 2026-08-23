import type { Metadata } from "next";

import { ExportError } from "@/components/print/export-error";
import { ExportShell } from "@/components/print/export-shell";
import { ApiError, api } from "@/lib/api-client";
import type { ExportBundle } from "@/types/api";

// Never cached, never statically generated: every visit is a one-shot,
// single-use export render driven by a fresh, short-lived token.
export const dynamic = "force-dynamic";

type PrintPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function fetchToken(
  searchParams: PrintPageProps["searchParams"],
): Promise<string | undefined> {
  const { token: rawToken } = await searchParams;
  return Array.isArray(rawToken) ? rawToken[0] : rawToken;
}

/**
 * Names the exported HTML file's own `<title>` after the page itself rather
 * than the site default - cosmetic only (the actual download filename comes
 * from the backend's Content-Disposition header), but worth getting right
 * for whoever opens the saved file directly. Next.js dedupes this fetch
 * against the identical one in the page body below into a single request.
 */
export async function generateMetadata({
  searchParams,
}: PrintPageProps): Promise<Metadata> {
  const token = await fetchToken(searchParams);
  if (!token) return {};
  try {
    const bundle = await api.get<ExportBundle>(
      "/api/v1/export-render/bundle",
      { cache: "no-store", token },
    );
    return { title: bundle.page.title };
  } catch {
    return {};
  }
}

/**
 * The chrome-less page the backend's headless-browser export visits to
 * produce a PDF/HTML/Word snapshot. Not part of the normal app navigation -
 * reachable only with a valid `token` query param, which is exchanged
 * server-side for the page's content via `/api/v1/export-render/bundle`
 * (a Bearer credential, never the session cookie: this route carries no
 * session at all - see middleware.ts and export_render.py).
 */
export default async function PrintPage({ searchParams }: PrintPageProps) {
  const token = await fetchToken(searchParams);

  if (!token) {
    return <ExportError reason="missing-token" />;
  }

  let bundle: ExportBundle;
  try {
    bundle = await api.get<ExportBundle>("/api/v1/export-render/bundle", {
      cache: "no-store",
      token,
    });
  } catch (error) {
    const message =
      error instanceof ApiError ? error.message : "Could not load the page.";
    return <ExportError reason="fetch-failed" message={message} />;
  }

  return <ExportShell bundle={bundle} />;
}
