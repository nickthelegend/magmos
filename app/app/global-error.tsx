"use client";

/**
 * Last-resort error boundary.
 *
 * Next replaces the entire document when this renders, so it cannot use the app's layout, providers
 * or CSS variables — the styles below are inline for that reason, not by preference.
 *
 * It deliberately shows `digest` rather than the raw message. A stack trace on a payroll dashboard
 * can leak connection strings and internal paths to whoever is looking at the screen, and the digest
 * is the value that actually correlates to the server log.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#131316",
          color: "#f4f4f5",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "44ch", textAlign: "center" }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#FF6A1A",
            }}
          >
            Something broke
          </p>
          <h1 style={{ margin: "12px 0 0", fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>
            The page failed to render
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.6, color: "#a1a1aa" }}>
            Nothing was signed or sent. Your payroll and any pending claims are untouched — this is a
            display failure, not a transaction one.
          </p>
          {error.digest && (
            <p style={{ margin: "16px 0 0", fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#71717a" }}>
              ref {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              border: 0,
              borderRadius: 999,
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 600,
              background: "#FF6A1A",
              color: "#000",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
