import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LinguiJS Demo",
  description: "Next.js App Router with LinguiJS internationalization",
};

// Root layout is a pass-through — it owns global CSS and metadata only.
// The <html> and <body> tags live in src/app/[lang]/layout.tsx where the
// locale param is available, allowing <html lang={lang}> to be set per locale.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
