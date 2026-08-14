import { redirect } from "next/navigation";

export default function FavoritesPage() {
  redirect("/spaces?tab=starred");
}
