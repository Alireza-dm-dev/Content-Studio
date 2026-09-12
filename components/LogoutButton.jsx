"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { performLogout } from "@/lib/logout";

/**
 * The single sign-out control for the whole app.
 *
 * Promoted out of app/calendar-portal so the dashboard, the sidebar and the
 * portal all share one implementation rather than each re-posting to the
 * logout endpoint. The session itself is cleared server-side by
 * POST /api/auth/logout, which calls clearSession() in lib/auth — this
 * component never touches the cookie directly.
 *
 * `variant` picks the presentation:
 *   "button"  the shadcn Button used in the portal header
 *   "sidebar" a row matching the ink-cartography sidebar items
 */
export function LogoutButton({ variant = "button" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    // Guard against a double submit: a second POST after the cookie is gone
    // would 401 and surface a confusing error.
    if (pending) return;
    setPending(true);

    const result = await performLogout();

    if (!result.ok) {
      toast.error(result.error);
      setPending(false);
      return;
    }

    // replace() so the authenticated page cannot be reached with Back, and
    // refresh() to drop the cached server-rendered UI for the old session.
    router.replace(result.redirectTo);
    router.refresh();
  }

  const label = pending ? "Signing out…" : "Sign out";

  if (variant === "sidebar") {
    return (
      <button
        type="button"
        onClick={handleLogout}
        disabled={pending}
        aria-label="Sign out"
        style={{
          position: "relative",
          display: "block",
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          borderTop: "1px solid var(--sketch-line-soft)",
          padding: "12px 20px",
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.6 : 1,
          font: "inherit",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 9.5,
            letterSpacing: "0.12em",
            color: "var(--sketch-ink-faint)",
          }}
        >
          &mdash;
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 12,
            letterSpacing: "0.08em",
            color: "var(--sketch-ink-soft)",
            marginTop: 2,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <LogOut size={12} aria-hidden="true" />
          {label.toUpperCase()}
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
          end session
        </div>
      </button>
    );
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleLogout} disabled={pending}>
      <LogOut className="w-4 h-4 mr-1.5" />
      {label}
    </Button>
  );
}
