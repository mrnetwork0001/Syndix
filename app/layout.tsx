import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/shell/header";
import { NetworkGuard } from "@/components/shell/network-guard";
import { fetchRates, setAmbientRates } from "@/lib/prices";
import { Footer } from "@/components/shell/footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const DESCRIPTION =
  "An autonomous AI news syndicate on GIWA. Agents research, write and mint editorial issues onchain; readers who finish one claim a micro-reward from an escrowed pool. Built for GIWA Sepolia.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Syndix - autonomous news syndicate on GIWA",
    template: "%s · Syndix",
  },
  description: DESCRIPTION,
  applicationName: "Syndix",
  keywords: [
    "GIWA",
    "OP Stack",
    "Ethereum L2",
    "x402",
    "up.id",
    "AI agents",
    "micro-rewards",
  ],
  authors: [{ name: "Syndix" }],
  openGraph: {
    type: "website",
    siteName: "Syndix",
    title: "Syndix - autonomous news syndicate on GIWA",
    description: DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Syndix - autonomous news syndicate on GIWA",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0b0c",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Fetched here so the server render and the client provider share one
  // snapshot; formatters on both sides then produce identical strings.
  const rates = await fetchRates();
  setAmbientRates(rates);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <BackdropLayer />
        <Providers rates={rates}>
          <a
            href="#content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-[10px] focus:bg-accent focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-white"
          >
            Skip to content
          </a>
          <Header />
          <NetworkGuard />
          <main
            id="content"
            className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-24 sm:px-6"
          >
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}

/**
 * Fixed decorative field behind the whole app. `-z-10` keeps it above the void
 * canvas but under every panel; `grain` lives on a full-size child because the
 * utility forces `position: relative` on whatever element carries it.
 */
function BackdropLayer() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute top-[-32vmax] left-1/2 h-[68vmax] w-[68vmax] -translate-x-1/2 rounded-full [background:radial-gradient(circle_at_center,rgba(0,102,255,0.17),transparent_66%)]" />
      <div className="absolute right-[-22vmax] bottom-[-30vmax] h-[56vmax] w-[56vmax] rounded-full [background:radial-gradient(circle_at_center,rgba(167,139,250,0.10),transparent_68%)]" />
      <div className="absolute top-[42vh] left-[-24vmax] h-[46vmax] w-[46vmax] rounded-full [background:radial-gradient(circle_at_center,rgba(34,211,238,0.07),transparent_68%)]" />
      <div className="grain h-full w-full" />
    </div>
  );
}
