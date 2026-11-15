import { EmailForm } from "./email-form";
import { GoogleButton } from "./google-button";

export const metadata = { title: "Sign in · Nekter" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Nekter</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in or create an account to review, schedule and track your content.</p>
        </div>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error === "setup" ? "We couldn't finish setting up your account. Please sign in again." : "Sign in failed. Please try again."}
          </div>
        )}
        <GoogleButton />
        <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
        <EmailForm />
      </div>
    </div>
  );
}
