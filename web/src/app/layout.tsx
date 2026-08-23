import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Email Studio",
  description: "Slice a flat design into an email-safe HTML build, ready for Braze.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
