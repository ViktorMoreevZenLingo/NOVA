import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n-context";

export const metadata = {
  title: "Ало",
  description: "Voice assistant",
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
