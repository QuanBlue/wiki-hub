"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Bell,
  BookOpen,
  CalendarDays,
  ChevronDown,
  Ellipsis,
  FileText,
  Globe,
  Home,
  Inbox,
  LayoutGrid,
  LogIn,
  Mail,
  Monitor,
  Palette,
  Pencil,
  Play,
  PanelLeftClose,
  Search,
  Sun,
  UserRound,
  UsersRound,
} from "lucide-react";

import { LoginShowcase } from "@/components/auth/login-showcase";
import { Wordmark } from "@/components/brand/logo";
import { SeasonalAmbientLayer } from "@/components/seasonal/seasonal-ambient-layer";
import {
  SeasonalLoginAtmosphere,
  SeasonalLoginCardEdge,
  SeasonalLoginGreeting,
  SeasonalLoginWatermark,
  SeasonalShowcaseFoot,
} from "@/components/seasonal/seasonal-login-decor";
import { SeasonalSidebarOverlay } from "@/components/seasonal/seasonal-sidebar-overlay";
import {
  SeasonalTopBarGreeting,
  SeasonalTopBarOverlay,
} from "@/components/seasonal/seasonal-topbar-overlay";
import { useThemeSettings } from "@/components/theme-color-provider";
import { WelcomeEffectOverlay } from "@/components/users/welcome-effect-overlay";
import { seasonalWelcomeEffect } from "@/components/users/welcome-effects/seasonal";
import { useTranslation } from "@/lib/i18n/context";
import { resolveLoginPanel } from "@/lib/login-panel";
import { cn } from "@/lib/utils";
import type { LoginPanel, SeasonalEffectPresetId } from "@/types/api";

/** The virtual desktop the mock is laid out on, before it is scaled to fit. */
const VIEW_W = 1280;
const VIEW_H = 760;

type MockView = "app" | "login";

/**
 * A scaled-down, non-interactive copy of the Home page and the sign-in page
 * wearing one seasonal pack. The real seasonal components render at desktop
 * size and the whole frame is scaled, so the preview matches what people see.
 */
