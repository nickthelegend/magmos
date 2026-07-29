import type { Metadata } from "next";
import { Toaster } from "sonner";
import { Poppins, Geist, Inter, Space_Grotesk } from "next/font/google";
import { SmoothScroll } from "@/components/providers/smooth-scroll";
import { DashboardProviders } from "@/components/dashboard/providers";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

// Wordmark / display font for the Magmos logotype.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://magmos.xyz";
const TITLE = "Magmos | Real-time Cross-Border Payroll on Arc";
const TITLE_TEMPLATE = "%s | Magmos";
const OG_DESC =
  "Magmos streams USDC salaries and contractor payouts to recipients worldwide, settled per second on Arc — Circle's stablecoin L1. Fund once, pay continuously, claim anytime, bridge home via CCTP.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: TITLE_TEMPLATE,
  },
  description: OG_DESC,
  applicationName: "Magmos",
  authors: [{ name: "Magmos" }],
  creator: "Magmos",
  publisher: "Magmos",
  category: "finance",
  keywords: [
    "Magmos",
    "cross-border payments",
    "stablecoin remittances",
    "USDC payroll",
    "Arc blockchain",
    "Circle",
    "CCTP",
    "global payroll",
    "contractor payouts",
    "freelancer payouts",
    "real-time settlement",
    "onchain payroll",
    "streaming payments",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    siteName: "Magmos",
    url: SITE_URL,
    locale: "en_US",
    title: TITLE,
    description: OG_DESC,
    images: [{ url: "/sweem-thumbnail.png", width: 1920, height: 1080, alt: "Magmos — real-time cross-border payroll on Arc" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: OG_DESC,
    images: ["/sweem-thumbnail.png"],
  },
};

// Structured data so search engines render Magmos as a recognised software product.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Magmos",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  description: OG_DESC,
  image: `${SITE_URL}/sweem-thumbnail.png`,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: {
    "@type": "Organization",
    name: "Magmos",
    url: SITE_URL,
    logo: `${SITE_URL}/sweem.png`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("h-full", "antialiased", poppins.variable, "font-sans", geist.variable, inter.variable, spaceGrotesk.variable)}>
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {/* Wallet + react-query context is global so the landing page can connect
            and the connection persists into /dashboard and /onboarding without a
            provider remount. */}
        <DashboardProviders>
          <SmoothScroll>{children}</SmoothScroll>
        </DashboardProviders>
        {/* Mounted at the root: /yield and /faucet call toast() too, and with the Toaster only
            inside the dashboard and onboarding layouts their feedback was silently dropped. */}
        <Toaster theme="dark" richColors position="bottom-right" />
      </body>
    </html>
  );
}
