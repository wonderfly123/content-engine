import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function Home() {
  // First active brand → dashboard; otherwise route into onboarding.
  const [first] = await db
    .select({ slug: brands.slug })
    .from(brands)
    .where(eq(brands.status, "active"))
    .orderBy(desc(brands.updatedAt))
    .limit(1);

  if (first) {
    redirect(`/dashboard?brand=${first.slug}`);
  }
  redirect("/onboarding");
}
