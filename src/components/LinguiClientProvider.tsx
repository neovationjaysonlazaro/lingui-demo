// This is the client-side counterpart to setI18n on the server.
// React context (not React.cache) is used to pass the I18n instance to
// client components. The server cannot pass the I18n object directly
// because it's not serializable — so we receive the raw locale string
// and messages map, then reconstruct a client-side I18n instance.
"use client";

import { I18nProvider } from "@lingui/react";
import { type Messages, setupI18n } from "@lingui/core";
import { useMemo } from "react";

export function LinguiClientProvider({
  children,
  initialLocale,
  initialMessages,
}: {
  children: React.ReactNode;
  initialLocale: string;
  initialMessages: Messages;
}) {
  const i18n = useMemo(() => {
    return setupI18n({
      locale: initialLocale,
      messages: { [initialLocale]: initialMessages },
    });
  }, [initialLocale, initialMessages]);

  // I18nProvider makes the i18n instance available via React context to all
  // client components in the tree. <Trans> in client components reads from
  // this context to resolve translations.
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
