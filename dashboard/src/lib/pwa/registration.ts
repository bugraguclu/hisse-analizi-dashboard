/**
 * Service worker registration helpers shared by the update prompt, Web Push and
 * the offline outbox. Registration happens only in production builds: in
 * `next dev` a worker would serve stale chunks across HMR updates.
 */

export const SERVICE_WORKER_URL = "/sw.js";

export function serviceWorkerSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

export function serviceWorkerEnabled(): boolean {
  return serviceWorkerSupported() && process.env.NODE_ENV === "production";
}

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/** Register once per page; resolves null when disabled or when registration fails. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!serviceWorkerEnabled()) return Promise.resolve(null);
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => {
        console.warn("Service worker registration failed:", error instanceof Error ? error.message : error);
        registrationPromise = null;
        return null;
      });
  }
  return registrationPromise;
}

/** The active registration (waits for activation), or null when service workers are off. */
export async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  const registration = await registerServiceWorker();
  if (!registration) return null;
  return navigator.serviceWorker.ready;
}

/** Development: remove a worker left behind by a production build on the same origin. */
export async function unregisterStaleDevWorker(): Promise<void> {
  if (!serviceWorkerSupported() || process.env.NODE_ENV === "production") return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => {
          const url = registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL;
          return url !== undefined && new URL(url).pathname === SERVICE_WORKER_URL;
        })
        .map((registration) => registration.unregister()),
    );
  } catch {
    // Not fatal for development.
  }
}
