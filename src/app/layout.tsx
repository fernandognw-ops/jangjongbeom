import type { Metadata, Viewport } from "next";
import { InventoryProvider } from "@/context/InventoryContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "실시간 통합 수불관리 시스템",
  description: "제조·유통 재고 자산 및 입출고 관리",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "수불관리",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#E0E7FF",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="font-sans min-h-screen bg-[#E0E7FF] text-slate-800 antialiased">
        <ErrorBoundary>
          <InventoryProvider>{children}</InventoryProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
