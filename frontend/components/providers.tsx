"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "sonner";

import { ApiError } from "@/lib/api-client";
import { NavigationLoading } from "@/components/navigation-loading";
import { ThemeColorProvider } from "@/components/theme-color-provider";
import { ScrollToTop } from "@/components/ui/scroll-to-top";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Never retry a permission or validation failure - it will not change.
          if (error instanceof ApiError && !error.isRetryable) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({
  children,
  initialSiteName,
  initialThemeColor,
  initialDefaultFont,
  initialLogoIcon,
  initialCustomLogoUrl,
}: {
  children: React.ReactNode;
  initialSiteName?: string;
  initialThemeColor?: string;
  initialDefaultFont?: string;
  initialLogoIcon?: string;
  initialCustomLogoUrl?: string | null;
}) {
  // Held in state so each browser session gets exactly one client, and so a
  // server render never shares a cache between two users' requests.
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
        themes={["light", "dark"]}
        disableTransitionOnChange
      >
        <ThemeColorProvider
          initialSiteName={initialSiteName}
          initialThemeColor={initialThemeColor}
          initialDefaultFont={initialDefaultFont}
          initialLogoIcon={initialLogoIcon}
          initialCustomLogoUrl={initialCustomLogoUrl}
        >
          {children}
          <NavigationLoading />
          <Toaster position="bottom-right" closeButton richColors />
          <ScrollToTop />
        </ThemeColorProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
