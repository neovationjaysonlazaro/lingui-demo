"use client";

import Link from "next/link";
import { Trans } from "@lingui/react/macro";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-col items-center gap-6 p-16 text-center">
        <h1 className="text-6xl font-bold text-zinc-900 dark:text-zinc-50">
          404
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          <Trans>Page not found</Trans>
        </p>
        <Link
          href="/"
          className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <Trans>Back to Home</Trans>
        </Link>
      </main>
    </div>
  );
}
