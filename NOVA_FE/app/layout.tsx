import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n-context";
import "./globals.css";

export const metadata = {
  title: "NOVA AI — личният ти асистент",
  description: "NOVA AI — твоят персонален AI асистент по телефона.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8f8f7",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="bg">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
