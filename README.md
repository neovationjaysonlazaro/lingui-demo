# Lingui + Next.js App Router — Production-Readiness Architecture Review

**Review date:** 2026-03-12
**Stack:** Next.js 16.1.6 · React 19.2.3 · @lingui/core 5.9.2 · @lingui/swc-plugin 5.11.0 · Tailwind 4 · TypeScript 5
**Rendering strategy:** Full SSG via `generateStaticParams` — every locale × page combination prerendered at build time
**Locale count:** 3 (en, fr, es) · **String count:** 12 per locale · **All translations complete**

---

## 1. Architecture Summary

### Routing & Locale Segments

The app uses a single `[lang]` dynamic segment under `src/app/[lang]/` to partition all localized content. Two leaf pages exist (`page.tsx` and `hellotesting/page.tsx`), along with a translated 404 page (`not-found.tsx`) and a translated error boundary (`error.tsx`).

The root layout at `src/app/layout.tsx` is a pass-through — it owns only global CSS imports and static `<Metadata>`. It returns `{children}` directly without wrapping in `<html>` or `<body>`. The `<html>` and `<body>` elements live in `src/app/[lang]/layout.tsx`, which has access to the `lang` parameter and renders `<html lang={lang}>` — giving every locale an accurate document language attribute without forcing dynamic rendering.

`src/app/[lang]/layout.tsx` exports `generateStaticParams`, which reads the locale list from `lingui.config.ts` and emits one static build per supported locale. The expected build output is:

```
Route (app)
├ ○ /_not-found
├ ● /[lang]              → /en, /fr, /es
└ ● /[lang]/hellotesting → /en/hellotesting, /fr/hellotesting, /es/hellotesting
```

### Locale Resolution

Locale resolution follows a three-tier priority chain inside `src/proxy.ts`:

1. **URL prefix** — If the pathname starts with a known locale (`/en/...`, `/fr/...`, `/es/...`), the request passes through. The proxy sets a `NEXT_LOCALE` cookie (1-year expiry, `sameSite: lax`) and injects an `x-locale` request header for potential downstream use.
2. **Cookie** — If the URL has no valid locale prefix, `getRequestLocale()` checks the `NEXT_LOCALE` cookie against the whitelist.
3. **Accept-Language** — If no cookie exists, the `negotiator` library matches the browser's `Accept-Language` header against supported locales.

The resolved locale is used to redirect the user to the correct prefixed URL (e.g. `/` → `/en`).

### Invalid Locale Handling

Three layers of validation prevent unsupported locales from rendering:

- **Proxy layer** (`src/proxy.ts`, lines 47–52): Any pathname whose first segment matches `/^[a-z]{2}(-[a-z]{2})?$/i` but isn't in the whitelist gets stripped and redirected. For example, `/de/about` → `/en/about` (assuming English is the resolved preference). This prevents nested-junk URLs like `/en/de/about`.
- **Layout layer** (`src/app/[lang]/layout.tsx`, line 39): `getAllLocales().includes(lang)` is checked and `notFound()` is triggered for any locale that somehow bypasses the proxy (direct server-side navigation, cached route manifests, etc.).
- **Catalog loader layer** (`src/lib/i18n.ts`, lines 34–37): `getI18nInstance()` validates the locale parameter against the config whitelist before any `import()` call. Invalid locales fall back to `"en"` with a `console.warn`. This is defense-in-depth — it should never be reached in normal operation.

### Translation Catalog Loading

`src/lib/i18n.ts` is guarded by `import "server-only"` — it cannot be imported from client components. Catalogs are loaded lazily via dynamic `import(`../locales/${locale}.ts`)` and cached in a module-level `Map<string, Messages>`. This cache holds immutable `Messages` objects — raw data from compiled catalogs — which are safe to share across requests because they are never mutated after creation.

`I18n` instances (which are mutable) are scoped per-request via `React.cache`. Each request gets its own `I18n` instance constructed from the shared catalog data. This prevents mutable state from leaking between concurrent requests while still avoiding redundant dynamic imports and `JSON.parse` calls.

