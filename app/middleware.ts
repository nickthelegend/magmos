import { NextResponse, type NextRequest } from 'next/server'

/**
 * Security headers, applied to every response.
 *
 * This app holds a wallet connection and, on /claim, derives private keys in the browser. A single
 * injected script would be able to read a spending key out of React state before it is used. So the
 * headers below are not box-ticking — CSP is the control that makes the "keys never leave your
 * device" claim on /claim actually mean something.
 *
 * `unsafe-inline` and `unsafe-eval` for scripts are present and I would rather they were not. Next's
 * dev overlay and hydration inline bootstrapping both require them, and a nonce-based policy needs
 * every inline script to be threaded through the framework's nonce plumbing. That is worth doing
 * before this handles real payroll; it is documented here rather than silently omitted.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Arc RPC, the Circle CCTP attestation service, and Groq. Anything else is refused, so an injected
  // script cannot post a recovered key to an attacker's endpoint.
  "connect-src 'self' https://rpc.testnet.arc.network wss://rpc.testnet.arc.network https://iris-api-sandbox.circle.com https://api.groq.com https://testnet.arcscan.app",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

export function middleware(req: NextRequest) {
  const res = NextResponse.next()

  res.headers.set('content-security-policy', CSP)
  // Clickjacking a wallet-connected dashboard is how a "just sign this" attack starts.
  res.headers.set('x-frame-options', 'DENY')
  res.headers.set('x-content-type-options', 'nosniff')
  res.headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  // No feature here needs a camera, a microphone, or a location, so none is granted.
  res.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  res.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains')

  // API responses must never be cached. An audit export or a claim list sitting in a shared cache is
  // exactly the payroll data the rest of this design works to keep private.
  if (req.nextUrl.pathname.startsWith('/api/')) {
    res.headers.set('cache-control', 'no-store, max-age=0')
  }

  return res
}

export const config = {
  // Skip static assets — they need no headers and matching them is wasted work on every request.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
}
