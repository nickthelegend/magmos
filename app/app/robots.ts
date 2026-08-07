import type { MetadataRoute } from "next";

/**
 * Keep the authenticated surfaces out of search results.
 *
 * /claim and /dashboard are wallet-gated so nothing sensitive is actually reachable, but an indexed
 * "My private pay" URL is a bad look for a product whose whole claim is confidentiality — and it
 * invites phishing pages that rank alongside it.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://magmos.vercel.app";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/claim", "/api/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
