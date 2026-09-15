"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";

// adminOnly entries are hidden from normal users. Hiding is presentation only:
// proxy.js refuses these paths and each route enforces its own check, so a
// hand-typed URL is still denied.
const NAV = [
  { n: "01", label: "BRANDS", sub: "brand profiles", href: "/brands" },
  { n: "02", label: "CALENDAR", sub: "content schedule", href: "/content-calendar" },
  { n: "03", label: "CREATE IMAGE", sub: "prompt gen", href: "/create-image" },
  { n: "04", label: "CREATE VIDEO", sub: "video prompts", href: "/create-video" },
  { n: "05", label: "MEDIA", sub: "generated assets", href: "/generated-media" },
  { n: "06", label: "PROMPTS", sub: "output library", href: "/generated-prompts" },
  { n: "07", label: "LIBRARY", sub: "templates", href: "/prompt-library", adminOnly: true },
  { n: "08", label: "REPORT", sub: "campaign report", href: "/content-report" },
];

const UTILITY = [
  { n: "09", label: "SETTINGS", sub: "config", href: "/settings", adminOnly: true },
];

export function SidebarNav({ isAdmin = false }) {
  const pathname = usePathname();
  const visible = (items) => items.filter((item) => !item.adminOnly || isAdmin);
  const navItems = visible(NAV);
  const utilityItems = visible(UTILITY);
  const isActive = (href) => pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <aside
      style={{
        width: 230,
        flex: "0 0 230px",
        borderRight: "1px solid var(--sketch-line)",
        background: "var(--sketch-paper)",
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
      }}
    >
      {/* Brand mark on dark ink */}
      <Link href="/" style={{ textDecoration: "none" }}>
        <div style={{ background: "var(--sketch-ink)", padding: "18px 20px 20px" }}>
          <div
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 11,
              letterSpacing: "0.18em",
              color: "var(--sketch-paper)",
            }}
          >
            CONTENT
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 11,
              letterSpacing: "0.18em",
              color: "var(--sketch-vermilion)",
              fontWeight: 500,
            }}
          >
            STUDIO
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 9.5,
              letterSpacing: "0.1em",
              color: "var(--sketch-ink-faint)",
              marginTop: 6,
            }}
          >
            v0.8.2
          </div>
        </div>
      </Link>

      <nav style={{ flex: 1, padding: "4px 0" }}>
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link key={item.n} href={item.href} style={{ textDecoration: "none" }}>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  textAlign: "left",
                  background: active ? "var(--sketch-vermilion-wash)" : "transparent",
                  borderBottom: "1px solid var(--sketch-line-soft)",
                  padding: "12px 20px",
                  cursor: "pointer",
                  transition: "background 120ms ease",
                }}
              >
                {active && (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: 3,
                      background: "var(--sketch-vermilion)",
                    }}
                  />
                )}
                <div
                  style={{
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 9.5,
                    letterSpacing: "0.12em",
                    color: "var(--sketch-ink-faint)",
                  }}
                >
                  {item.n}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 12,
                    letterSpacing: "0.08em",
                    color: active ? "var(--sketch-ink)" : "var(--sketch-ink-soft)",
                    fontWeight: active ? 600 : 400,
                    marginTop: 2,
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 9.5,
                    letterSpacing: "0.04em",
                    color: "var(--sketch-ink-faint)",
                    marginTop: 2,
                  }}
                >
                  {item.sub}
                </div>
              </div>
            </Link>
          );
        })}
        {utilityItems.length > 0 && (
          <div style={{ height: 1, background: "var(--sketch-line)", margin: "4px 20px" }} />
        )}
        {utilityItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link key={item.n} href={item.href} style={{ textDecoration: "none" }}>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  textAlign: "left",
                  background: active ? "var(--sketch-vermilion-wash)" : "transparent",
                  borderBottom: "1px solid var(--sketch-line-soft)",
                  padding: "12px 20px",
                  cursor: "pointer",
                }}
              >
                {active && (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: 3,
                      background: "var(--sketch-vermilion)",
                    }}
                  />
                )}
                <div
                  style={{
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 9.5,
                    letterSpacing: "0.12em",
                    color: "var(--sketch-ink-faint)",
                  }}
                >
                  {item.n}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 12,
                    letterSpacing: "0.08em",
                    color: active ? "var(--sketch-ink)" : "var(--sketch-ink-soft)",
                    fontWeight: active ? 600 : 400,
                    marginTop: 2,
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 9.5,
                    letterSpacing: "0.04em",
                    color: "var(--sketch-ink-faint)",
                    marginTop: 2,
                  }}
                >
                  {item.sub}
                </div>
              </div>
            </Link>
          );
        })}

        {/* Global action, available to every signed-in user. The sidebar sits
            in the root layout, so this is present on the dashboard and on every
            main page regardless of role or how many brands are assigned. */}
        <LogoutButton variant="sidebar" />
      </nav>

      <div
        style={{
          padding: "14px 20px",
          borderTop: "1px solid var(--sketch-line)",
          fontFamily: "var(--font-mono-ink)",
          fontSize: 9.5,
          letterSpacing: "0.08em",
          color: "var(--sketch-ink-faint)",
        }}
      >
        <div>LOCAL &middot; SINGLE USER</div>
        <div style={{ marginTop: 3 }}>SQLite &middot; Next.js 16</div>
      </div>
    </aside>
  );
}
