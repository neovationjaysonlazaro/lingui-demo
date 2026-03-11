# Lingui + Next.js App Router — Production-Readiness Architecture Review

**Review date:** 2026-03-10
**Stack:** Next.js 16.1.6 · React 19.2.3 · @lingui/core 5.9.2 · @lingui/swc-plugin 5.11.0 · Tailwind 4 · TypeScript 5
**Rendering strategy:** All routes fully static (SSG) via `generateStaticParams`
**Locale count:** 2 (en, es) · **String count:** 10 per locale · **All translations complete**

---

## 1. Architecture Summary

### Routing & Locale Segments

The app uses a single `[lang]` dynamic segment under `src/app/[lang]/` to partition all localized content. Two leaf pages exist (`page.tsx` and `hellotesting/page.tsx`), along with a translated 404 page (`not-found.tsx`) and a translated error boundary (`error.tsx`). The root layout at `src/app/layout.tsx` sits outside the `[lang]` segment — it owns `<html>`, `<body>`, fonts, global CSS, and static metadata. It calls no dynamic APIs, which preserves full SSG across the entire app.

`generateStaticParams` in `src/app/[lang]/layout.tsx` reads from `lingui.config.ts` to emit one static build per supported locale. The build output confirms every route is prerendered:

```
Route (app)
├ ○ /_not-found
├ ● /[lang]              → /en, /es
└ ● /[lang]/hellotesting → /en/hellotesting, /es/hellotesting
```

### Locale Resolution

Locale resolution follows a three-tier priority chain inside `src/middleware.ts`:

1. **URL prefix** — If the pathname starts with a known locale (`/en/...`, `/es/...`), the request passes through. The middleware sets a `NEXT_LOCALE` cookie (1-year expiry, `sameSite: lax`) and injects an `x-locale` request header for potential downstream use.
2. **Cookie** — If the URL has no valid locale prefix, `getRequestLocale()` checks the `NEXT_LOCALE` cookie against the whitelist.
3. **Accept-Language** — If no cookie exists, the `negotiator` library matches the browser's `Accept-Language` header against supported locales.

The resolved locale is used to redirect the user to the correct prefixed URL (e.g. `/` → `/en`).

### Invalid Locale Handling

Two layers of validation prevent unsupported locales from rendering:

- **Middleware layer:** Any pathname whose first segment looks like a locale (`/^[a-z]{2}(-[a-z]{2})?$/i`) but isn't in the whitelist gets stripped and redirected. For example, `/fr/about` → `/en/about` (assuming English is the resolved preference). This prevents nested-junk URLs like `/en/fr/about`.
- **Layout layer:** `src/app/[lang]/layout.tsx` calls `getAllLocales().includes(lang)` and triggers `notFound()` for any locale that somehow bypasses middleware (direct server-side navigation, cached route manifests, etc.).
- **Catalog loader layer:** `getI18nInstance()` in `src/lib/i18n.ts` validates the locale parameter against the config whitelist before any `import()` call. Invalid locales fall back to `"en"` with a `console.warn`. This is defense-in-depth — it should never be reached in normal operation.

### Translation Catalog Loading

`src/lib/i18n.ts` is guarded by `import "server-only"` — it cannot be imported from client components. Catalogs are loaded lazily via dynamic `import(`../locales/${locale}.ts`)` and cached in a `Map<string, Messages>`. A second `Map<string, I18n>` caches fully-constructed `I18n` instances. After the first request for a given locale, all subsequent requests reuse cached data with zero allocation.

The compiled catalog files (`src/locales/en.ts`, `src/locales/es.ts`) use `JSON.parse()` for the message payload. V8 parses `JSON.parse(string)` faster than equivalent JavaScript object literals — this is the recommended Lingui pattern for performance.

### Server-Side i18n

