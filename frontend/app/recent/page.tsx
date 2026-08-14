import { redirect } from "next/navigation";

/** Recent updates now live on Home; keep old bookmarks working. */
export default function RecentPage() {
  redirect("/");
}
