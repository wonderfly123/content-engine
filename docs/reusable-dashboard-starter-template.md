# Reusable Dashboard Starter Template

A self-contained reference for scaffolding a new Next.js + Supabase + shadcn/ui dashboard with role-based access, admin approval flow, collapsible sidebar, light/dark theme, and Google OAuth.

This document is **copy-pasteable**: every file's complete source is inline. A new Claude session can follow this end-to-end without referencing the source repository.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Supabase Setup](#supabase-setup)
3. [Directory Structure](#directory-structure)
4. [Configuration Files](#configuration-files)
5. [App Files](#app-files)
6. [API Routes](#api-routes)
7. [Layout Components](#layout-components)
8. [Auth Components](#auth-components)
9. [User Menu](#user-menu)
10. [Lib (auth, supabase, stores, theme, utils)](#lib)
11. [shadcn/ui Components](#shadcnui-components)
12. [Customization Guide](#customization-guide)

---

## Quick Start

```bash
# 1. Create a new Next.js app
npx create-next-app@latest my-dashboard --typescript --tailwind --app --no-src-dir --import-alias "@/*"
cd my-dashboard

# 2. Install dependencies
npm install @supabase/supabase-js @tanstack/react-query zustand \
  @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-slot \
  @radix-ui/react-tabs @radix-ui/react-tooltip \
  class-variance-authority clsx tailwind-merge lucide-react date-fns

npm install -D tw-animate-css

# 3. Create the env file
cat > .env.local <<'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
EOF

# 4. Copy every file from this document into the matching path
# 5. Run dev server
npm run dev
```

### Required Environment Variables

| Var | Where to find | Notes |
|-----|---------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project Settings → API | Public, safe to expose |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Project Settings → API → `anon` `public` | Public, safe to expose |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Project Settings → API → `service_role` | **SECRET** — never commit, server-side only |

---

## Supabase Setup

### 1. Create a project

1. Go to https://supabase.com → New Project
2. Note your project URL and `anon` / `service_role` keys (Settings → API)

### 2. Configure email auth

By default, Supabase enables email/password sign-up. Confirm in **Authentication → Providers → Email** that "Enable Email Provider" and "Confirm email" are on.

### 3. Configure Google OAuth

1. Create OAuth 2.0 credentials in [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Set "Authorized redirect URI" to: `https://<YOUR-PROJECT>.supabase.co/auth/v1/callback`
3. In Supabase: **Authentication → Providers → Google** → enable, paste Client ID + Secret
4. Set the **Site URL** (Authentication → URL Configuration) to your dev URL (e.g. `http://localhost:3000`) and add a redirect URL allow-list entry for `http://localhost:3000/complete-profile`.

### 4. Role schema (no DB tables needed)

Roles are stored in Supabase auth's `app_metadata.role` field. There are three values:

- `pending` — default for new signups, no dashboard access
- `user` — approved, normal access
- `admin` — full access, can manage users

Profile fields (first_name, last_name, company, signup_reason) live in `user_metadata`.

### 5. Bootstrap the first admin

After your first user signs up, you have to manually promote them to admin. Run this in **Supabase SQL Editor**:

```sql
update auth.users
set raw_app_meta_data = jsonb_set(
  coalesce(raw_app_meta_data, '{}'::jsonb),
  '{role}',
  '"admin"'
)
where email = 'you@example.com';
```

Sign out and back in, and you'll have admin access. From there, every additional user can be approved via the in-app `/admin` panel.

---

## Directory Structure

```
my-dashboard/
├─ app/
│  ├─ admin/page.tsx
│  ├─ api/
│  │  └─ admin/
│  │     └─ users/
│  │        ├─ route.ts
│  │        └─ [id]/route.ts
│  ├─ complete-profile/page.tsx
│  ├─ login/page.tsx
│  ├─ settings/page.tsx
│  ├─ globals.css
│  ├─ layout.tsx
│  ├─ page.tsx
│  └─ providers.tsx
├─ components/
│  ├─ auth/
│  │  ├─ auth-guard.tsx
│  │  ├─ pending-approval.tsx
│  │  └─ role-guard.tsx
│  ├─ layout/
│  │  ├─ app-header.tsx
│  │  ├─ app-layout.tsx
│  │  ├─ page-container.tsx
│  │  └─ sidebar.tsx
│  ├─ ui/
│  │  ├─ badge.tsx
│  │  ├─ button.tsx
│  │  ├─ card.tsx
│  │  ├─ dialog.tsx
│  │  ├─ dropdown-menu.tsx
│  │  ├─ tabs.tsx
│  │  └─ tooltip.tsx
│  └─ user-menu.tsx
├─ lib/
│  ├─ auth/
│  │  ├─ auth-context.tsx
│  │  ├─ check-approval.ts
│  │  ├─ roles.ts
│  │  ├─ types.ts
│  │  └─ use-auth.ts
│  ├─ stores/
│  │  └─ sidebar-store.ts
│  ├─ supabase/
│  │  ├─ admin.ts
│  │  └─ client.ts
│  ├─ theme/
│  │  └─ theme-context.tsx
│  └─ utils.ts
├─ public/
│  ├─ logo-full.png        (placeholder — replace with your logo)
│  └─ logo-icon.png        (placeholder — replace with your icon)
├─ .env.local               (gitignored)
├─ components.json
├─ eslint.config.mjs
├─ next.config.ts
├─ package.json
├─ postcss.config.mjs
└─ tsconfig.json
```

---

## Configuration Files

### `package.json`

```json
{
  "name": "my-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-tooltip": "^1.2.8",
    "@supabase/supabase-js": "^2.89.0",
    "@tanstack/react-query": "^5.90.12",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "date-fns": "^4.1.0",
    "lucide-react": "^0.562.0",
    "next": "16.1.0",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "tailwind-merge": "^3.4.0",
    "zustand": "^5.0.9"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.1.0",
    "tailwindcss": "^4",
    "tw-animate-css": "^1.4.0",
    "typescript": "^5"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules", "docs/**"]
}
```

### `postcss.config.mjs`

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

### `next.config.ts`

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
```

### `components.json`

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "registries": {}
}
```

### `eslint.config.mjs`

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
```

---

## App Files

### `app/layout.tsx`

```tsx
import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { AppLayout } from "@/components/layout/app-layout";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "My Dashboard",
  description: "Application dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers>
          <AppLayout>{children}</AppLayout>
        </Providers>
      </body>
    </html>
  );
}
```

### `app/page.tsx`

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/login');
}
```

### `app/globals.css`

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-dm-sans);
  --font-mono: var(--font-jetbrains-mono);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --color-brand: var(--brand);
  --color-brand-start: var(--brand-start);
  --color-brand-end: var(--brand-end);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);
  --radius-3xl: calc(var(--radius) + 12px);
  --radius-4xl: calc(var(--radius) + 16px);

  /* Semantic status colors */
  --color-status-success-bg: var(--status-success-bg);
  --color-status-success-text: var(--status-success-text);
  --color-status-success-border: var(--status-success-border);
  --color-status-warning-bg: var(--status-warning-bg);
  --color-status-warning-text: var(--status-warning-text);
  --color-status-warning-border: var(--status-warning-border);
  --color-status-error-bg: var(--status-error-bg);
  --color-status-error-text: var(--status-error-text);
  --color-status-error-border: var(--status-error-border);
  --color-status-info-bg: var(--status-info-bg);
  --color-status-info-text: var(--status-info-text);
  --color-status-info-border: var(--status-info-border);

  /* Interactive states */
  --color-hover-subtle: var(--hover-subtle);
  --color-hover-accent: var(--hover-accent);
  --color-link: var(--link);
  --color-link-hover: var(--link-hover);
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);

  /* Brand colors — REPLACE with your brand */
  --brand: #6366f1;
  --brand-start: #4f46e5;
  --brand-end: #8b5cf6;

  /* Semantic status colors */
  --status-success-bg: oklch(0.95 0.05 145);
  --status-success-text: oklch(0.35 0.15 145);
  --status-success-border: oklch(0.85 0.1 145);

  --status-warning-bg: oklch(0.95 0.08 85);
  --status-warning-text: oklch(0.45 0.15 85);
  --status-warning-border: oklch(0.85 0.12 85);

  --status-error-bg: oklch(0.95 0.05 25);
  --status-error-text: oklch(0.45 0.2 25);
  --status-error-border: oklch(0.85 0.1 25);

  --status-info-bg: oklch(0.95 0.05 250);
  --status-info-text: oklch(0.4 0.15 250);
  --status-info-border: oklch(0.85 0.1 250);

  --hover-subtle: oklch(0.97 0 0);
  --hover-accent: oklch(0.95 0.08 75);

  --link: oklch(0.6 0.16 75);
  --link-hover: oklch(0.5 0.18 75);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);

  --status-success-bg: oklch(0.25 0.06 145);
  --status-success-text: oklch(0.75 0.12 145);
  --status-success-border: oklch(0.35 0.08 145);

  --status-warning-bg: oklch(0.25 0.06 85);
  --status-warning-text: oklch(0.8 0.12 85);
  --status-warning-border: oklch(0.35 0.08 85);

  --status-error-bg: oklch(0.25 0.06 25);
  --status-error-text: oklch(0.75 0.15 25);
  --status-error-border: oklch(0.35 0.1 25);

  --status-info-bg: oklch(0.25 0.05 250);
  --status-info-text: oklch(0.75 0.12 250);
  --status-info-border: oklch(0.35 0.08 250);

  --hover-subtle: oklch(0.25 0 0);
  --hover-accent: oklch(0.3 0.06 75);

  --link: oklch(0.75 0.14 75);
  --link-hover: oklch(0.85 0.16 75);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}

@keyframes pulse {
  0% { opacity: 0.5; }
  100% { opacity: 1; }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.animate-shimmer {
  animation: shimmer 8s linear infinite;
}

@keyframes slideInRight {
  from {
    transform: translateX(100%);
    opacity: 0.8;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.animate-slide-in-right {
  animation: slideInRight 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
```

### `app/providers.tsx`

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { AuthProvider } from '@/lib/auth/auth-context';
import { ThemeProvider } from '@/lib/theme/theme-context';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          {children}
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

### `app/login/page.tsx`

```tsx
'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/use-auth';

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [signupReason, setSignupReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading } = useAuth();
  const returnUrl = searchParams.get('returnUrl') || '/';

  useEffect(() => {
    if (!isLoading && user) {
      router.push(returnUrl);
    }
  }, [user, isLoading, router, returnUrl]);

  if (isLoading || user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (mode === 'signup') {
        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              company: company.trim(),
              signup_reason: signupReason.trim(),
            }
          }
        });

        if (signUpError) throw signUpError;
        if (!authData.user) throw new Error('Signup failed - no user returned');

        setSignupSuccess(true);
        setLoading(false);
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      setError(err.message || 'An error occurred');
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/complete-profile`,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      setLoading(false);
    }
  };

  if (signupSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-md text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-brand/10">
            <svg className="h-8 w-8 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-3xl font-bold text-gray-900">Check your email</h2>
            <p className="mt-4 text-sm text-gray-600">
              We've sent a confirmation link to <span className="font-medium text-gray-900">{email}</span>
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Click the link in the email to confirm your account, then come back here to sign in.
            </p>
          </div>
          <div className="pt-4">
            <button
              onClick={() => {
                setSignupSuccess(false);
                setMode('login');
                setEmail('');
                setPassword('');
                setFirstName('');
                setLastName('');
                setCompany('');
                setSignupReason('');
              }}
              className="text-sm text-brand hover:text-brand/80 font-medium"
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-md">
        <div>
          <h2 className="text-2xl font-bold text-center text-gray-900">
            {mode === 'login' ? 'Sign in' : 'Create an account'}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Dashboard
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleEmailAuth} className="mt-8 space-y-6">
          <div className="space-y-4">
            {mode === 'signup' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                      First Name
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-brand focus:border-brand bg-white text-gray-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                      Last Name
                    </label>
                    <input
                      id="lastName"
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-brand focus:border-brand bg-white text-gray-900"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="company" className="block text-sm font-medium text-gray-700">
                    Company
                  </label>
                  <input
                    id="company"
                    type="text"
                    required
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-brand focus:border-brand bg-white text-gray-900"
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-brand focus:border-brand bg-white text-gray-900"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-brand focus:border-brand bg-white text-gray-900"
              />
            </div>

            {mode === 'signup' && (
              <div>
                <label htmlFor="signupReason" className="block text-sm font-medium text-gray-700">
                  Why are you signing up?
                </label>
                <textarea
                  id="signupReason"
                  required
                  rows={3}
                  value={signupReason}
                  onChange={(e) => setSignupReason(e.target.value)}
                  placeholder="Tell us why you'd like access..."
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-brand focus:border-brand bg-white text-gray-900 placeholder-gray-400"
                />
              </div>
            )}
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Loading...' : mode === 'login' ? 'Sign in' : 'Sign up'}
            </button>
          </div>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">Or continue with</span>
          </div>
        </div>

        <div>
          <button
            onClick={handleGoogleAuth}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
        </div>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            className="text-sm text-brand hover:text-brand/80"
          >
            {mode === 'login'
              ? "Don't have an account? Sign up"
              : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

### `app/complete-profile/page.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/use-auth';

export default function CompleteProfilePage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [signupReason, setSignupReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [checkingProfile, setCheckingProfile] = useState(true);
  const router = useRouter();
  const { user, isLoading, signOut, refreshAuthState } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }

    const hasFirstName = user.user_metadata?.first_name;
    const hasLastName = user.user_metadata?.last_name;
    const hasCompany = user.user_metadata?.company;
    const hasSignupReason = user.user_metadata?.signup_reason;

    if (hasFirstName && hasLastName && hasCompany && hasSignupReason) {
      router.push('/');
      return;
    }

    setFirstName(user.user_metadata.first_name || '');
    setLastName(user.user_metadata.last_name || '');
    setCompany(user.user_metadata.company || '');
    setSignupReason(user.user_metadata.signup_reason || '');

    setCheckingProfile(false);
  }, [user, isLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          company: company.trim(),
          signup_reason: signupReason.trim(),
        }
      });

      if (updateError) throw updateError;

      setSuccess(true);

      if (refreshAuthState) {
        await refreshAuthState();
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      router.push('/');
    } catch (err: any) {
      console.error('Error updating profile:', err);
      setError(err.message || 'Failed to update profile');
      setLoading(false);
    }
  };

  if (isLoading || checkingProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-md">
        <div>
          <h2 className="text-3xl font-bold text-center text-gray-900">
            Complete Your Profile
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            We need a few more details to set up your account
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded flex items-center gap-2">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Profile completed successfully! Redirecting...</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                  First Name *
                </label>
                <input
                  id="firstName"
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-brand focus:border-brand bg-white text-gray-900"
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                  Last Name *
                </label>
                <input
                  id="lastName"
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-brand focus:border-brand bg-white text-gray-900"
                />
              </div>
            </div>

            <div>
              <label htmlFor="company" className="block text-sm font-medium text-gray-700">
                Company *
              </label>
              <input
                id="company"
                type="text"
                required
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-brand focus:border-brand bg-white text-gray-900"
              />
            </div>

            <div>
              <label htmlFor="signupReason" className="block text-sm font-medium text-gray-700">
                Why are you signing up? *
              </label>
              <textarea
                id="signupReason"
                required
                rows={3}
                value={signupReason}
                onChange={(e) => setSignupReason(e.target.value)}
                placeholder="Tell us why you'd like access..."
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-brand focus:border-brand bg-white text-gray-900 placeholder-gray-400"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : 'Complete Profile'}
            </button>
          </div>

          <div className="text-center">
            <button
              type="button"
              onClick={signOut}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Sign out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

### `app/admin/page.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { RoleGuard } from '@/components/auth/role-guard';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/use-auth';
import { clearApprovalCache } from '@/lib/auth/check-approval';
import type { UserRole } from '@/lib/auth/types';

interface User {
  id: string;
  email: string;
  created_at: string;
  email_confirmed_at: string | null;
  role: UserRole;
  first_name?: string;
  last_name?: string;
  company?: string;
  signup_reason?: string;
}

export default function AdminPage() {
  return (
    <RoleGuard allowedRoles={['admin']}>
      <AdminContent />
    </RoleGuard>
  );
}

function AdminContent() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ userId: string; email: string; name: string; action: 'reject' | 'delete' } | null>(null);
  const { user: currentUser } = useAuth();

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Not authenticated');
        return;
      }

      const response = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch users');
      }

      const data = await response.json();
      setUsers(data.users);
    } catch (err: any) {
      console.error('Error fetching users:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleUpdateRole = async (userId: string, email: string, newRole: UserRole) => {
    setActionLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: newRole }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update role');
      }

      setSuccess(`Successfully updated ${email} to ${newRole}`);
      clearApprovalCache();
      await fetchUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const showDeleteConfirmation = (userId: string, email: string, firstName?: string, lastName?: string, action: 'reject' | 'delete' = 'delete') => {
    if (userId === currentUser?.id) {
      setError('You cannot delete your own account');
      return;
    }
    const name = firstName && lastName ? `${firstName} ${lastName}` : email;
    setDeleteModal({ userId, email, name, action });
  };

  const handleDeleteUser = async () => {
    if (!deleteModal) return;

    const { userId, email, action } = deleteModal;
    setDeleteModal(null);
    setActionLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete user');
      }

      setSuccess(action === 'reject' ? `Rejected ${email}` : `Deleted ${email}`);
      clearApprovalCache();
      await fetchUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const pendingUsers = users.filter(u => u.role === 'pending');
  const approvedUsers = users.filter(u => u.role !== 'pending');

  return (
    <PageContainer>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin</h1>
      </div>

      {error && (
        <div className="mb-4 bg-status-error-bg border border-status-error-border text-status-error-text px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 bg-status-success-bg border border-status-success-border text-status-success-text px-4 py-3 rounded-lg">
          {success}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading users...</p>
        </div>
      ) : (
        <>
          {/* Pending Users */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Pending Approvals</h2>
              {pendingUsers.length > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-brand/10 dark:bg-brand/20 text-brand rounded-full">
                  {pendingUsers.length}
                </span>
              )}
            </div>

            {pendingUsers.length === 0 ? (
              <div className="text-center py-12">
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No pending approvals</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingUsers.map((user) => (
                  <div key={user.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                            {user.first_name} {user.last_name}
                          </h3>
                          <span className="px-2 py-0.5 text-xs font-medium bg-status-warning-bg text-status-warning-text rounded">
                            Pending
                          </span>
                          {!user.email_confirmed_at && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                              Email unconfirmed
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{user.email}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{user.company}</p>
                        {user.signup_reason && (
                          <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-900 rounded text-sm text-gray-700 dark:text-gray-300">
                            <span className="font-medium">Reason:</span> {user.signup_reason}
                          </div>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                          Signed up: {new Date(user.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => handleUpdateRole(user.id, user.email, 'user')}
                          disabled={actionLoading}
                          className="px-3 py-1.5 bg-brand text-white text-sm rounded-md hover:bg-brand/90 disabled:opacity-50 font-medium"
                        >
                          Approve as User
                        </button>
                        <button
                          onClick={() => handleUpdateRole(user.id, user.email, 'admin')}
                          disabled={actionLoading}
                          className="px-3 py-1.5 bg-gray-600 text-white text-sm rounded-md hover:bg-gray-700 disabled:opacity-50 font-medium"
                        >
                          Approve as Admin
                        </button>
                        <button
                          onClick={() => showDeleteConfirmation(user.id, user.email, user.first_name, user.last_name, 'reject')}
                          disabled={actionLoading}
                          className="px-3 py-1.5 text-red-600 dark:text-red-400 text-sm rounded-md border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50 font-medium"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Approved Users */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Approved Users</h2>
              <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-status-success-bg text-status-success-text rounded-full">
                {approvedUsers.length}
              </span>
            </div>

            {approvedUsers.length === 0 ? (
              <div className="text-center py-12">
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No approved users yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Email</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Company</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Created</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Role</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {approvedUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {user.first_name} {user.last_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {user.email}
                          {user.email === currentUser?.email && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand/10 text-brand">
                              You
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {user.company || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {new Date(user.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <select
                            value={user.role}
                            onChange={(e) => handleUpdateRole(user.id, user.email, e.target.value as UserRole)}
                            disabled={actionLoading}
                            className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {user.email === currentUser?.email ? (
                            <span className="text-gray-400 text-sm">Can&apos;t delete yourself</span>
                          ) : (
                            <button
                              onClick={() => showDeleteConfirmation(user.id, user.email, user.first_name, user.last_name)}
                              disabled={actionLoading}
                              className="text-red-600 dark:text-red-400 hover:text-red-900 disabled:opacity-50 font-medium"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Delete/Reject Confirmation Modal */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {deleteModal.action === 'reject' ? 'Reject User' : 'Delete User'}
              </h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Are you sure you want to {deleteModal.action === 'reject' ? 'reject' : 'delete'}{' '}
                <span className="font-medium text-gray-900 dark:text-white">{deleteModal.name}</span>?
              </p>
              <p className="mt-2 text-sm text-gray-500">
                This will permanently delete their account. This action cannot be undone.
              </p>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 flex justify-end gap-3">
              <button
                onClick={() => setDeleteModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteUser}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                {deleteModal.action === 'reject' ? 'Reject User' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
```

### `app/settings/page.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { useAuth } from '@/lib/auth/use-auth';
import { supabase } from '@/lib/supabase/client';
import { User, Mail, Building2, Check, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/lib/theme/theme-context';

export default function SettingsPage() {
  const { user, refreshAuthState } = useAuth();
  const { theme, setTheme } = useTheme();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setFirstName(user.user_metadata?.first_name || '');
      setLastName(user.user_metadata?.last_name || '');
      setCompany(user.user_metadata?.company || '');
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          company: company.trim(),
        },
      });

      if (updateError) throw updateError;

      setSuccess(true);
      if (refreshAuthState) {
        await refreshAuthState();
      }

      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error updating profile:', err);
      setError(err.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer>
      <div className="max-w-2xl">
        {/* Profile Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Profile</h2>
            </div>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Manage your personal information
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                <Check className="w-4 h-4" />
                Profile updated successfully
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  First Name
                </label>
                <input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Last Name
                </label>
                <input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label htmlFor="company" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Company
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  id="company"
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>

        {/* Appearance Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm mt-6">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <Sun className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Appearance</h2>
            </div>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Customize how the dashboard looks
            </p>
          </div>

          <div className="p-6">
            <div className="flex flex-col gap-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Theme</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setTheme('light')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                    theme === 'light'
                      ? 'border-brand bg-hover-accent text-link'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <Sun className="w-5 h-5" />
                  <span className="text-sm font-medium">Light</span>
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                    theme === 'dark'
                      ? 'border-brand bg-hover-accent text-link'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <Moon className="w-5 h-5" />
                  <span className="text-sm font-medium">Dark</span>
                </button>
                <button
                  onClick={() => setTheme('system')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                    theme === 'system'
                      ? 'border-brand bg-hover-accent text-link'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <Monitor className="w-5 h-5" />
                  <span className="text-sm font-medium">System</span>
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                System will automatically switch between light and dark based on your device settings.
              </p>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
```

---

## API Routes

### `app/api/admin/users/route.ts`

```ts
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userRole = user.app_metadata?.role;
    if (userRole !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();

    if (error) {
      console.error('Error fetching users:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const transformedUsers = users.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      email_confirmed_at: u.email_confirmed_at,
      role: u.app_metadata?.role || 'pending',
      first_name: u.user_metadata?.first_name,
      last_name: u.user_metadata?.last_name,
      company: u.user_metadata?.company,
      signup_reason: u.user_metadata?.signup_reason,
    }));

    return NextResponse.json({ users: transformedUsers });
  } catch (error: unknown) {
    console.error('Error in GET /api/admin/users:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
```

### `app/api/admin/users/[id]/route.ts`

```ts
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

async function verifyAdmin(authHeader: string | null) {
  if (!authHeader) {
    return { error: 'Unauthorized', status: 401 };
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return { error: 'Unauthorized', status: 401 };
  }

  const userRole = user.app_metadata?.role;
  if (userRole !== 'admin') {
    return { error: 'Forbidden - Admin access required', status: 403 };
  }

  return { user };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const adminCheck = await verifyAdmin(authHeader);

    if ('error' in adminCheck) {
      return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
    }

    const { role } = await request.json();
    const { id: userId } = await params;

    if (!role || !['admin', 'user', 'pending'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { app_metadata: { role } }
    );

    if (error) {
      console.error('Error updating user role:', error);
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }

    return NextResponse.json({ success: true, user: data.user });
  } catch (error: unknown) {
    console.error('Error in PATCH /api/admin/users/[id]:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    const adminCheck = await verifyAdmin(authHeader);

    if ('error' in adminCheck) {
      return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
    }

    const { id: userId } = await params;

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (error) {
      console.error('Error deleting user:', error);
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error in DELETE /api/admin/users/[id]:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
```

---

## Layout Components

### `components/layout/sidebar.tsx`

This is the **generic** sidebar — replace `navItems` with your own pages. The home button in the header navigates to `/`.

```tsx
'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Home, Settings, LayoutDashboard, LucideIcon } from 'lucide-react';
import { useSidebarStore } from '@/lib/stores/sidebar-store';
import { UserMenu } from '@/components/user-menu';
import { useAuth } from '@/lib/auth/use-auth';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

// REPLACE these with your application's pages
const navItems: NavItem[] = [
  { name: 'Home', href: '/', icon: Home },
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isCollapsed, setCollapsed } = useSidebarStore();
  const { user } = useAuth();
  const collapseTimeout = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (collapseTimeout.current) {
      clearTimeout(collapseTimeout.current);
      collapseTimeout.current = null;
    }
    setCollapsed(false);
  };

  const handleMouseLeave = () => {
    collapseTimeout.current = setTimeout(() => {
      setCollapsed(true);
    }, 150);
  };

  const firstName = user?.user_metadata?.first_name || '';
  const lastName = user?.user_metadata?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();

  const getInitials = () => {
    if (firstName && lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    }
    if (firstName) {
      return firstName.charAt(0).toUpperCase();
    }
    return (user?.email || 'U').charAt(0).toUpperCase();
  };

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'fixed left-0 top-0 h-screen bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 z-50 flex flex-col transition-[width] duration-200 ease-out overflow-hidden',
        isCollapsed ? 'w-[52px]' : 'w-[220px]'
      )}
    >
      {/* Header — replace with your logo */}
      <div
        className="border-b border-gray-200 dark:border-gray-800 px-3 min-h-[56px] flex items-center cursor-pointer"
        onClick={() => router.push('/')}
      >
        <div className={cn('font-bold text-brand', isCollapsed ? 'text-xl' : 'text-lg')}>
          {isCollapsed ? 'D' : 'Dashboard'}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 py-2.5 pl-4 pr-3 text-[13px] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white border-l-2 font-medium',
                isActive
                  ? 'bg-brand/10 dark:bg-brand/20 text-brand dark:text-brand border-brand'
                  : 'border-transparent'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className={cn(
                "whitespace-nowrap overflow-hidden transition-opacity duration-200",
                isCollapsed ? "opacity-0 w-0" : "opacity-100"
              )}>
                {item.name}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* User Profile */}
      <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-3">
        {isCollapsed ? (
          <div className="pl-0.5">
            <div
              className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center font-medium text-[10px] flex-shrink-0"
              title={fullName || user?.email || 'User'}
            >
              {getInitials()}
            </div>
          </div>
        ) : (
          <UserMenu />
        )}
      </div>
    </aside>
  );
}
```

### `components/layout/app-layout.tsx`

```tsx
'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { AppHeader } from './app-header';
import { useSidebarStore } from '@/lib/stores/sidebar-store';
import { useAuth } from '@/lib/auth/use-auth';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isCollapsed = useSidebarStore((state) => state.isCollapsed);
  const { isApproved, isLoading } = useAuth();

  // Public routes that don't need sidebar/header
  const publicRoutes = ['/login', '/reset-password', '/complete-profile'];
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

  // Hide layout for public routes OR pending users
  if (isPublicRoute || (!isLoading && !isApproved)) {
    return <>{children}</>;
  }

  const sidebarWidth = isCollapsed ? 52 : 220;

  return (
    <div className="flex h-screen overflow-hidden w-screen">
      <Sidebar />
      <div
        className="flex flex-col overflow-hidden transition-[margin,width] duration-200 ease-out"
        style={{
          marginLeft: `${sidebarWidth}px`,
          width: `calc(100vw - ${sidebarWidth}px)`,
        }}
      >
        <AppHeader />
        <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 h-full w-full">{children}</main>
      </div>
    </div>
  );
}
```

### `components/layout/app-header.tsx`

```tsx
'use client';

import { usePathname } from 'next/navigation';
import { useTheme } from '@/lib/theme/theme-context';
import { Sun, Moon, Monitor } from 'lucide-react';

// Map paths to header titles. Add your pages here.
const pageTitles: Record<string, string> = {
  '/': 'Home',
  '/dashboard': 'Dashboard',
  '/settings': 'Settings',
  '/admin': 'Admin Panel',
};

export function AppHeader() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  const pageTitle = pageTitles[pathname] || 'Dashboard';

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <header className="border-b border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm sticky top-0 z-40">
      <div className="px-8 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{pageTitle}</h1>

          <div className="flex items-center gap-2">
            <button
              onClick={cycleTheme}
              className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={`Theme: ${theme}`}
            >
              <ThemeIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
```

### `components/layout/page-container.tsx`

```tsx
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageContainerProps {
  children: ReactNode;
  title?: string;
  description?: string;
  className?: string;
}

export function PageContainer({
  children,
  title,
  description,
  className,
}: PageContainerProps) {
  return (
    <div className={cn('container mx-auto px-6 py-8', className)}>
      {(title || description) && (
        <div className="mb-8">
          {title && <h2 className="text-3xl font-bold text-gray-900 dark:text-white">{title}</h2>}
          {description && (
            <p className="mt-2 text-gray-600 dark:text-gray-400">{description}</p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
```

---

## Auth Components

### `components/auth/auth-guard.tsx`

Wrap any protected page in `<AuthGuard>` to require authentication. Pending users see the `PendingApproval` screen.

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth/use-auth';
import { PendingApproval } from './pending-approval';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isApproved } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !user) {
      const returnUrl = pathname + (typeof window !== 'undefined' ? window.location.search : '');
      router.push(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
    }

    // Check profile completion for approved users
    if (!isLoading && user && isApproved) {
      const hasFirstName = user.user_metadata?.first_name;
      const hasLastName = user.user_metadata?.last_name;
      const hasCompany = user.user_metadata?.company;
      const hasSignupReason = user.user_metadata?.signup_reason;

      if (!hasFirstName || !hasLastName || !hasCompany || !hasSignupReason) {
        router.push('/complete-profile');
      }
    }
  }, [user, isLoading, isApproved, router, pathname]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
          <div className="text-gray-600 dark:text-gray-400 font-medium">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!isApproved) {
    return <PendingApproval />;
  }

  return <>{children}</>;
}
```

### `components/auth/role-guard.tsx`

Generic role-based protection. Redirects unauthorized users to `/`.

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/use-auth';
import type { UserRole } from '@/lib/auth/types';

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
}

export function RoleGuard({ children, allowedRoles }: RoleGuardProps) {
  const { role, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && role && !allowedRoles.includes(role)) {
      router.push('/'); // Redirect to safe default
    }
  }, [role, isLoading, allowedRoles, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!role || !allowedRoles.includes(role)) {
    return null;
  }

  return <>{children}</>;
}
```

### `components/auth/pending-approval.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth/use-auth';
import { clearApprovalCache } from '@/lib/auth/check-approval';
import { supabase } from '@/lib/supabase/client';

export function PendingApproval() {
  const { user, signOut, refreshAuthState } = useAuth();
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      await checkApprovalStatus();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const checkApprovalStatus = async () => {
    setChecking(true);
    try {
      clearApprovalCache();
      await supabase.auth.refreshSession();

      if (refreshAuthState) {
        await refreshAuthState();
      }

      setLastChecked(new Date());
    } catch (error) {
      console.error('Error checking approval status:', error);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full p-8 bg-white dark:bg-gray-800 rounded-lg shadow-md">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-status-warning-bg">
            <svg className="h-6 w-6 text-status-warning-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">
            Pending Approval
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Your account is pending approval. You'll receive access once an administrator approves your account.
          </p>
          <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-md">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{user?.email}</p>
          </div>

          <div className="mt-6 space-y-3">
            <button
              onClick={checkApprovalStatus}
              disabled={checking}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {checking ? 'Checking...' : 'Check Approval Status'}
            </button>

            {lastChecked && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Last checked: {lastChecked.toLocaleTimeString()}
              </p>
            )}

            <button
              onClick={signOut}
              className="w-full flex justify-center py-2 px-4 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              Logout
            </button>
          </div>

          <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
            Status is automatically checked every 30 seconds
          </p>
        </div>
      </div>
    </div>
  );
}
```

---

## User Menu

### `components/user-menu.tsx`

```tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/use-auth';
import { isAdmin } from '@/lib/auth/roles';

export function UserMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const { user, role, signOut } = useAuth();
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  const firstName = user.user_metadata?.first_name || '';
  const lastName = user.user_metadata?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const displayName = fullName || user.email || 'User';

  const getInitials = (_name: string) => {
    if (firstName && lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    }
    if (firstName) {
      return firstName.charAt(0).toUpperCase();
    }
    return (user.email || 'U').charAt(0).toUpperCase();
  };

  const handleLogout = async () => {
    setIsOpen(false);
    await signOut();
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 pl-0.5 pr-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center font-medium text-[10px]">
          {getInitials(displayName)}
        </div>
        <span className="text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate max-w-[120px]">{displayName}</span>
        <svg
          className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 bottom-full mb-2 w-52 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
          <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
            {fullName && (
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{fullName}</p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user.email}</p>
          </div>

          <button
            onClick={() => {
              router.push('/settings');
              setIsOpen(false);
            }}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>

          {isAdmin(role) && (
            <button
              onClick={() => {
                router.push('/admin');
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              Admin Panel
            </button>
          )}

          <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
            <button
              onClick={handleLogout}
              className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Lib

### `lib/auth/types.ts`

```ts
import type { User } from '@supabase/supabase-js';

export type UserRole = 'pending' | 'user' | 'admin';

export interface AuthState {
  user: User | null;
  role: UserRole | null;
  isLoading: boolean;
  isApproved: boolean;
}
```

### `lib/auth/roles.ts`

```ts
import type { UserRole } from './types';

export const ADMIN_ROUTES = ['/admin'];

export function canAccessRoute(userRole: UserRole | null, path: string): boolean {
  if (!userRole) return false;

  const isAdminRoute = ADMIN_ROUTES.some(route => path.startsWith(route));

  if (isAdminRoute) {
    return userRole === 'admin';
  }

  return true;
}

export function isAdmin(role: UserRole | null): boolean {
  return role === 'admin';
}
```

### `lib/auth/check-approval.ts`

```ts
import type { User } from '@supabase/supabase-js';
import type { UserRole } from './types';

const approvalCache = new Map<string, {
  isApproved: boolean;
  role: UserRole | null;
  timestamp: number;
}>();

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export function clearApprovalCache(userId?: string) {
  if (userId) {
    approvalCache.delete(userId);
  } else {
    approvalCache.clear();
  }
}

export function getUserApprovalStatus(user: User | null): {
  isApproved: boolean;
  role: UserRole | null;
} {
  if (!user) {
    return { isApproved: false, role: null };
  }

  const cached = approvalCache.get(user.id);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return { isApproved: cached.isApproved, role: cached.role };
  }

  const role = (user.app_metadata?.role as UserRole) || 'pending';
  const isApproved = role === 'user' || role === 'admin';

  const result = { isApproved, role };

  approvalCache.set(user.id, { ...result, timestamp: Date.now() });
  return result;
}
```

### `lib/auth/auth-context.tsx`

```tsx
'use client';

import { createContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { getUserApprovalStatus } from './check-approval';
import type { AuthState } from './types';

interface AuthContextValue extends AuthState {
  signOut: () => Promise<void>;
  refreshAuthState: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: null,
    isLoading: true,
    isApproved: false,
  });
  const router = useRouter();

  const loadAuthState = async () => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session?.user) {
        setState({
          user: null,
          role: null,
          isLoading: false,
          isApproved: false,
        });
        return;
      }

      const { isApproved, role } = getUserApprovalStatus(session.user);

      setState({
        user: session.user,
        role,
        isLoading: false,
        isApproved,
      });
    } catch (error) {
      console.error('Error loading auth state:', error);
      setState({
        user: null,
        role: null,
        isLoading: false,
        isApproved: false,
      });
    }
  };

  useEffect(() => {
    loadAuthState();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            const { isApproved, role } = getUserApprovalStatus(session.user);
            setState({
              user: session.user,
              role,
              isLoading: false,
              isApproved,
            });
          }
        } else if (event === 'SIGNED_OUT') {
          setState({
            user: null,
            role: null,
            isLoading: false,
            isApproved: false,
          });
          router.push('/login');
        } else if (event === 'INITIAL_SESSION') {
          if (session?.user) {
            const { isApproved, role } = getUserApprovalStatus(session.user);
            setState({
              user: session.user,
              role,
              isLoading: false,
              isApproved,
            });
          } else {
            setState({
              user: null,
              role: null,
              isLoading: false,
              isApproved: false,
            });
          }
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshAuthState = async () => {
    await loadAuthState();
  };

  return (
    <AuthContext.Provider value={{ ...state, signOut, refreshAuthState }}>
      {children}
    </AuthContext.Provider>
  );
}
```

### `lib/auth/use-auth.ts`

```ts
'use client';

import { useContext } from 'react';
import { AuthContext } from './auth-context';

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
```

### `lib/supabase/client.ts`

Generic browser client. Drop the custom `x-client-info` header or rename it for your app.

```ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
  db: {
    schema: 'public',
  },
});
```

### `lib/supabase/admin.ts`

```ts
import { createClient } from '@supabase/supabase-js';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase server environment variables');
}

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
```

### `lib/stores/sidebar-store.ts`

```ts
import { create } from 'zustand';

interface SidebarStore {
  isCollapsed: boolean;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  isCollapsed: true,
  toggleCollapsed: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
  setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
}));
```

### `lib/theme/theme-context.tsx`

Generic — uses `dashboard-theme` localStorage key (rename to suit your app).

```tsx
'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'dashboard-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  const getSystemTheme = (): 'light' | 'dark' => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const applyTheme = (resolved: 'light' | 'dark') => {
    const root = document.documentElement;
    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    setResolvedTheme(resolved);
  };

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initialTheme = stored || 'system';
    setThemeState(initialTheme);

    const resolved = initialTheme === 'system' ? getSystemTheme() : initialTheme;
    applyTheme(resolved);
    setMounted(true);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      if (theme === 'system') {
        applyTheme(getSystemTheme());
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);

    const resolved = newTheme === 'system' ? getSystemTheme() : newTheme;
    applyTheme(resolved);
  };

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    return {
      theme: 'system' as Theme,
      setTheme: () => {},
      resolvedTheme: 'light' as const,
    };
  }
  return context;
}
```

### `lib/utils.ts`

```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

## shadcn/ui Components

These are stock shadcn/ui (new-york style) components. You can also `npx shadcn@latest add button card badge tabs dialog dropdown-menu tooltip` to regenerate them, but the source is included here for reference.

### `components/ui/button.tsx`

```tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
```

### `components/ui/card.tsx`

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
```

### `components/ui/badge.tsx`

```tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
```

### `components/ui/tabs.tsx`

```tsx
"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "data-[state=active]:bg-background dark:data-[state=active]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 text-foreground dark:text-muted-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
```

### `components/ui/dialog.tsx`

```tsx
"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 outline-none sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
```

### `components/ui/dropdown-menu.tsx`

```tsx
"use client"

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1.5 text-sm font-medium data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "text-muted-foreground ml-auto text-xs tracking-widest",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-md border p-1 shadow-lg",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
```

### `components/ui/tooltip.tsx`

```tsx
"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
```

---

## Customization Guide

### 1. Add nav items

Edit `components/layout/sidebar.tsx`:

```tsx
import { Home, Settings, LayoutDashboard, BarChart3, Users } from 'lucide-react';

const navItems: NavItem[] = [
  { name: 'Home',       href: '/',          icon: Home },
  { name: 'Dashboard',  href: '/dashboard', icon: LayoutDashboard },
  { name: 'Analytics',  href: '/analytics', icon: BarChart3 },
  { name: 'Customers',  href: '/customers', icon: Users },
  { name: 'Settings',   href: '/settings',  icon: Settings },
];
```

Then update `components/layout/app-header.tsx` `pageTitles` map so the header shows the right title for that route.

### 2. Add a new protected page

```tsx
// app/dashboard/page.tsx
'use client';

import { AuthGuard } from '@/components/auth/auth-guard';
import { PageContainer } from '@/components/layout/page-container';

export default function DashboardPage() {
  return (
    <AuthGuard>
      <PageContainer title="Dashboard" description="Your main overview">
        {/* your content */}
      </PageContainer>
    </AuthGuard>
  );
}
```

For an admin-only page, wrap with `<RoleGuard allowedRoles={['admin']}>` (the `AuthGuard` is implied by the layout flow).

### 3. Change branding

- **Brand color**: edit `app/globals.css` — set `--brand`, `--brand-start`, `--brand-end` in the `:root` block.
- **App name**: edit `app/layout.tsx` `metadata.title`, the sidebar header in `components/layout/sidebar.tsx`, and the login subtitle in `app/login/page.tsx`.
- **Logo**: drop `logo-full.png` and `logo-icon.png` into `public/`, then swap the text in the sidebar header for `<Image>` tags pointing at those files.
- **Fonts**: edit `app/layout.tsx` — the template uses DM Sans + JetBrains Mono. Replace with any Google Font.
- **localStorage theme key**: edit `STORAGE_KEY` in `lib/theme/theme-context.tsx` to namespace per-app.

### 4. Verify the build

```bash
npm run lint
npm run build
npm run dev
```

The dev server should boot and `/login` should render. Sign up your first user, then promote them to `admin` via the SQL snippet in [Supabase Setup](#supabase-setup).

---

## Auth flow summary

1. Visitor lands on any route → `AuthGuard` redirects to `/login` if no session.
2. Sign up (email or Google) creates a Supabase auth user with `role = 'pending'` by default (the `app_metadata.role` field is unset; `getUserApprovalStatus` defaults missing roles to `'pending'`).
3. Email signup: user clicks confirmation link from email, returns to `/login`.
4. Google signup: redirected to `/complete-profile` to fill in first/last name, company, signup reason.
5. After login, `AuthGuard` checks `isApproved`. Pending users see `PendingApproval` (auto-polls every 30s).
6. Admin visits `/admin`, approves the user → `app_metadata.role` becomes `'user'` or `'admin'`.
7. User refreshes; `getUserApprovalStatus` returns `isApproved = true`; they get full access.
8. Admins additionally see the "Admin Panel" link in the user menu and can access `/admin`.
