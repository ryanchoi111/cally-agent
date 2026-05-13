import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cally Calendar Agent",
  description: "Read-only Google Calendar agent with Firebase authentication"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