The compiled catalog files (`src/locales/en.ts`, `src/locales/fr.ts`, `src/locales/es.ts`) use `JSON.parse()` for the message payload. V8 parses `JSON.parse(string)` faster than equivalent JavaScript object literals — this is the recommended Lingui pattern for performance.

### Server-Side i18n

The `[lang]/layout.tsx` calls `getI18nInstance(lang)` followed by `setI18n(i18n)` to establish the i18n context for layout-level `<Trans>` usage. Each page uses the `activateI18n()` convenience helper from `src/lib/i18n.ts`, which combines both calls into one:

```ts
await activateI18n((await params).lang);
```

This is required because Lingui's RSC integration stores the i18n instance in a `React.cache`-based scope — each Server Component execution context needs its own `setI18n` call. The layout's call does not propagate to child page components. `<Trans>` from `@lingui/react/macro` is used for all translatable strings in Server Components.

### Client-Side i18n

`src/components/LinguiClientProvider.tsx` wraps children with Lingui's `I18nProvider`. It receives `initialLocale` and `initialMessages` as serialized props from the server layout, then constructs a client-side `I18n` instance via `useMemo`. The memo is keyed on both `initialLocale` and `initialMessages`, so the instance rebuilds when the user switches languages — no stale state persists across locale changes.

Client components (`not-found.tsx`, `error.tsx`, `AdditionalTextToggle.tsx`) inherit i18n context from this provider without needing their own setup. They use `<Trans>` from `@lingui/react/macro` directly.

### Language Switching

`src/components/LanguageSwitcher.tsx` renders a `<select>` dropdown populated from `lingui.config.ts`. On change, it reads the current pathname via `usePathname()`, swaps the first path segment (the locale), reads `window.location.search` and `window.location.hash` to preserve query parameters and hash fragments, and calls `router.push()` with the full reconstructed URL. This triggers a server-side re-render that loads the new locale's layout, which passes updated messages to `LinguiClientProvider`.

### Locale-Aware Links

`src/components/LocaleLink.tsx` is a `"use client"` wrapper around Next.js `<Link>` that automatically prefixes the `href` with the current locale extracted from `usePathname()`. Pages use `<LocaleLink href="/hellotesting">` instead of manually interpolating `/${lang}/hellotesting`, preventing broken links when the prefix is forgotten. The 404 page (`not-found.tsx`) also uses `LocaleLink` to navigate back to the locale-prefixed home route without triggering a proxy redirect.

### Proxy (formerly Middleware)

`src/proxy.ts` uses the Next.js 16 `proxy` file convention (renamed from the deprecated `middleware` convention). It exports a named `proxy` function and handles all locale routing concerns:

- Locale-prefixed requests pass through with cookie persistence and header injection.
- Bare URLs (`/`, `/about`) get redirected to the preferred-locale-prefixed version.
- Unknown locale-like prefixes (`/de/...` when `de` is not supported) get stripped and redirected.
- The matcher excludes `/api`, `_next/static`, `_next/image`, `favicon.ico`, and common image extensions.

### Build Tooling

`@lingui/swc-plugin` handles compile-time transformation of `<Trans>` macros into runtime calls. The `package.json` includes `lingui:extract`, `lingui:compile`, and `lingui:verify` scripts for the catalog workflow. `lingui.config.ts` defines a single catalog covering all of `src/`.

---

## 2. Critical Issues — None Found

No high-severity blockers exist. The architecture correctly handles:

- Locale routing with `[lang]` segments and `generateStaticParams` for full SSG across 3 locales
- Accurate `<html lang={lang}>` per locale without forcing dynamic rendering
- Triple-layer locale validation (proxy → layout `notFound()` → catalog loader fallback)
- Lazy catalog loading with immutable `Messages` cached at module level and mutable `I18n` instances scoped per-request via `React.cache`
- `server-only` guard preventing catalog loader from leaking into client bundles
- Server and client i18n context separation (`setI18n`/`React.cache` for RSC, `I18nProvider`/React context for client)
- Translated error boundaries and 404 pages using `LocaleLink` for locale-preserving navigation
- Cookie-based locale persistence with `Accept-Language` fallback
- Query parameter and hash fragment preservation during language switching
- Safe dynamic imports with validated locale parameters at every layer
- Next.js 16 `proxy` file convention (migrated from deprecated `middleware`)

