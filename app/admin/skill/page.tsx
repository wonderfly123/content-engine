import { notFound } from "next/navigation";
import { getAccess } from "@/lib/auth/session";
import { SkillEditor } from "./skill-editor";

export const dynamic = "force-dynamic";

/** Admin > Editor skill. The middleware already keeps non-admins out of /admin; this checks again. */
export default async function AdminSkillPage() {
  const access = await getAccess();
  if (!access || access.status !== "active" || access.role !== "admin") notFound();
  return <SkillEditor />;
}
