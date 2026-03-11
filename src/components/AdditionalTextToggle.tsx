"use client";

import { useState } from "react";
import { Trans } from "@lingui/react/macro";

export function AdditionalTextToggle() {
  const [enabled, setEnabled] = useState(false);

  return (
    <>
      <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-500">
        <Trans>Additional text:</Trans>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 dark:focus:ring-offset-black ${
            enabled ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-300 dark:bg-zinc-600"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out dark:bg-zinc-900 ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </p>
      {enabled && (
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          <Trans>This is additional text.</Trans>
        </p>
      )}
    </>
  );
}
