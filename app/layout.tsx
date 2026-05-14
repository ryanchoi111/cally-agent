import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cally Agent",
  description: "Google Calendar assistant that optimizes your schedule using AI"
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
