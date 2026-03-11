# Lingui + Next.js App Router — Production-Readiness Architecture Review

**Review date:** 2026-03-11
**Stack:** Next.js 16.1.6 · React 19.2.3 · @lingui/core 5.9.2 · @lingui/swc-plugin 5.11.0 · Tailwind 4 · TypeScript 5
**Rendering strategy:** Dynamic rendering (`force-dynamic`) — all routes rendered on every request
**Locale count:** 2 (en, es) · **String count:** 12 per locale · **All translations complete**

---

## 1. Architecture Summary

### Routing & Locale Segments

The app uses a single `[lang]` dynamic segment under `src/app/[lang]/` to partition all localized content. Two leaf pages exist (`page.tsx` and `hellotesting/page.tsx`), along with a translated 404 page (`not-found.tsx`) and a translated error boundary (`error.tsx`).

The root layout at `src/app/layout.tsx` is a pass-through — it owns only global CSS imports and static `<Metadata>`. It returns `{children}` directly without wrapping in `<html>` or `<body>`. The `<html>` and `<body>` elements live in `src/app/[lang]/layout.tsx`, which has access to the `lang` parameter and renders `<html lang={lang}>` — giving every locale an accurate document language attribute.

`src/app/[lang]/layout.tsx` declares `export const dynamic = "force-dynamic"`, which forces all routes under the `[lang]` subtree to render dynamically on every request. No `generateStaticParams` is present — the app relies entirely on server-side rendering rather than build-time prerendering.

### Locale Resolution

Locale resolution follows a three-tier priority chain inside `src/middleware.ts`:

1. **URL prefix** — If the pathname starts with a known locale (`/en/...`, `/es/...`), the request passes through. The middleware sets a `NEXT_LOCALE` cookie (1-year expiry, `sameSite: lax`) and injects an `x-locale` request header for potential downstream use.
2. **Cookie** — If the URL has no valid locale prefix, `getRequestLocale()` checks the `NEXT_LOCALE` cookie against the whitelist.
3. **Accept-Language** — If no cookie exists, the `negotiator` library matches the browser's `Accept-Language` header against supported locales.

The resolved locale is used to redirect the user to the correct prefixed URL (e.g. `/` → `/en`).

### Invalid Locale Handling

Three layers of validation prevent unsupported locales from rendering:

- **Middleware layer** (`src/middleware.ts`, lines 47–52): Any pathname whose first segment matches `/^[a-z]{2}(-[a-z]{2})?$/i` but isn't in the whitelist gets stripped and redirected. For example, `/fr/about` → `/en/about` (assuming English is the resolved preference). This prevents nested-junk URLs like `/en/fr/about`.
- **Layout layer** (`src/app/[lang]/layout.tsx`, line 36): `getAllLocales().includes(lang)` is checked and `notFound()` is triggered for any locale that somehow bypasses middleware (direct server-side navigation, cached route manifests, etc.).
- **Catalog loader layer** (`src/lib/i18n.ts`, lines 34–37): `getI18nInstance()` validates the locale parameter against the config whitelist before any `import()` call. Invalid locales fall back to `"en"` with a `console.warn`. This is defense-in-depth — it should never be reached in normal operation.

### Translation Catalog Loading

`src/lib/i18n.ts` is guarded by `import "server-only"` — it cannot be imported from client components. Catalogs are loaded lazily via dynamic `import(`../locales/${locale}.ts`)` and cached in a `Map<string, Messages>`. A second `Map<string, I18n>` caches fully-constructed `I18n` instances. After the first request for a given locale, all subsequent requests reuse cached data with zero allocation.

The compiled catalog files (`src/locales/en.ts`, `src/locales/es.ts`) use `JSON.parse()` for the message payload. V8 parses `JSON.parse(string)` faster than equivalent JavaScript object literals — this is the recommended Lingui pattern for performance.

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

`src/components/LocaleLink.tsx` is a `"use client"` wrapper around Next.js `<Link>` that automatically prefixes the `href` with the current locale extracted from `usePathname()`. Pages use `<LocaleLink href="/hellotesting">` instead of manually interpolating `/${lang}/hellotesting`, preventing broken links when the prefix is forgotten.

### Middleware

`src/middleware.ts` handles all locale routing concerns:

- Locale-prefixed requests pass through with cookie persistence and header injection.
- Bare URLs (`/`, `/about`) get redirected to the preferred-locale-prefixed version.
- Unknown locale-like prefixes (`/fr/...` when `fr` is not supported) get stripped and redirected.
- The matcher excludes `/api`, `_next/static`, `_next/image`, `favicon.ico`, and common image extensions.

### Build Tooling

`@lingui/swc-plugin` handles compile-time transformation of `<Trans>` macros into runtime calls. The `package.json` includes `lingui:extract`, `lingui:compile`, and `lingui:verify` scripts for the catalog workflow. `lingui.config.ts` defines a single catalog covering all of `src/`.