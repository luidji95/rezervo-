import type { NextConfig } from "next";

// The manage-booking page is reached through a private link (token in the URL fragment): never cache or index it,
// and never pass it on as a referrer.
const privatePageHeaders = [
  { key: "Cache-Control", value: "no-store, max-age=0" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  async headers() {
    return [{ source: "/manage-booking", headers: privatePageHeaders }];
  },
};

export default nextConfig;
