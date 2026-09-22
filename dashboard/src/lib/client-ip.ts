import { isIP } from "node:net";

/**
 * Server-only helpers for the /api proxy: derive the client address that is
 * forwarded to the backend rate limiter.
 */

/** Strip ports/brackets and unwrap IPv4-mapped IPv6; null when not an IP address. */
export function normalizeIp(raw: string): string | null {
  let ip = raw.trim();
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]")); // "[2001:db8::1]:443"
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":")); // "203.0.113.7:5123"
  if (/^::ffff:/i.test(ip) && isIP(ip.slice(7)) === 4) ip = ip.slice(7); // "::ffff:127.0.0.1"
  return isIP(ip) ? ip : null;
}

/**
 * Pick the client address out of an X-Forwarded-For chain.
 *
 * Next.js fills `x-forwarded-for` with the socket address only when the
 * incoming request has no such header (next/dist/server/base-server.js), and
 * route handlers cannot read the socket otherwise. So:
 * - trustedHops = 0 (Next exposed directly): the header is normally the socket
 *   address Next inserted; a client-supplied header cannot be told apart, so
 *   production should run a reverse proxy in front of Next.
 * - trustedHops = N: N trusted reverse proxies appended to the chain; the entry
 *   appended by the outermost one (N-th from the right) is the client.
 */
export function clientIpFromForwardedFor(header: string | null | undefined, trustedHops: number): string | null {
  const chain = (header ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (chain.length === 0) return null;
  const hops = Number.isFinite(trustedHops) && trustedHops > 0 ? Math.min(Math.floor(trustedHops), 10) : 0;
  const index = Math.max(0, chain.length - Math.max(1, hops));
  return normalizeIp(chain[index]);
}

/** TRUSTED_PROXY_HOPS: number of reverse proxies in front of Next.js (default 0). */
export function trustedProxyHops(env: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
  const hops = Number.parseInt(env ?? "0", 10);
  return Number.isFinite(hops) && hops > 0 ? Math.min(hops, 10) : 0;
}
