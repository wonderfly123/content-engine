import { getAccess } from "@/lib/auth/session";
import { PendingActions } from "./pending-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Waiting for approval · Content Engine" };

export default async function PendingPage() {
  const access = await getAccess();
  const disabled = access?.status === "disabled";
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">
          {disabled ? "Your access has been disabled" : "Waiting for approval"}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {disabled
            ? "Contact an admin if you think this is a mistake."
            : "An admin needs to approve your account. This page checks again every 30 seconds."}
        </p>
        <p className="mb-6 text-sm font-medium">{access?.email}</p>
        <PendingActions disabled={disabled} />
      </div>
    </div>
  );
}
