import { isIP } from "node:net";

// Client IP for the public booking limit.
// On Vercel only `x-vercel-forwarded-for` is used: Vercel sets it to the client's public IP, overwrites the forwarded-for
// headers it receives ("to prevent IP spoofing"), and unlike `x-forwarded-for` it is not replaced by a proxy in front.
// No other header is ever trusted there. Off Vercel there is no trusted proxy, so no header is trusted at all, except
// one explicit test header that only works outside production and only when enabled for local tests.
export const TEST_CLIENT_IP_HEADER = "x-rezervo-test-client-ip";

export type HeaderReader = { get(name: string): string | null };
export type ClientIpEnvironment = { onVercel: boolean; trustTestHeader: boolean };

export function readTrustedClientIp(headers: HeaderReader, environment: ClientIpEnvironment): string | null {
  const raw = environment.onVercel
    ? headers.get("x-vercel-forwarded-for")
    : environment.trustTestHeader ? headers.get(TEST_CLIENT_IP_HEADER) : null;
  if (!raw) return null;
  // The first entry is the client; Vercel sends a single address, a list is tolerated.
  return raw.split(",")[0]?.trim() || null;
}

function expandIpv6(address: string): number[] | null {
  let value = address.toLowerCase();
  let tail: number[] = [];
  const dotted = value.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (isIP(dotted[2]) !== 4) return null;
    const octets = dotted[2].split(".").map(Number);
    tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    value = dotted[1].endsWith("::") ? dotted[1] : dotted[1].slice(0, -1);
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":").map((group) => Number.parseInt(group, 16)) : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - rest.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array(Math.max(missing, 0)).fill(0), ...rest, ...tail];
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

// Bucket for the limit: an IPv4 address as is (IPv4-mapped IPv6 counts as IPv4); IPv6 by its /64 prefix, because one
// subscriber usually controls a whole /64. Returns null for anything that is not an IP address.
export function normalizeClientIpBucket(rawIp: string): string | null {
  const ip = rawIp.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const version = isIP(ip);
  if (version === 4) return `v4:${ip}`;
  if (version !== 6) return null;
  const groups = expandIpv6(ip);
  if (!groups) return null;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return `v4:${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
  }
  return `v6:${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}
