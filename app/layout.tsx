import type { Metadata, Viewport } from "next";
import "./globals.css";
import Navbar from "./components/Navbar";

export const metadata: Metadata = {
  title: "NEXUSE | Roblox Farm Operations",
  description:
    "แดชบอร์ดติดตามสถานะบัญชีและสถิติฟาร์ม Roblox แบบเรียลไทม์",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080d13",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className="dark">
      <body className="min-h-screen bg-[#080d13] text-slate-100 antialiased">
        <Navbar />
        {children}
      </body>
    </html>
  );
}