---

## 3. Medium Risks

### 3.1 No CI integration for `lingui:verify`

**Affected files:** `package.json`, CI configuration (not present in repo)

The `lingui:verify` script exists in `package.json` and correctly chains `lingui extract --clean` with `lingui compile --typescript --strict`. The `--strict` flag causes the build to fail if any locale has empty `msgstr` entries. However, there is no CI pipeline configuration in the repository — the script must be wired into whatever CI system is used.

**Current impact:** Low, because all 12 strings across all 3 locales are complete. A developer can add new `<Trans>` strings, run `lingui extract`, and ship without translating — the app silently falls back to English source text for those strings.

**Recommended fix:** Add `npm run lingui:verify` as a CI step:

```yaml
# GitHub Actions example
- name: Verify translations
  run: npm run lingui:verify
```

### 3.2 `LOCALE_LABELS` in LanguageSwitcher is maintained separately from `lingui.config.ts`

**Affected file:** `src/components/LanguageSwitcher.tsx` (lines 6–10)

```ts
const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
};
```

When a new locale is added to `lingui.config.ts`, the switcher renders the raw locale code (e.g. `"DE"`) via the fallback `locale.toUpperCase()` — not a human-readable label. This is a silent regression that produces a degraded but functional UI. The current 3-locale setup is in sync, but the coupling is manual.

**Recommended fix:** Either colocate the labels with the config:

```ts
// lingui.config.ts
export const localeLabels: Record<string, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
};
```

Or use `Intl.DisplayNames` for automatic locale-native labels:

```ts
const displayNames = new Intl.DisplayNames([locale], { type: "language" });
const label = displayNames.of(locale); // "English", "français", "español", etc.
```

### 3.3 No `<head>` alternate hreflang tags

**Impact:** Search engines cannot discover alternate-language versions of a page from the HTML alone. Without `<link rel="alternate" hreflang="fr" href="/fr/..." />` tags, Google relies on sitemap cross-references or its own content analysis to associate locale variants. With 3 locales, the SEO benefit of hreflang tags becomes more meaningful.

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

---

## 4. Performance Assessment

### 4.1 Static generation confirmed

All locale pages are prerendered at build time via `generateStaticParams`. No route forces dynamic rendering. TTFB from a CDN edge is effectively zero — the server delivers a static HTML file. `<html lang={lang}>` is baked into each prerendered HTML file with the correct locale value. With 3 locales and 2 pages, the build produces 6 static HTML files — negligible build time.

### 4.2 Catalog size is negligible

`en.ts` is ~500 bytes. `es.ts` is ~530 bytes. `fr.ts` is ~570 bytes. The RSC payload overhead from serializing `initialMessages` into `LinguiClientProvider` props is minimal. At this scale, there is no measurable bundle impact.

**When to act:** If a single compiled catalog exceeds ~50 KB (roughly 2,000–3,000 strings), split catalogs by route in `lingui.config.ts`:

```ts
catalogs: [
  { path: "src/locales/{locale}/common", include: ["src/components/"] },
  { path: "src/locales/{locale}/home", include: ["src/app/[lang]/page.tsx"] },
  { path: "src/locales/{locale}/hellotesting", include: ["src/app/[lang]/hellotesting/"] },
],
```

This gives each route only the strings it needs, reducing per-page RSC payload.

### 4.3 Catalog data is cached, I18n instances are request-scoped

`src/lib/i18n.ts` uses a module-level `Map<string, Messages>` to cache immutable catalog data. After the first `import()` for a locale, the raw messages are reused for all subsequent requests — no repeated dynamic imports or `JSON.parse` calls.

`I18n` instances — which are mutable and hold active locale state — are created per-request via `React.cache`. This prevents cross-request state contamination while keeping the immutable data shared.

