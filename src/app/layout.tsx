import type { Metadata } from "next";
import { Providers } from "@/providers/Providers";
import { getAppUrl } from "@/lib/appUrl";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getAppUrl()),
  title: "Rezervo",
  description: "Salon booking management platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sr">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
