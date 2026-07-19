import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { SidebarWrapper } from "@/components/SidebarWrapper";
import { Toaster } from "@/components/ui/sonner";

export const metadata = {
  title: "Content Studio",
  description: "Social media content creation workflow",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Ink Cartography type system: display, serif, mono */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@400;500;600;700;800;900&family=IBM+Plex+Serif:ital,wght@0,400;0,500;0,600;1,400&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex" suppressHydrationWarning>
        <SidebarWrapper />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  );
}
