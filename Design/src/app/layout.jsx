import "../styles.css";

export const metadata = {
  title: "Ало — личният ти асистент",
  description: "Ало — твоят персонален AI асистент по телефона.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8f8f7",
};

export default function RootLayout({ children }) {
  return <html lang="bg" suppressHydrationWarning><body>{children}</body></html>;
}
