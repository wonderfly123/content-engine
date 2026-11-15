import { SITE } from "@/lib/site";
import { SiteFooter, SiteHeader } from "./site-chrome";

/** Header and footer for the public pages (landing, privacy, terms, texting terms). Always light, like the marketing site. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa] text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

/** A plain reading layout for policy pages. */
export function PolicyPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 pb-16 pt-28 sm:px-6">
      <h1 className="text-4xl font-bold text-gray-900">{title}</h1>
      <p className="mt-2 text-sm text-gray-500">Last updated {SITE.policiesUpdated}</p>
      <div className="mt-8 space-y-6 text-[15px] leading-7 text-gray-700 [&_a]:text-orange-600 [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-900 [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-gray-900">
        {children}
      </div>
    </article>
  );
}
