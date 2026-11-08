// Javna adresa marketing sajta (canonical, sitemap, robots, og:image).
// Namerno odvojeno od getAppUrl(): ta adresa služi za aplikaciju i linkove u SMS-u,
// a za SEO uvek želimo jednu stalnu adresu, bez obzira na preview i lokalna okruženja.
const DEFAULT_SITE_URL = "https://rezervo.studio";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL).replace(/\/$/, "");
