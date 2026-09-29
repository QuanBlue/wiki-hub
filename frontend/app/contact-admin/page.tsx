import { redirect } from "next/navigation";

// The form lives inside the sign-in page now; this address is kept public
// (see PUBLIC_PATHS in middleware.ts) so old links and bookmarks still work.
export default function ContactAdminPage() {
  redirect("/login?view=contact");
}
