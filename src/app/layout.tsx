import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IDMR AI",
  description: "Search and ask questions about IDMR transcripts and textbooks",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#0a0a1a] bg-gradient-to-br from-[#0c1033] via-[#150a2e] to-[#1a0a20] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
