import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VSee | Persistent Context for AI Agents",
  description:
    "Persistent context turns a forgotten pass into the right next move — with every retrieval and checkpoint visible.",
  openGraph: {
    title: "VSee | The agent that knows when your No is outdated",
    description:
      "A visible, crash-resilient context loop for evidence-backed investment decisions.",
    type: "website",
    images: ["/vsee-context-loop-og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "VSee | Persistent Context for AI Agents",
    description:
      "A visible, crash-resilient context loop for evidence-backed investment decisions.",
    images: ["/vsee-context-loop-og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