Every Server Component page calls `getI18nInstance(lang)` then `setI18n(i18n)` from `@lingui/react/server`. This is required because Lingui's RSC integration stores the i18n instance in an async-local-storage-like scope — each Server Component execution context needs its own `setI18n` call. The `[lang]/layout.tsx` calls `setI18n` for layout-level rendering, and each page calls it again for page-level rendering. `<Trans>` from `@lingui/react/macro` is then used for translatable strings.

### Client-Side i18n

`src/components/LinguiClientProvider.tsx` wraps children with Lingui's `I18nProvider`. It receives `initialLocale` and `initialMessages` as serialized props from the server layout, then constructs a client-side `I18n` instance via `useMemo`. The memo is keyed on both `initialLocale` and `initialMessages`, so the instance rebuilds when the user switches languages — no stale state persists across locale changes.

Client components (`not-found.tsx`, `error.tsx`) inherit i18n context from this provider without needing their own setup. They use `<Trans>` from `@lingui/react/macro` directly.

### Language Switching

`src/components/LanguageSwitcher.tsx` renders a `<select>` dropdown populated from `lingui.config.ts`. On change, it reads the current pathname via `usePathname()`, swaps the first path segment (the locale), and calls `router.push()` with the new path. This triggers a server-side re-render that loads the new locale's layout, which in turn passes the new messages to `LinguiClientProvider`.

### Middleware

`src/middleware.ts` handles all locale routing concerns:

- Locale-prefixed requests pass through with cookie persistence and header injection.
- Bare URLs (`/`, `/about`) get redirected to the preferred-locale-prefixed version.
- Unknown locale-like prefixes (`/fr/...` when `fr` is not supported) get stripped and redirected.
- The matcher excludes `/api`, `_next/static`, `_next/image`, `favicon.ico`, and common image extensions.

### Build Tooling

`@lingui/swc-plugin` handles compile-time transformation of `<Trans>` macros into runtime calls. The `package.json` includes `lingui:extract` and `lingui:compile` scripts for the catalog workflow. `lingui.config.ts` defines a single catalog covering all of `src/`.

---

## 2. Critical Issues — None Found

No high-severity blockers exist. The architecture correctly handles:

- Locale routing with `[lang]` segments and `generateStaticParams`
- Dual-layer validation (middleware + layout `notFound()`)
- Lazy catalog loading with caching and `server-only` guard
- Server and client i18n context separation
- Translated error boundaries and 404 pages
- Full SSG with no dynamic rendering forced
- Cookie-based locale persistence
- Safe dynamic imports with validated locale parameters

---

## 3. Medium Risks

### 3.1 `setI18n()` boilerplate in every Server Component page

**Affected files:** `src/app/[lang]/page.tsx`, `src/app/[lang]/hellotesting/page.tsx`

Every page must repeat this three-line sequence:

```ts
const { lang } = await params;
const i18n = await getI18nInstance(lang);
setI18n(i18n);
```

Lingui requires `setI18n` in the same Server Component execution scope that uses `<Trans>`. The layout's `setI18n` call does not propagate to child page components during static generation. Omitting it causes a build-time error (`"i18n instance for RSC hasn't been setup"`), which is a safe failure mode — but easy to overlook during code review as the codebase grows.

**Recommended fix:** Add a convenience wrapper to `src/lib/i18n.ts`:

```ts
import { setI18n } from "@lingui/react/server";

export async function activateI18n(lang: string) {
  const i18n = await getI18nInstance(lang);
  setI18n(i18n);
  return { lang, i18n };
}
```

Pages then become a single call:

```tsx
export default async function Page({ params }: Props) {
  const { lang } = await activateI18n((await params).lang);
  // ...
}
```

This reduces per-page boilerplate from three lines to one and eliminates the risk of forgetting `setI18n`.

### 3.2 Hardcoded locale interpolation in Link hrefs

**Affected files:** `src/app/[lang]/page.tsx` (line 32), `src/app/[lang]/hellotesting/page.tsx` (line 32)

