import type { Metadata } from "next";

import { getSpace } from "@/lib/spaces";
import { spaceTabTitle } from "@/lib/space-tab-title";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { key } = await params;
  try {
    const space = await getSpace(key);
    return { title: spaceTabTitle(space.name, key) };
  } catch {
    return { title: key.toUpperCase() };
  }
}

export default function SpaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
