// Locale-aware Link wrapper: automatically prefixes the href with the current
// locale from the URL, so pages don't need to manually interpolate /${lang}/...
// in every <Link>. Prevents broken links when the prefix is forgotten.
"use client";

import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";

type Props = Omit<LinkProps, "href"> & {
  href: string;
  children: React.ReactNode;
  className?: string;
};

export function LocaleLink({ href, ...props }: Props) {
  const pathname = usePathname();
  const locale = pathname.split("/")[1];
  const localizedHref = href.startsWith("/") ? `/${locale}${href}` : href;
  return <Link href={localizedHref} {...props} />;
}
