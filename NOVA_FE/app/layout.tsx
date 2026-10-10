import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n-context";
import "./globals.css";
import "./coach.css";

export const metadata = {
  title: "NOVA AI — your personal assistant",
  description: "NOVA AI — your personal AI assistant and coach by phone.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8f8f7",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
