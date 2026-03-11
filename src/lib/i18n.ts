import "server-only";

import { type I18n, type Messages, setupI18n } from "@lingui/core";
import { setI18n } from "@lingui/react/server";
import linguiConfig from "../../lingui.config";

const { locales } = linguiConfig;

// Two-layer cache: raw Messages objects and fully-constructed I18n instances.
// After the first request for a locale, all subsequent requests reuse the
// cached instance with zero allocation or re-parsing.
const catalogCache = new Map<string, Messages>();
const instanceCache = new Map<string, I18n>();

// Lazily loads a compiled catalog (.ts file) for the given locale via dynamic
// import. Only the requested locale is imported — other locales stay unbundled.
// The compiled catalogs use JSON.parse() internally, which V8 parses faster
// than equivalent JS object literals.
async function loadCatalog(locale: string): Promise<Messages> {
  if (catalogCache.has(locale)) return catalogCache.get(locale)!;
  const { messages } = await import(`../locales/${locale}.ts`);
  catalogCache.set(locale, messages);
  return messages;
}

export function getAllLocales(): string[] {
  return locales;
}

// Creates (or retrieves from cache) a fully-configured I18n instance for the
// given locale. Validates the locale against the whitelist before any dynamic
// import to prevent path injection.
export async function getI18nInstance(locale: string): Promise<I18n> {
  if (!locales.includes(locale)) {
    console.warn(`Unsupported locale "${locale}", falling back to "en"`);
    locale = "en";
  }
  if (instanceCache.has(locale)) return instanceCache.get(locale)!;

  const messages = await loadCatalog(locale);
  const i18n = setupI18n({ locale, messages: { [locale]: messages } });
  instanceCache.set(locale, i18n);
  return i18n;
}

// Convenience helper that combines getI18nInstance + setI18n into one call.
// Lingui requires setI18n() in every Server Component scope that uses <Trans>,
// because RSC uses React.cache (not React context) to store the I18n instance.
// Each page/layout must call this to register the instance for its scope.
export async function activateI18n(lang: string) {
  const i18n = await getI18nInstance(lang);
  setI18n(i18n);
  return { lang, i18n };
}
