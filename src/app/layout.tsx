import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/context/SessionContext";
import { CurrencyProvider } from "@/context/CurrencyContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import ClientLayout from "@/components/ClientLayout";
import { ServiceWorker } from "@/components/ServiceWorker";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "VAULT · Keep your money organised", template: "%s · VAULT" },
  description:
    "Accounts, cards, budgets, bills and investments in one place. Every balance adds up, every change is recorded, and money in two currencies is easy to follow.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "VAULT", statusBarStyle: "black-translucent" },
  openGraph: {
    title: "VAULT · Keep your money organised",
    description: "Keep your money organised: accounts, budgets, bills and investments in one calm place.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout pad itself clear of notches and the home indicator.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f3ee" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full ${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="font-sans min-h-full flex flex-col antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <SessionProvider>
            <CurrencyProvider>
              <ClientLayout>{children}</ClientLayout>
            </CurrencyProvider>
          </SessionProvider>
          <ServiceWorker />
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
