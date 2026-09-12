import Link from "next/link";

/**
 * Shown when a signed-in user opens a page for a brand they are not a member of.
 *
 * Deliberately does NOT redirect to some other brand: silently swapping the
 * brand would hide an authorization problem and could show the wrong data
 * under a URL the user believes points somewhere else.
 */
export function NotAuthorized({
  title = "Not authorized",
  message = "You do not have access to this brand.",
}) {
  return (
    <div style={{ padding: "36px 44px 48px" }}>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 900,
          fontSize: 48,
          lineHeight: 0.92,
          textTransform: "uppercase",
          color: "var(--sketch-ink)",
        }}
      >
        {title}
      </h1>
      <div
        style={{
          borderBottom: "2px solid var(--sketch-vermilion)",
          width: 200,
          marginTop: 8,
          marginBottom: 20,
        }}
      />
      <div
        style={{
          fontFamily: "var(--font-mono-ink)",
          fontSize: 12,
          color: "var(--sketch-ink-faint)",
          lineHeight: 1.6,
          maxWidth: 520,
        }}
      >
        {message}
        <br />
        <Link
          href="/brands"
          style={{ color: "var(--sketch-vermilion)", textDecoration: "underline" }}
        >
          Back to your brands
        </Link>
      </div>
    </div>
  );
}

/**
 * Shown to an authenticated user who belongs to no brand yet. They stay signed
 * in and keep the navigation; there is simply nothing scoped to them.
 */
export function NoBrandsAssigned() {
  return (
    <div style={{ padding: "36px 44px 48px" }}>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 900,
          fontSize: 48,
          lineHeight: 0.92,
          textTransform: "uppercase",
          color: "var(--sketch-ink)",
        }}
      >
        No brands assigned
      </h1>
      <div
        style={{
          borderBottom: "2px solid var(--sketch-vermilion)",
          width: 200,
          marginTop: 8,
          marginBottom: 20,
        }}
      />
      <div
        style={{
          fontFamily: "var(--font-mono-ink)",
          fontSize: 12,
          color: "var(--sketch-ink-faint)",
          lineHeight: 1.6,
          maxWidth: 520,
        }}
      >
        Your account is active, but no brand has been assigned to it yet.
        <br />
        Ask an administrator to add you to a brand, then reload this page.
      </div>
    </div>
  );
}
