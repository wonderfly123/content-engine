import { GoogleButton } from "./google-button";

export const metadata = { title: "Sign in · Content Engine" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Content Engine</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to review, schedule and track your content.</p>
        </div>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Sign in failed. Please try again.
          </div>
        )}
        <GoogleButton />
      </div>
    </div>
  );
}