export function SeasonalPreviewMock({
  preset,
  loginPanel,
  loginImageUrl,
  badge,
}: {
  preset: SeasonalEffectPresetId;
  loginPanel?: LoginPanel | null;
  loginImageUrl?: string | null;
  /** Live / Preview tag shown over the frame's corner. */
  badge?: ReactNode;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<MockView>("app");
  // The festival's welcome effect plays over the mock Home when it opens, and on demand.
  const welcomeEffect = seasonalWelcomeEffect(preset);
  const [run, setRun] = useState(1);
  const [playing, setPlaying] = useState(true);
  const avatarRef = useRef<HTMLDivElement | null>(null);
  const replay = () => {
    setView("app");
    setPlaying(true);
    setRun((n) => n + 1);
  };

  const tabs: Array<{ id: MockView; label: string; icon: typeof Monitor }> = [
    { id: "app", label: t("seasonal.admin.mockApp"), icon: Monitor },
    { id: "login", label: t("seasonal.admin.mockLogin"), icon: LogIn },
  ];

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label={t("seasonal.admin.mockTabs")}
          className="bg-surface-sunken border-border inline-flex rounded-md border p-0.5"
        >
          {tabs.map(({ id, label, icon: Icon }) => {
            const selected = view === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setView(id)}
                className={cn(
                  "focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  selected
                    ? "bg-surface text-primary shadow-xs"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground text-xs">
            {t("seasonal.admin.mockCaption")}
          </p>
          {welcomeEffect ? (
            <button
              type="button"
              onClick={replay}
              className="border-border bg-surface text-foreground hover:bg-surface-hover hover:text-primary active:bg-surface-selected focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <Play className="size-3.5 shrink-0" aria-hidden />
              {t("seasonal.admin.playWelcome")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative">
        <ScaledViewport
          label={tabs.find((tab) => tab.id === view)?.label ?? ""}
        >
          {view === "app" ? (
            <AppHomeMock
              preset={preset}
              avatarRef={avatarRef}
              overlay={
                welcomeEffect && playing ? (
                  <WelcomeEffectOverlay
                    key={run}
                    contained
                    hideSkip
                    focusRef={avatarRef}
                    effect={welcomeEffect}
                    ownerName={t("seasonal.admin.mockGreeting")}
                    message={t(`welcomeEffect.seasonalGreeting.${preset}`)}
                    onComplete={() => setPlaying(false)}
                  />
                ) : null
              }
            />
          ) : (
            <LoginMock
              preset={preset}
              loginPanel={loginPanel}
              loginImageUrl={loginImageUrl}
            />
          )}
        </ScaledViewport>
        {badge ? (
          <div className="absolute top-2.5 left-2.5 z-10">{badge}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Lays children out on a VIEW_W x VIEW_H canvas and scales it to the frame's width. */
function ScaledViewport({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => {
      const width = frame.clientWidth;
      if (width > 0) setScale(width / VIEW_W);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      role="img"
      aria-label={label}
      data-testid="seasonal-preview-frame"
      className="border-border bg-background relative w-full overflow-hidden rounded-lg border shadow-xs"
      style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
    >
      <div
        // Purely a picture: nothing inside can be focused or clicked.
        inert
        aria-hidden="true"
        className="bg-background text-foreground absolute top-0 left-0 origin-top-left overflow-hidden select-none"
        style={
          {
            width: VIEW_W,
            height: VIEW_H,
            transform: `scale(${scale})`,
            "--wh-fall-span": `${VIEW_H}px`,
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

function AppHomeMock({
  preset,
  avatarRef,
  overlay,
}: {
  preset: SeasonalEffectPresetId;
  avatarRef: RefObject<HTMLDivElement | null>;
  overlay: ReactNode;
}) {
  const { t } = useTranslation();
  const { siteName } = useThemeSettings();

  // The same Overview items as the real navigation rail.
  const nav: Array<{ label: string; icon: typeof Home; active?: boolean }> = [
    { label: t("nav.home"), icon: Home, active: true },
    { label: t("nav.spaces"), icon: LayoutGrid },
    { label: t("nav.inbox"), icon: Inbox },
  ];

  return (
    <>
      {/* Top bar, same tokens and items as the real one. */}
      <header className="topbar-on-primary absolute inset-x-0 top-0 z-30 h-14">
        <div className="topbar-inner flex h-full items-center gap-3 px-4">
          <PanelLeftClose className="text-muted-foreground size-4 shrink-0" />
          <Wordmark siteName={siteName} />
          <SeasonalTopBarGreeting preset={preset} alwaysVisible />
          <div className="mx-auto w-full max-w-md min-w-0">
            <div className="border-border bg-surface-hover text-muted-foreground flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs">
              <Search className="size-4 shrink-0" />
              {t("topbar.searchPlaceholder", { siteName })}
              <kbd className="border-border ml-auto rounded border px-1.5 py-0.5 font-mono text-[10px]">
                Ctrl+K
              </kbd>
            </div>
          </div>
          <div className="text-muted-foreground flex items-center gap-3.5 pr-1">
            <BookOpen className="size-4" />
            <Bell className="size-4" />
            <Sun className="size-4" />
            <Globe className="size-4" />
            <span className="flex items-center gap-2">
              <span className="bg-surface-selected size-7 rounded-full" />
              <MockLine className="w-24" />
              <ChevronDown className="size-4" />
            </span>
          </div>
        </div>
        <SeasonalTopBarOverlay preset={preset} />
      </header>

      {/* Navigation rail; the overlay must be its direct child. */}
      <nav className="border-border bg-surface-sunken absolute top-14 bottom-0 left-0 z-20 flex w-60 flex-col overflow-hidden border-r">
        <SeasonalSidebarOverlay preset={preset} />
        <div className="space-y-0.5 px-2 py-3">
          <p className="text-muted-foreground px-2 pb-1 text-[11px] font-semibold tracking-[0.06em] uppercase">
            {t("nav.overview")}
          </p>
          {nav.map(({ label, icon: Icon, active }) => (
            <span
              key={label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                active
                  ? "bg-surface-selected text-primary font-medium"
                  : "text-muted-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </span>
          ))}
        </div>
        {[
          [t("nav.favoriteSpaces"), t("nav.noFavoriteSpaces")],
          [t("nav.pinnedPages"), t("nav.noPinnedPages")],
        ].map(([title, empty]) => (
          <div key={title} className="px-4 py-3">
            <p className="text-muted-foreground pb-1.5 text-[11px] font-semibold tracking-wide uppercase">
              {title}
            </p>
            <p className="text-muted-foreground text-xs">{empty}</p>
          </div>
        ))}
        <p className="text-muted-foreground mt-auto flex items-center gap-1.5 px-4 py-3 text-xs">
          <Ellipsis className="size-3.5 shrink-0" />
          {t("nav.manageSidebar")}
        </p>
      </nav>

      {/* Home content: the same two columns as the real Home (activity feed + profile card). */}
      <main className="absolute top-14 right-0 bottom-0 left-60 overflow-hidden px-10 py-10">
        <div className="grid grid-cols-[minmax(0,1fr)_21rem] items-start gap-7">
          <section className="min-w-0 px-2 pt-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {t("userProfile.activity")}
            </h2>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex gap-5">
                {[
                  t("userProfile.tabAllActivity"),
                  t("userProfile.tabMyActivity"),
                  t("userProfile.tabMyKnowledge"),
                  t("userProfile.tabDrafts"),
                ].map((label, i) => (
                  <span
                    key={label}
                    className={cn(
                      "border-b-2 px-0.5 pb-2.5 text-xs font-medium capitalize",
                      i === 0
                        ? "border-primary text-primary"
                        : "text-muted-foreground border-transparent",
                    )}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  {t("userProfile.showRecentCount")}
                </span>
                <span className="border-border bg-surface flex h-7 w-18 items-center justify-between rounded-md border px-2 text-xs">
                  <MockLine className="w-4" />
                  <ChevronDown className="text-muted-foreground size-3.5" />
                </span>
              </div>
            </div>
            <ul className="mt-3 space-y-3">
              {[56, 68, 44].map((w, i) => (
                <li key={i} className="px-2">
                  <div className="flex items-center gap-2">
                    <span className="bg-surface-selected size-7 shrink-0 rounded-full" />
                    <MockLine className="h-3 w-36" />
                  </div>
                  <div className="border-border mt-1 ml-3.5 flex items-start gap-2 border-l pt-2 pl-4">
                    <FileText className="text-primary mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <MockLine className="h-3" style={{ width: `${w}%` }} />
                      <MockLine className="mt-1.5 h-2" style={{ width: `${w * 0.6}%` }} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <aside className="space-y-5">
            <section className="border-border bg-surface relative rounded-lg border">
              <div className="bg-primary-subtle aspect-[15/4] rounded-t-lg" />
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                {[Play, Palette, Pencil].map((Icon, i) => (
                  <span
                    key={i}
                    className="text-muted-foreground bg-surface/75 flex size-8 items-center justify-center rounded-md shadow-xs"
                  >
                    <Icon className="size-4" />
                  </span>
                ))}
              </div>
              <div className="px-4 pb-4">
                <div className="flex items-end gap-3">
                  <div ref={avatarRef} className="relative -mt-10 size-20 shrink-0">
                    <span className="bg-surface-selected text-muted-foreground ring-surface relative flex size-20 items-center justify-center rounded-full ring-4">
                      <UserRound className="size-10" />
                    </span>
                    <span className="ring-surface bg-success absolute right-0 bottom-0 size-4 rounded-full ring-2" />
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <MockLine className="h-4 w-32" />
                    <MockLine className="mt-2 w-20" />
                  </div>
                </div>
              </div>
              <dl className="border-border space-y-2.5 border-t px-4 py-3 text-xs">
                {[
                  [UsersRound, t("profile.workspaceRole")],
                  [CalendarDays, t("userProfile.joined")],
                  [Mail, t("profile.email")],
                ].map(([Icon, label]) => {
                  const RowIcon = Icon as typeof Mail;
                  return (
                    <div key={label as string} className="flex items-center gap-2">
                      <RowIcon className="text-muted-foreground size-4" />
                      <dt className="text-muted-foreground">{label as string}</dt>
                      <dd className="ml-auto">
                        <MockLine className="w-16" />
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <dl className="border-border grid grid-cols-3 divide-x border-t text-center">
                {[
                  t("userProfile.statsPagesUpdated"),
                  t("userProfile.statsPagesCreated"),
                  t("userProfile.statsSpacesContributed"),
                ].map((label) => (
                  <div key={label} className="px-1 py-1.5">
                    <dd className="bg-foreground/15 mx-auto h-3 w-6 rounded" />
                    <dt className="text-muted-foreground mt-1 text-[10px] leading-tight whitespace-nowrap">
                      {label}
                    </dt>
                  </div>
                ))}
              </dl>
            </section>
            {/* Holiday calendar card */}
            <section className="border-border bg-surface rounded-lg border p-3.5">
              <MockLine className="mx-auto h-3 w-24" />
              <div className="mt-3 grid grid-cols-7 gap-y-2.5">
                {Array.from({ length: 35 }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "bg-foreground/10 mx-auto h-2 w-3 rounded-full",
                      i === 22 && "bg-primary/40",
                    )}
                  />
                ))}
              </div>
            </section>
            {/* Feature discovery card */}
            <section className="border-border bg-surface rounded-lg border p-3.5">
              <p className="text-sm font-semibold tracking-tight">
                {t("featureDiscovery.title")}
              </p>
              <div className="bg-primary-subtle mt-3 h-24 rounded-md" />
            </section>
          </aside>
        </div>
      </main>

      <SeasonalAmbientLayer preset={preset} contained className="z-20" />
      {overlay}
    </>
  );
}

function LoginMock({
  preset,
  loginPanel,
  loginImageUrl,
}: {
  preset: SeasonalEffectPresetId;
  loginPanel?: LoginPanel | null;
  loginImageUrl?: string | null;
}) {
  const { t, locale } = useTranslation();
  const { siteName } = useThemeSettings();
  const panel = resolveLoginPanel(loginPanel, loginImageUrl, locale, t);

  return (
    <div className="absolute inset-0 grid grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
      <LoginShowcase
        panel={panel}
        siteName={siteName}
        preview
        decor={<SeasonalShowcaseFoot preset={preset} />}
      />
      <section className="bg-surface-sunken/60 relative flex items-center justify-center overflow-hidden px-6">
        <SeasonalLoginWatermark preset={preset} />
        <div className="relative z-10 w-full max-w-[27rem]">
          <SeasonalLoginGreeting preset={preset} className="mb-3" />
          <div className="relative">
            <SeasonalLoginCardEdge preset={preset} />
            <div className="border-border/80 bg-surface overflow-hidden rounded-2xl border p-7 shadow-lg shadow-black/[0.03]">
              <p className="text-foreground text-xl font-semibold tracking-tight">
                {t("seasonal.admin.mockSignIn")}
              </p>
              <MockLine className="mt-2 w-48" />
              <div className="mt-6 space-y-4">
                {[
                  t("seasonal.admin.mockEmail"),
                  t("seasonal.admin.mockPassword"),
                ].map((field) => (
                  <div key={field}>
                    <p className="text-foreground text-xs font-medium">
                      {field}
                    </p>
                    <div className="border-border bg-surface mt-1.5 h-9 rounded-md border" />
                  </div>
                ))}
                <div className="bg-primary text-primary-foreground flex h-9 items-center justify-center rounded-md text-sm font-medium">
                  {t("seasonal.admin.mockSignIn")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <div className="pointer-events-none absolute inset-0 z-[5]">
        <SeasonalLoginAtmosphere preset={preset} contained />
      </div>
    </div>
  );
}

function MockLine({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn("bg-foreground/10 h-2.5 rounded-full", className)}
      style={style}
    />
  );
}
