import { redirect } from "next/navigation";

/** Old address: the all-brands connections view lives at /admin now. */
export default function OldAdminConnectionsPage() {
  redirect("/admin");
}
