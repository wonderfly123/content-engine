import { redirect } from "next/navigation";

/** Admin is just the all-brands connections view now. */
export default function AdminPage() {
  redirect("/admin/connections");
}
