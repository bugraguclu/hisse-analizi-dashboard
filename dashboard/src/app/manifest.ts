import type { MetadataRoute } from "next";

/**
 * Web app manifest (`/manifest.webmanifest`): lets the site be installed to the
 * home screen. iOS only delivers Web Push to sites added to the home screen
 * (iOS 16.4+), so this is also what makes alerts possible on iPhone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Hisse Analizi",
    short_name: "Hisse Analizi",
    description: "Borsa İstanbul piyasa takibi ve hisse analizi",
    lang: "tr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0e0e0e",
    theme_color: "#0e0e0e",
    categories: ["finance", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
