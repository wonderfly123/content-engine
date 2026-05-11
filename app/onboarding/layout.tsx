import Link from "next/link";
import { Sparkles } from "lucide-react";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            Content Engine
          </Link>
          <Link
            href="/onboarding"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Save and exit
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
