import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";

export default function CalendarPortalLayout({ children }) {
  return (
    <div className="min-h-full flex flex-col">
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 24px",
          borderBottom: "1px solid var(--sketch-line)",
          background: "var(--sketch-paper)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 11,
            letterSpacing: "0.18em",
            color: "var(--sketch-ink)",
          }}
        >
          CALENDAR PORTAL
        </div>
        <LogoutButton />
      </header>
      <div style={{ flex: 1, padding: "24px" }}>
        {children}
      </div>
    </div>
  );
}
