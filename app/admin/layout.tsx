import { AdminTabs } from "@/components/admin/admin-tabs";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-auto p-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            <AdminTabs />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
