"use client";

import { usePathname } from "next/navigation";
import { SidebarNav } from "@/components/sidebar-nav";

export function SidebarWrapper({ isAdmin = false }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/review/") || pathname?.startsWith("/calendar-portal")) return null;
  return <SidebarNav isAdmin={isAdmin} />;
}
