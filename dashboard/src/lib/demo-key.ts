/**
 * Canonical form of an API request in the static demo (see lib/demo.ts): the
 * method, path and query with its parameters sorted and re-encoded, so
 * `?countries=TR,US` and `?countries=TR%2CUS` (or another parameter order)
 * name the same recorded response. Shared by the demo runtime and the
 * recorder (scripts/capture-demo-data.mjs loads this file directly with Node),
 * so it must stay free of imports and TypeScript-only syntax such as enums.
 */
export function demoRequestKey(method: string, path: string): string {
  const url = new URL(path, "http://demo.invalid");
  const params = [...url.searchParams.entries()].sort(([a, x], [b, y]) => compare(a, b) || compare(x, y));
  const query = new URLSearchParams(params).toString();
  return `${method.toUpperCase()} ${url.pathname}${query ? `?${query}` : ""}`;
}

/** File name (without extension) a recorded response is stored under: readable, URL- and filesystem-safe. */
export function demoFileName(key: string): string {
  const [, target = key] = key.split(" ");
  const [pathname, query = ""] = target.split("?");
  const slug = (text: string) => text.replace(/^\/+/, "").replace(/[^A-Za-z0-9.-]+/g, "_").replace(/^_+|_+$/g, "");
  const name = query ? `${slug(pathname)}__${slug(query)}` : slug(pathname);
  return name.slice(0, 180) || "root";
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
