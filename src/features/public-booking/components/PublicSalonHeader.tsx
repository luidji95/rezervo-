import type { PublicSalon } from "../types";

type PublicSalonHeaderProps = {
  salon: PublicSalon;
};

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function getInstagramUrl(value: string | null): string | null {
  if (!value) return null;

  const directUrl = safeHttpUrl(value);
  if (directUrl) return directUrl;

  const username = value.trim().replace(/^@/, "");
  return /^[a-zA-Z0-9._]{1,30}$/.test(username)
    ? `https://www.instagram.com/${username}`
    : null;
}

export function PublicSalonHeader({ salon }: PublicSalonHeaderProps) {
  const logoUrl = safeHttpUrl(salon.logoUrl);
  const coverImageUrl = safeHttpUrl(salon.coverImageUrl);
  const websiteUrl = safeHttpUrl(salon.websiteUrl);
  const instagramUrl = getInstagramUrl(salon.instagramUrl);
  const description = salon.description || salon.shortDescription;
  const location = [salon.addressLine, salon.city].filter(Boolean).join(", ");

  return (
    <header className="public-salon-header" id="public-salon-profile">
      <div className="public-salon-cover">
        {coverImageUrl ? (
          // The image host is salon-managed and cannot be enumerated in Next config.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverImageUrl} alt="" />
        ) : (
          <div className="public-salon-cover-placeholder" aria-hidden="true" />
        )}
      </div>

      <div className="public-salon-profile">
        <div className="public-salon-logo" aria-hidden={!logoUrl}>
          {logoUrl ? (
            // The image host is salon-managed and cannot be enumerated in Next config.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={`${salon.name} logo`} />
          ) : (
            <span>{salon.name.slice(0, 1).toUpperCase()}</span>
          )}
        </div>

        <div className="public-salon-intro">
          <p className="public-booking-eyebrow">Online rezervacije</p>
          <h1>{salon.name}</h1>
          {description && <p className="public-salon-description">{description}</p>}
        </div>
      </div>

      {(location || salon.phone || salon.email || websiteUrl || instagramUrl) && (
        <div className="public-salon-details" aria-label="Kontakt podaci salona">
          {location && <span>{location}</span>}
          {salon.phone && <a href={`tel:${salon.phone}`}>{salon.phone}</a>}
          {salon.email && <a href={`mailto:${salon.email}`}>{salon.email}</a>}
          {websiteUrl && (
            <a href={websiteUrl} target="_blank" rel="noreferrer">
              Website
            </a>
          )}
          {instagramUrl && (
            <a href={instagramUrl} target="_blank" rel="noreferrer">
              Instagram
            </a>
          )}
        </div>
      )}
    </header>
  );
}
