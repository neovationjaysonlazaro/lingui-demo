import "server-only";

import { cache } from "react";
import { type I18n, type Messages, setupI18n } from "@lingui/core";
import { setI18n } from "@lingui/react/server";
import linguiConfig from "../../lingui.config";

const { locales } = linguiConfig;

// Module-level cache for raw Messages objects. These are immutable data loaded
// from compiled catalogs — safe to share across requests and never stale.
const catalogCache = new Map<string, Messages>();

async function loadCatalog(locale: string): Promise<Messages> {
  if (catalogCache.has(locale)) return catalogCache.get(locale)!;
  const { messages } = await import(`../locales/${locale}.ts`);
  catalogCache.set(locale, messages);
  return messages;
}

export function getAllLocales(): string[] {
  return locales;
}

// React.cache scopes the I18n instance to the current server request.
// Each request gets its own instance — no mutable state leaks between
// concurrent requests. The catalog data underneath is still shared via
// the module-level catalogCache (immutable, so safe to share).
const getI18nInstanceCached = cache(async (locale: string): Promise<I18n> => {
  const messages = await loadCatalog(locale);
  return setupI18n({ locale, messages: { [locale]: messages } });
});

export async function getI18nInstance(locale: string): Promise<I18n> {
  if (!locales.includes(locale)) {
    console.warn(`Unsupported locale "${locale}", falling back to "en"`);
    locale = "en";
  }
  return getI18nInstanceCached(locale);
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
