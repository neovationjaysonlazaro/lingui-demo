import { notFound } from "next/navigation";
import { Geist, Geist_Mono } from "next/font/google";
import { setI18n } from "@lingui/react/server";
import { getI18nInstance, getAllLocales } from "@/lib/i18n";
import { LinguiClientProvider } from "@/components/LinguiClientProvider";

export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

type Props = {
  params: Promise<{ lang: string }>;
  children: React.ReactNode;
};

// This layout is the Lingui integration point for the entire [lang] subtree.
// It performs two essential steps:
//   1. setI18n(i18n) — stores the I18n instance in React.cache so Server
//      Components in this request can resolve <Trans> strings.
//   2. <LinguiClientProvider> — wraps children with I18nProvider so Client
//      Components can resolve <Trans> strings via React context.
export default async function LangLayout({ params, children }: Props) {
  const { lang } = await params;

  // Validate the locale from the URL against the whitelist. If the middleware
  // didn't catch an invalid locale (e.g. direct server navigation), this
  // triggers a proper 404 instead of rendering with a broken locale.
  if (!getAllLocales().includes(lang)) notFound();

  const i18n = await getI18nInstance(lang);
  setI18n(i18n);

  return (
    <html lang={lang}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LinguiClientProvider
          initialLocale={lang}
          initialMessages={i18n.messages}
        >
          {children}
        </LinguiClientProvider>
      </body>
    </html>
  );
}