### 4.4 Client-side instance uses useMemo

`LinguiClientProvider` creates its `I18n` instance inside `useMemo`, keyed on `initialLocale` and `initialMessages`. It only reconstructs when the locale actually changes (i.e. language switch), not on every render.

### 4.5 No unnecessary client bundles

The `server-only` guard on `src/lib/i18n.ts` prevents the server catalog loader from being bundled into client JavaScript. Client components receive pre-resolved messages as serialized props — they never import catalog files directly.

---

## 5. Missing Components

### 5.1 Dynamic route i18n example — Informational

No `[slug]` or catch-all route exists yet. The current architecture would support it without changes: add a `[slug]` segment under `[lang]`, call `activateI18n` in the page, and extend `generateStaticParams` to emit locale × slug combinations. Not a gap — just an untested pattern in this codebase.

### 5.2 RTL locale support — Informational

None of the current locales (en, fr, es) require right-to-left text direction. If RTL locales (Arabic, Hebrew, etc.) are added in the future, the `<html dir>` attribute will need to be set dynamically. Since `<html>` already lives in the `[lang]` layout with access to `lang`, this would be a straightforward addition:

```tsx
const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

<html lang={lang} dir={RTL_LOCALES.has(lang) ? "rtl" : "ltr"}>
```

### 5.3 Sitemap with locale alternates — Informational

No `sitemap.ts` or `sitemap.xml` exists. For SEO, a sitemap that lists all locale variants of each page helps search engines discover and associate translated versions. Next.js supports dynamic sitemaps via `src/app/sitemap.ts`.

---

## 6. Edge Cases & Security

### Cookie validation — Safe

The `NEXT_LOCALE` cookie value is checked against the locale whitelist in `getRequestLocale()` (`src/proxy.ts`, line 73). An attacker setting `NEXT_LOCALE=../../etc/passwd` gets no match and falls through to `Accept-Language` negotiation. The cookie value never reaches a filesystem path or dynamic import without passing the whitelist check first.

### Dynamic import path injection — Safe

`getI18nInstance()` validates the locale parameter against `locales.includes(locale)` before any `import()` call (`src/lib/i18n.ts`, line 35). An unsupported value is replaced with `"en"`. The `loadCatalog` function is module-private — it cannot be called directly from outside `i18n.ts`. Even if it were, the `import(`../locales/${locale}.ts`)` path is constrained to the `src/locales/` directory by the relative path prefix.

### Route-level validation — Safe

`[lang]/layout.tsx` line 39 calls `notFound()` for unknown locale segments. Visiting `/xyz/anything` produces a proper 404 response — it does not render a page with an invalid locale.

### Open redirect via locale prefix stripping — Safe

The proxy's locale-like prefix regex (`/^[a-z]{2}(-[a-z]{2})?$/i`) only matches two-letter codes with an optional region suffix. It strips the prefix and redirects to a same-origin URL constructed via `request.nextUrl` — which preserves the host. There is no vector for open redirect or path traversal.

### x-locale header spoofing — No impact

The proxy overwrites the `x-locale` header for valid-locale paths (line 28). No layout or page reads this header — the `[lang]` layout uses the URL parameter directly. Spoofing `x-locale` in an inbound request has zero effect on rendered output. The header remains in the proxy for potential future use by API routes or edge functions.

### Unsupported locale in URL — Safe

Triple-layer validation: proxy redirects to a known locale, the layout's `notFound()` catches any value that bypasses the proxy, and the catalog loader falls back to `"en"` as final defense-in-depth. There is no code path where an unsupported locale reaches a `<Trans>` component or an unvalidated catalog import.

### Query parameter preservation during language switch — Safe

`LanguageSwitcher` reads `window.location.search` and `window.location.hash` and appends them to the new path. Query parameters and hash fragments survive locale changes.

---

## 7. File Structure

