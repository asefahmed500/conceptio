import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Backend Atlas",
  description: "A visual map of every backend engineering concept.",
  openGraph: {
    title: "Backend Atlas",
    description: "A visual map of every backend engineering concept.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
