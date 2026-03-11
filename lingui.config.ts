import type { LinguiConfig } from "@lingui/conf";

// Lingui configuration — the single source of truth for supported locales
// and catalog paths. Both the CLI (extract/compile) and runtime code import
// this file to stay in sync.
const config: LinguiConfig = {
  // All supported locales. Adding a new locale here is the first step;
  // you must then run `lingui extract` to create its .po file and
  // `lingui compile --typescript` to generate its compiled .ts catalog.
  locales: ["en", "es"],

  // The source locale — msgid strings in <Trans> are written in this language.
  // `lingui extract` uses this to populate the source .po file automatically.
  sourceLocale: "en",

  // Catalog definitions: tells `lingui extract` where to scan for translatable
  // strings and where to write the resulting .po / compiled .ts files.
  // {locale} is replaced with each locale code (e.g. "en", "es").
  catalogs: [
    {
      path: "src/locales/{locale}",
      include: ["src/"],
    },
  ],
};

export default config;
