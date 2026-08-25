import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Email Studio",
  description: "Slice a flat design into an email-safe HTML build, ready for Braze.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Every string the app renders is pt-BR; the `en` this shipped with was
  // making screen readers and Safari's translation prompt both get it wrong.
  return (
    <html lang="pt-BR">
      <body>
        <AppNav />
        {children}
      </body>
    </html>
  );
}
