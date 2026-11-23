"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";

// adminOnly entries are hidden from normal users. Hiding is presentation only:
// proxy.js refuses these paths and each route enforces its own check, so a
// hand-typed URL is still denied.
const NAV = [
  { n: "01", label: "TODAY", sub: "publish queue", href: "/today" },
  { n: "02", label: "BRANDS", sub: "brand profiles", href: "/brands" },
  { n: "03", label: "CALENDAR", sub: "content schedule", href: "/content-calendar" },
  { n: "04", label: "CREATE IMAGE", sub: "prompt gen", href: "/create-image" },
  { n: "05", label: "CREATE VIDEO", sub: "video prompts", href: "/create-video" },
  { n: "06", label: "MEDIA", sub: "generated assets", href: "/generated-media" },
  { n: "07", label: "PROMPTS", sub: "output library", href: "/generated-prompts" },
  { n: "08", label: "LIBRARY", sub: "templates", href: "/prompt-library", adminOnly: true },
  { n: "09", label: "REPORT", sub: "campaign report", href: "/content-report" },
];

const UTILITY = [
  { n: "10", label: "SETTINGS", sub: "config", href: "/settings", adminOnly: true },
];

export function SidebarNav({ isAdmin = false }) {
  const pathname = usePathname();
  const visible = (items) => items.filter((item) => !item.adminOnly || isAdmin);
  const navItems = visible(NAV);
  const utilityItems = visible(UTILITY);
  const isActive = (href) => pathname === href || (href !== "/" && pathname.startsWith(href));
  // Phone only (≤640px): the sidebar becomes an off-canvas drawer opened from a
  // slim top bar. Above 640px nothing changes: the CSS below is media-scoped.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
    <style>{`
      .app-mobilebar, .app-backdrop, .app-drawer-close { display: none; }
      @media (max-width: 640px) {
        body { flex-direction: column; }
        body > main { min-width: 0; width: 100%; }
        .app-mobilebar {
          display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 900;
          background: var(--sketch-ink); color: var(--sketch-paper); padding: 10px 14px;
          font-family: var(--font-mono-ink); font-size: 11px; letter-spacing: 0.18em;
        }
        .app-mobilebar button {
          font: inherit; letter-spacing: 0.12em; color: var(--sketch-paper); background: transparent;
          border: 1px solid var(--sketch-paper); padding: 6px 10px; cursor: pointer; min-height: 36px;
        }
        .app-sidebar {
          position: fixed !important; top: 0; bottom: 0; left: 0; z-index: 1000;
          width: 260px !important; flex: none !important; min-height: 0 !important; overflow-y: auto;
          transform: translateX(-100%); visibility: hidden;
          transition: transform 180ms ease, visibility 0s linear 180ms;
        }
        .app-sidebar[data-open="true"] { transform: none; visibility: visible; transition: transform 180ms ease; }
        .app-backdrop[data-open="true"] { display: block; position: fixed; inset: 0; z-index: 999; background: rgba(28,24,18,0.35); border: 0; padding: 0; }
        .app-drawer-close { display: block; width: 100%; text-align: left; padding: 10px 20px; font-family: var(--font-mono-ink); font-size: 10px; letter-spacing: 0.12em; background: transparent; border: 0; border-bottom: 1px solid var(--sketch-line); cursor: pointer; color: var(--sketch-ink-soft); }
      }
    `}</style>
    <div className="app-mobilebar">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="app-sidebar"
        onClick={() => setOpen(true)}
      >
        ☰ MENU
      </button>
      <span>CONTENT <span style={{ color: "var(--sketch-vermilion)" }}>STUDIO</span></span>
    </div>
    <button
      type="button"
      className="app-backdrop"
      data-open={open}
      aria-label="Close menu"
      tabIndex={-1}
      onClick={() => setOpen(false)}
    />
    <aside
      id="app-sidebar"
      className="app-sidebar"
      data-open={open}
      // Any navigation from the drawer closes it.
      onClick={(e) => { if (e.target.closest?.("a")) setOpen(false); }}
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
            V1.3.41
          </div>
        </div>
      </Link>

      <button type="button" className="app-drawer-close" onClick={() => setOpen(false)}>
        ✕ CLOSE MENU
      </button>
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
    </>
  );
}
