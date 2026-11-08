import type { Metadata } from "next";
import { Providers } from "@/providers/Providers";
import { SITE_URL } from "@/lib/siteUrl";
import "./globals.css";

export const metadata: Metadata = {
  // Javne stranice (canonical, og:image) uvek pokazuju na glavni domen, ne na preview/vercel.app adresu.
  metadataBase: new URL(SITE_URL),
  title: "Rezervo",
  description: "Online zakazivanje termina za frizerske, barber i beauty salone.",
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
