"use client";

import { usePathname, useRouter } from "next/navigation";
import linguiConfig from "../../lingui.config";

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
};

export function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const segments = pathname.split("/");
  const currentLocale = segments[1] || linguiConfig.locales[0];

  const switchLocale = (newLocale: string) => {
    const newSegments = [...segments];
    newSegments[1] = newLocale;
    const newPath = newSegments.join("/");
    // Preserve query params and hash fragments across language switches.
    // usePathname() only returns the path — window.location has the full URL.
    const { search, hash } = window.location;
    router.push(`${newPath}${search}${hash}`);
  };

  return (
    <select
      value={currentLocale}
      onChange={(e) => switchLocale(e.target.value)}
      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:border-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
    >
      {linguiConfig.locales.map((locale) => (
        <option key={locale} value={locale}>
          {LOCALE_LABELS[locale] ?? locale.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
