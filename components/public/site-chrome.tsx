"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SITE } from "@/lib/site";

const APP = `https://${SITE.appHost}`;

/** The Nekter mark: a gradient tile with an N. */
export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-sm font-bold text-white">N</span>
      <span className={`text-lg font-bold ${dark ? "text-white" : "text-gray-900"}`}>{SITE.productName}</span>
    </span>
  );
}

const NAV = [
  { label: "How it works", href: "/#how" },
  { label: "Features", href: "/#features" },
  { label: "Texting", href: "/#texting" },
  { label: "FAQ", href: "/#faq" },
];

/** Fixed header that turns frosted once the page scrolls. */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${scrolled ? "bg-white/80 shadow-sm backdrop-blur-md" : "bg-transparent"}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" aria-label={`${SITE.productName} home`}>
          <Logo />
        </Link>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Sections">
          {NAV.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a href={`${APP}/login`} className="hidden text-sm font-medium text-gray-600 hover:text-gray-900 sm:inline">
            Sign in
          </a>
          <a
            href={`${APP}/login`}
            className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-amber-600 hover:to-orange-600"
          >
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}

const FOOTER_LINKS: Record<string, Array<{ label: string; href: string }>> = {
  Product: [
    { label: "How it works", href: "/#how" },
    { label: "Features", href: "/#features" },
    { label: "Sign in", href: `${APP}/login` },
  ],
  Legal: [
    { label: "Privacy policy", href: "/privacy" },
    { label: "Terms of service", href: "/terms" },
    { label: "Texting terms", href: "/texting" },
  ],
  Contact: [{ label: SITE.supportEmail, href: `mailto:${SITE.supportEmail}` }],
};

export function SiteFooter() {
  return (
    <footer className="bg-gray-900 px-4 py-16 text-white sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-5">
          <div className="col-span-2">
            <Logo dark />
            <p className="mt-4 max-w-xs text-sm text-gray-400">Raw phone footage in, finished reels out. Edited by AI, approved by you.</p>
          </div>
          {Object.entries(FOOTER_LINKS).map(([group, links]) => (
            <div key={group}>
              <h4 className="mb-4 font-semibold">{group}</h4>
              <ul className="space-y-3">
                {links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="break-all text-sm text-gray-400 transition-colors hover:text-white">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-800 pt-8 text-sm text-gray-400">
          © {new Date().getFullYear()} {SITE.businessName}. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
