import type { Metadata, Viewport } from "next";
import "./globals.css";
import Navbar from "./components/Navbar";

export const metadata: Metadata = {
  title: "Roblox Multi-Account Farm Dashboard | Real-Time Telemetry",
  description:
    "Real-time Cyberpunk Multi-Account Farm Telemetry Dashboard for Roblox — Monitor Gems, Gold, Levels, Ping, FPS & Bot Status from anywhere.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#06060f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className="dark">
      <body className="min-h-screen bg-[#06060f] text-slate-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
        <Navbar />
        {children}
      </body>
    </html>
  );
}
