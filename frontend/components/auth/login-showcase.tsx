import { FolderTree, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";

import { Wordmark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import type { LoginFeatureIcon, ResolvedLoginPanel } from "@/lib/login-panel";

const ICONS: Record<LoginFeatureIcon, LucideIcon> = {
  ask: Sparkles,
  spaces: FolderTree,
  control: ShieldCheck,
};

const GRID_COLS = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" } as const;

/**
 * Left panel of the sign-in page. Purely presentational (no hooks), so the
 * server-rendered login page and the admin live preview share one markup.
 *
 * `preview` drops the "hidden below lg" / sticky behaviour so it can be shown
 * at a fixed size inside the settings form.
 */
export function LoginShowcase({
  panel,
  siteName,
  preview = false,
}: {
  panel: ResolvedLoginPanel;
  siteName: string;
  preview?: boolean;
}) {
  const columns = GRID_COLS[Math.min(Math.max(panel.features.length, 1), 3) as 1 | 2 | 3];

  return (
    <section
      className={cn(
        "bg-primary text-primary-foreground relative overflow-hidden px-8 py-8 xl:px-14 xl:py-12",
        preview
          ? "flex h-full w-full items-center"
          : "hidden lg:sticky lg:top-0 lg:flex lg:h-full lg:items-center",
      )}
    >
      {/* Decorative echo of the brand mark's three converging layers - purely
          atmospheric, so it is hidden from assistive tech. */}
      <svg
        viewBox="0 0 400 400"
        fill="none"
        aria-hidden="true"
        className="text-primary-foreground pointer-events-none absolute -top-24 -right-32 h-120 w-120"
      >
        <path
          d="M90 150 200 95 310 150 200 205Z"
          stroke="currentColor"
          strokeOpacity="0.14"
          strokeWidth="2"
        />
        <path
          d="M90 205 200 260 310 205"
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth="2"
        />
        <path
          d="M90 260 200 315 310 260"
          stroke="currentColor"
          strokeOpacity="0.07"
          strokeWidth="2"
        />
      </svg>

      <div className="relative mx-auto flex h-full max-h-[52rem] w-full max-w-2xl flex-col justify-between gap-4 lg:gap-6 [@media(max-height:850px)]:gap-3">
        <Wordmark siteName={siteName} className="text-lg" />

        <div>
          <p className="text-primary-foreground/70 text-sm font-medium">{panel.tagline}</p>
          <h1 className="mt-2.5 text-3xl leading-tight font-semibold tracking-tight text-balance sm:mt-3 xl:text-4xl">
            {panel.headline}
          </h1>
          <p className="text-primary-foreground/70 mt-3 max-w-xl text-[0.875rem] leading-6 sm:mt-4 xl:text-[0.9375rem] [@media(max-height:680px)]:hidden">
            {panel.subheading}
          </p>
        </div>

        {panel.image ? (
          // A real capture of the application (docs/demo/assets), cropped to its
          // top-left corner, unless the administrator uploaded their own.
          <div className="border-primary-foreground/20 aspect-[16/8.5] overflow-hidden rounded-xl border shadow-2xl [@media(max-height:720px)]:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={panel.image.src}
              alt={panel.image.alt}
              width={1420}
              height={900}
              className="bg-surface w-full object-cover object-left-top"
            />
          </div>
        ) : null}

        <div>
          <ul className={cn("grid gap-x-4 gap-y-2 xl:gap-x-6", columns)}>
            {panel.features.map(({ icon, title, description }) => {
              const Icon = ICONS[icon];
              return (
                <li key={icon}>
                  <div className="flex items-center gap-2.5">
                    <span className="bg-primary-foreground/10 grid size-7 shrink-0 place-items-center rounded-md">
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <p className="text-sm leading-tight font-semibold">{title}</p>
                  </div>
                  <p className="text-primary-foreground/65 mt-2 text-xs leading-5 [@media(max-height:800px)]:hidden">
                    {description}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="text-primary-foreground/50 border-primary-foreground/15 mt-4 border-t pt-3 text-xs sm:mt-5 sm:pt-4 [@media(max-height:650px)]:hidden">
            {panel.footer}
          </p>
        </div>
      </div>
    </section>
  );
}