```
lingui-demo/
├── lingui.config.ts                  ← 3 locales (en, fr, es), single catalog covering src/
├── next.config.ts                    ← @lingui/swc-plugin for macro transformation
├── package.json                      ← lingui:extract + lingui:compile + lingui:verify scripts
├── tsconfig.json                     ← @/* path alias → ./src/*
└── src/
    ├── proxy.ts                      ← Next.js 16 proxy (locale redirect, cookie, Accept-Language)
    ├── app/
    │   ├── layout.tsx                ← root: metadata + globals.css only, no <html>/<body>
    │   ├── globals.css               ← Tailwind v4 imports
    │   └── [lang]/
    │       ├── layout.tsx            ← <html lang={lang}>, generateStaticParams, validates locale →
    │       │                            notFound(), setI18n(), LinguiClientProvider
    │       ├── page.tsx              ← Home: activateI18n() + <Trans> + LanguageSwitcher + LocaleLink
    │       ├── hellotesting/
    │       │   └── page.tsx          ← Hello Testing: activateI18n() + <Trans> + LanguageSwitcher + LocaleLink
    │       ├── not-found.tsx         ← "use client" translated 404, uses LocaleLink for home navigation
    │       └── error.tsx             ← "use client" translated error boundary, inherits i18n from provider
    ├── components/
    │   ├── LinguiClientProvider.tsx   ← useMemo-based I18nProvider, rebuilds on locale change
    │   ├── LanguageSwitcher.tsx       ← <select> dropdown, swaps [lang] segment, preserves query/hash
    │   ├── LocaleLink.tsx            ← locale-aware <Link> wrapper, auto-prefixes href with current locale
    │   └── AdditionalTextToggle.tsx  ← "use client" toggle with translated text, demonstrates client <Trans>
    ├── lib/
    │   └── i18n.ts                   ← "server-only"; React.cache-scoped I18n instances, module-level
    │                                    immutable Messages cache, activateI18n + getAllLocales
    └── locales/
        ├── en.po                     ← source locale (12 strings)
        ├── en.ts                     ← compiled English catalog (~500 bytes)
        ├── fr.po                     ← French translations (12/12 complete)
        ├── fr.ts                     ← compiled French catalog (~570 bytes)
        ├── es.po                     ← Spanish translations (12/12 complete)
        └── es.ts                     ← compiled Spanish catalog (~530 bytes)
```

---

## 8. Suggested Architecture & Fixes

### Priority 1: Add hreflang metadata (Medium)

Add `generateMetadata` to `src/app/[lang]/layout.tsx` to emit `<link rel="alternate" hreflang>` tags for each supported locale. With 3 locales, this becomes more valuable for SEO. See section 3.3 for the implementation.

### Priority 2: Wire `lingui:verify` into CI (Medium)

Ensure `npm run lingui:verify` runs in the CI pipeline. The script already exists — it just needs to be called.

### Priority 3: Colocate locale labels (Low)

Move `LOCALE_LABELS` into `lingui.config.ts` or use `Intl.DisplayNames` to eliminate the maintenance gap between config and UI. See section 3.2.

---

## 9. Verdict

**The codebase is production-ready for Lingui-based localization.**

The architecture correctly implements every critical concern: locale-segmented routing with `[lang]` and `generateStaticParams` for full SSG across 3 locales, accurate `<html lang={lang}>` per locale without dynamic rendering, triple-layer locale validation (proxy → layout → catalog loader), lazy-loaded catalogs with immutable data cached at module level and mutable `I18n` instances scoped per-request via `React.cache`, `server-only` guard preventing catalog code from leaking into client bundles, proper server/client i18n context separation, translated error boundaries and 404 pages with locale-aware navigation, cookie-based locale persistence with `Accept-Language` fallback, query/hash-preserving language switching, safe input validation at every layer, and adoption of the Next.js 16 `proxy` file convention.

Remaining items are low-to-medium severity enhancements that improve SEO and maintainability but do not block production deployment:

- **hreflang tags** — improves SEO discoverability of locale variants
- **CI translation gate** — prevents silent fallback to English for untranslated strings
- **Colocated locale labels** — eliminates maintenance gap in language switcher