Every internal link manually constructs the locale prefix:

```tsx
<Link href={`/${lang}/hellotesting`}>
```

This works correctly but becomes fragile at scale. Forgetting the prefix on any link produces a broken route that middleware will redirect — adding an unnecessary round trip and breaking client-side navigation expectations.

**Recommended fix:** Create a `LocaleLink` wrapper:

```tsx
// src/components/LocaleLink.tsx
"use client";
import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";

type Props = Omit<LinkProps, "href"> & {
  href: string;
  children: React.ReactNode;
  className?: string;
};

export function LocaleLink({ href, ...props }: Props) {
  const pathname = usePathname();
  const locale = pathname.split("/")[1];
  const localizedHref = href.startsWith("/") ? `/${locale}${href}` : href;
  return <Link href={localizedHref} {...props} />;
}
```

Usage becomes `<LocaleLink href="/hellotesting">` — no manual interpolation needed.

### 3.3 LanguageSwitcher drops query parameters and hash fragments

**Affected file:** `src/components/LanguageSwitcher.tsx` (lines 17–21)

`usePathname()` returns only the pathname portion of the URL. A URL like `/en/search?q=hello#results` becomes `/es/search` after switching — the query string and hash fragment are silently lost.

**Current impact:** Low, because no existing routes use query parameters. But this becomes a real bug the moment search pages, filtered lists, or any query-param-dependent routes are added.

**Recommended fix:**

```tsx
const switchLocale = (newLocale: string) => {
  const newSegments = [...segments];
  newSegments[1] = newLocale;
  const newPath = newSegments.join("/");
  const { search, hash } = window.location;
  router.push(`${newPath}${search}${hash}`);
};
```

### 3.4 No CI check for translation completeness

**Affected files:** `src/locales/es.po`, `package.json`

All 10 Spanish translations are currently complete, but there is no automated gate. A developer can add new `<Trans>` strings, run `lingui extract`, and ship the build without translating the new entries — the app will silently fall back to English source text for those strings.

**Recommended fix:** Add a verification script:

```json
"scripts": {
  "lingui:verify": "lingui extract --clean && lingui compile --typescript --strict"
}
```

Run `lingui:verify` in CI. The `--strict` flag causes `lingui compile` to fail if any locale has empty `msgstr` entries, turning missing translations into a build-breaking error rather than a silent runtime fallback.

### 3.5 `<html lang="en">` is a static default — imprecise for non-English locales

**Affected file:** `src/app/layout.tsx` (line 26)

The root layout hardcodes `<html lang="en">`. When a user visits `/es/...`, the document root says `lang="en"` despite the page content being in Spanish.

**Impact:** Screen readers may announce the wrong language for the document root. Search engines primarily rely on content analysis, `hreflang` tags, and URL structure for language detection — not `<html lang>` alone — so SEO impact is minimal.

**Why it's this way:** The alternative — reading the locale from `headers()` or `params` in the root layout — forces Next.js to opt all routes into dynamic rendering, which eliminates CDN-edge caching and increases TTFB. The current choice prioritizes performance (full SSG) over `<html lang>` precision. This is an accepted tradeoff.

**If you need accurate `<html lang>`:** Move the `<html>` element into `src/app/[lang]/layout.tsx` and remove it from the root layout. The root layout would return only `{children}`. The `[lang]` layout already has access to the locale parameter and could set `<html lang={lang}>` without calling any dynamic APIs. However, this changes the component tree structure and should be tested carefully against Next.js's layout nesting expectations.

---

## 4. Performance Assessment

### 4.1 Static generation confirmed

All locale pages are prerendered at build time. No route forces dynamic rendering. TTFB from a CDN edge is effectively zero — the server delivers a static HTML file.

### 4.2 Catalog size is negligible

