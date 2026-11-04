import type { Locale } from "@/lib/i18n/core";
import type { LoginPanel, LoginPanelCopy } from "@/types/api";

/** The illustration shown when the administrator has not uploaded their own. */
export const DEFAULT_LOGIN_IMAGE = "/login/workspace.png";

/** Fixed icon slots of the three feature blurbs. */
export const LOGIN_FEATURE_ICONS = ["ask", "spaces", "control"] as const;
export type LoginFeatureIcon = (typeof LOGIN_FEATURE_ICONS)[number];

type Translate = (key: string) => string;

export interface ResolvedLoginFeature {
  icon: LoginFeatureIcon;
  title: string;
  description: string;
}

/** Everything the sign-in panel renders, with administrator text and defaults already merged. */
export interface ResolvedLoginPanel {
  tagline: string;
  headline: string;
  subheading: string;
  footer: string;
  /** Only the enabled blurbs, in their fixed order. */
  features: ResolvedLoginFeature[];
  image: { src: string; alt: string } | null;
}

const FEATURE_KEYS = [
  ["auth.featAskTitle", "auth.featAskDescription"],
  ["auth.featSpacesTitle", "auth.featSpacesDescription"],
  ["auth.featControlTitle", "auth.featControlDescription"],
] as const;

/** An empty copy: every field falls back to the built-in text. */
export function emptyLoginPanelCopy(): LoginPanelCopy {
  return {
    tagline: null,
    headline: null,
    subheading: null,
    footer: null,
    features: LOGIN_FEATURE_ICONS.map(() => ({ enabled: true, title: null, description: null })),
  };
}

export function emptyLoginPanel(): LoginPanel {
  return { en: emptyLoginPanelCopy(), vi: emptyLoginPanelCopy(), hide_image: false };
}

/** The built-in text for one language, as the admin form's placeholders. */
export function defaultLoginPanelText(t: Translate) {
  return {
    tagline: t("auth.tagline"),
    headline: t("auth.headline"),
    subheading: t("auth.subheading"),
    footer: t("auth.footerTagline"),
    features: FEATURE_KEYS.map(([title, description]) => ({
      title: t(title),
      description: t(description),
    })),
  };
}

/**
 * Merge the administrator's copy for `locale` over the built-in text. A blank
 * field keeps the default for that language, so switching language never shows
 * text meant for another one.
 */
export function resolveLoginPanel(
  panel: LoginPanel | null | undefined,
  imageUrl: string | null | undefined,
  locale: Locale,
  t: Translate,
): ResolvedLoginPanel {
  const defaults = defaultLoginPanelText(t);
  const copy = panel?.[locale] ?? emptyLoginPanelCopy();

  const features: ResolvedLoginFeature[] = [];
  LOGIN_FEATURE_ICONS.forEach((icon, index) => {
    const custom = copy.features[index];
    if (custom && !custom.enabled) return;
    features.push({
      icon,
      title: custom?.title || defaults.features[index].title,
      description: custom?.description || defaults.features[index].description,
    });
  });

  return {
    tagline: copy.tagline || defaults.tagline,
    headline: copy.headline || defaults.headline,
    subheading: copy.subheading || defaults.subheading,
    footer: copy.footer || defaults.footer,
    features,
    image: panel?.hide_image
      ? null
      : { src: imageUrl || DEFAULT_LOGIN_IMAGE, alt: t("auth.previewAlt") },
  };
}
