const LOCAL_APP_URL = "http://localhost:3000";

export function getAppUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProductionUrl) return `https://${vercelProductionUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  return LOCAL_APP_URL;
}
