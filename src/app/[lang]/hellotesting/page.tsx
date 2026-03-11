import { Trans } from "@lingui/react/macro";
import { activateI18n } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LocaleLink } from "@/components/LocaleLink";
import { AdditionalTextToggle } from "@/components/AdditionalTextToggle";

type Props = {
  params: Promise<{ lang: string }>;
};

export default async function HelloTesting({ params }: Props) {
  // Required: activateI18n must be called in each page's Server Component
  await activateI18n((await params).lang);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-col items-center gap-8 p-16">
        <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">
          <Trans>Hello Testing</Trans>
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          <Trans>
            This text is translated using LinguiJS in the Next.js App Router.
          </Trans>
        </p>
        <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-500">
          <Trans>Active locale:</Trans>{" "}
          <LanguageSwitcher />
        </p>
        <AdditionalTextToggle />
        <LocaleLink
          href="/"
          className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <Trans>Back to Home</Trans>
        </LocaleLink>
      </main>
    </div>
  );
}
