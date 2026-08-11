import { redirect } from "next/navigation";

/** /admin has no content of its own; Users is the natural landing section. */
export default function AdminIndexPage() {
  redirect("/admin/users");
}
