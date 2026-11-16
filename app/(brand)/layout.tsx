import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ConnectionsBanner } from "@/components/layout/connections-banner";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { onboardingRedirect } from "@/lib/onboarding/gate";

export default async function BrandLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Someone with no brand yet sets one up first, rather than landing in an empty app. The check
  // reads the session, so these pages render per request rather than once at build time.
  await connection();
  const to = await onboardingRedirect();
  if (to) redirect(to);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <ConnectionsBanner />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