`en.ts` is ~450 bytes. `es.ts` is ~500 bytes. The RSC payload overhead from serializing `initialMessages` into `LinguiClientProvider` props is minimal. At this scale, there is no measurable bundle impact.

**When to act:** If a single compiled catalog exceeds ~50 KB (roughly 2,000–3,000 strings), split catalogs by route in `lingui.config.ts`:

```ts
catalogs: [
  { path: "src/locales/{locale}/common", include: ["src/components/"] },
  { path: "src/locales/{locale}/home", include: ["src/app/[lang]/page.tsx"] },
  { path: "src/locales/{locale}/hellotesting", include: ["src/app/[lang]/hellotesting/"] },
],
```

This gives each route only the strings it needs, reducing per-page RSC payload.

### 4.3 Server-side instances are cached

`src/lib/i18n.ts` uses `Map`-based caches for both raw `Messages` objects and constructed `I18n` instances. After the first request for a locale, all subsequent requests reuse the cached instance. No repeated `setupI18n` calls, no repeated dynamic imports, no repeated `JSON.parse`.

### 4.4 Client-side instance uses useMemo

`LinguiClientProvider` creates its `I18n` instance inside `useMemo`, keyed on `initialLocale` and `initialMessages`. It only reconstructs when the locale actually changes (i.e. language switch), not on every render.

### 4.5 No unnecessary client bundles

The `server-only` guard on `src/lib/i18n.ts` prevents the server catalog loader from being bundled into client JavaScript. Client components receive pre-resolved messages as serialized props — they never import catalog files directly.

---

## 5. Missing Components

### 5.1 `<head>` alternate hreflang tags — Low severity

**Impact:** Search engines cannot discover alternate-language versions of a page from the HTML alone. Without `<link rel="alternate" hreflang="es" href="/es/..." />` tags, Google relies on sitemap cross-references or its own content analysis to associate locale variants.

**Recommended fix:** Add hreflang tags via `generateMetadata` in `src/app/[lang]/layout.tsx`:

```tsx
import type { Metadata } from "next";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  const allLocales = getAllLocales();
  const alternates: Record<string, string> = {};
  for (const locale of allLocales) {
    alternates[locale] = `/${locale}`;
  }
  return {
    alternates: {
      languages: alternates,
    },
  };
}
```

### 5.2 LocaleLink wrapper component — Low severity

Discussed in section 3.2. Not a bug — just a DX improvement that prevents manual `/${lang}/...` interpolation from becoming a source of broken links at scale.

### 5.3 Dynamic route i18n example — Informational

No `[slug]` or catch-all route exists yet. The current architecture would support it without changes: add a `[slug]` segment under `[lang]`, call `setI18n` in the page, and extend `generateStaticParams` to emit locale × slug combinations. Not a gap — just an untested pattern in this codebase.

### 5.4 RTL locale support — Informational

Neither `en` nor `es` requires right-to-left text direction. If RTL locales (Arabic, Hebrew, etc.) are added in the future, the `<html dir>` attribute will need to be set dynamically. This would face the same SSG tradeoff as `<html lang>` (section 3.5).

---

## 6. Edge Cases & Security

### Cookie validation — Safe

The `NEXT_LOCALE` cookie value is checked against the locale whitelist in `getRequestLocale()` (`src/middleware.ts`, line 56). An attacker setting `NEXT_LOCALE=../../etc/passwd` gets no match and falls through to `Accept-Language` negotiation. The cookie value never reaches a filesystem path or dynamic import without passing the whitelist check first.

### Dynamic import path injection — Safe

`getI18nInstance()` validates the locale parameter against `locales.includes(locale)` before any `import()` call (`src/lib/i18n.ts`, line 23). An unsupported value is replaced with `"en"`. The `loadCatalog` function is module-private — it cannot be called directly from outside `i18n.ts`. Even if it were, the `import(`../locales/${locale}.ts`)` path is constrained to the `src/locales/` directory by the relative path prefix.

### Route-level validation — Safe

`[lang]/layout.tsx` line 19 calls `notFound()` for unknown locale segments. Visiting `/xyz/anything` produces a proper 404 response — it does not render a page with an invalid locale.

### Open redirect via locale prefix stripping — Safe

The middleware's locale-like prefix regex (`/^[a-z]{2}(-[a-z]{2})?$/i`) only matches two-letter codes with an optional region suffix. It strips the prefix and redirects to a same-origin URL constructed via `request.nextUrl` — which preserves the host. There is no vector for open redirect or path traversal.

### x-locale header spoofing — No impact

The middleware overwrites the `x-locale` header for valid-locale paths (line 19). The root layout does not read this header (it uses static `lang="en"`). Spoofing `x-locale` in an inbound request has zero effect on rendered output. The header remains in middleware for potential future use by API routes or edge functions.

### Unsupported locale in URL — Safe

Dual validation: middleware redirects to a known locale, and the layout `notFound()` catches any value that bypasses middleware. There is no code path where an unsupported locale reaches a `<Trans>` component or a catalog import.

---

## 7. File Structure

```
lingui-demo/
├── lingui.config.ts             ← 2 locales (en, es), single catalog covering src/
├── next.config.ts               ← @lingui/swc-plugin for macro transformation
├── package.json                 ← lingui:extract + lingui:compile scripts
├── tsconfig.json                ← @/* path alias → ./src/*
└── src/
    ├── middleware.ts             ← locale redirect, cookie persistence, Accept-Language fallback
    ├── app/
    │   ├── layout.tsx           ← root: <html lang="en">, fonts, metadata (static, preserves SSG)
    │   ├── globals.css          ← Tailwind + CSS custom properties
    │   └── [lang]/
    │       ├── layout.tsx       ← validates locale → notFound(), setI18n(), LinguiClientProvider
    │       ├── page.tsx         ← Home: setI18n() + <Trans> + LanguageSwitcher + Link
    │       ├── hellotesting/
    │       │   └── page.tsx     ← Hello Testing: setI18n() + <Trans> + LanguageSwitcher + Link
    │       ├── not-found.tsx    ← "use client" translated 404, inherits i18n from provider
    │       └── error.tsx        ← "use client" translated error boundary, inherits i18n from provider
    ├── components/
    │   ├── LinguiClientProvider.tsx  ← useMemo-based I18nProvider, rebuilds on locale change
    │   └── LanguageSwitcher.tsx      ← <select> dropdown, swaps [lang] path segment via router.push
    ├── lib/
    │   └── i18n.ts              ← "server-only"; lazy async getI18nInstance + getAllLocales + Map caches
    └── locales/
        ├── en.po                ← source locale (10 strings)
        ├── en.ts                ← compiled English catalog (~450 bytes)
        ├── es.po                ← Spanish translations (10/10 complete)
        └── es.ts                ← compiled Spanish catalog (~500 bytes)
```

---

## 8. Verdict

**The codebase is production-ready for Lingui-based localization.**

The architecture correctly implements every critical concern: locale-segmented routing with `[lang]`, dual-layer locale validation, lazy-loaded and cached translation catalogs guarded by `server-only`, proper server/client i18n context separation, translated error boundaries and 404 pages, full SSG with no dynamic rendering forced, cookie-based locale persistence, and safe input validation at every layer.

Remaining items are low-severity enhancements that improve developer experience and future-proofing but do not block production deployment:

- **`activateI18n` helper** — reduces per-page boilerplate from 3 lines to 1
- **`LocaleLink` component** — eliminates manual `/${lang}/...` interpolation in links
- **Query/hash preservation in switcher** — only matters once query-param routes exist
- **`hreflang` tags** — improves SEO discoverability of locale variants
- **CI translation completeness check** — prevents silent fallback to English for untranslated strings
- **`<html lang>` precision** — accepted tradeoff in favor of full SSG performance
