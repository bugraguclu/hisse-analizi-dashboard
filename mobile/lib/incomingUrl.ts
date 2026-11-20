import {
  readExternalAppUrl,
  routeForAction,
  type ExternalLinkRejection,
  type ResolvedRoute,
} from "./externalLinking.ts";

/** Minimal subset of React Native's `Linking` API for testability. */
export interface IncomingUrlSource {
  getInitialURL(): Promise<string | null>;
  addEventListener(type: "url", listener: (event: { url: string }) => void): { remove(): void };
}

export type IncomingUrlHandler = (url: string) => void;

/**
 * Holds incoming OS URLs (Universal Links, custom scheme links, notification links) until
 * local startup has succeeded and the root navigator is ready.
 *
 * Adapted from TusAnkiM's `IncomingUrlQueue`:
 * - Subscribes once per process launch and reads `getInitialURL()` once.
 * - Deduplicates a launch URL that also arrives via the `url` event.
 * - Drains in arrival order (launch URL first) when `attach()` is called after startup.
 * - Isolates handler exceptions per URL so one bad link never stalls the queue.
 */
export class IncomingUrlQueue {
  private readonly pending: string[] = [];
  private handler: IncomingUrlHandler | null = null;
  private started = false;

  start(source: IncomingUrlSource): void {
    if (this.started) return;
    this.started = true;
    let launchUrlRead = false;
    const arrivedWhileReading = new Set<string>();

    source.addEventListener("url", ({ url }) => {
      if (!launchUrlRead) arrivedWhileReading.add(url);
      this.receive(url);
    });

    source
      .getInitialURL()
      .then((url) => {
        launchUrlRead = true;
        if (!url || arrivedWhileReading.has(url)) return;
        this.pending.unshift(url);
        this.drain();
      })
      .catch((error) => {
        launchUrlRead = true;
        console.warn("[Linking] initial URL read failed:", error);
      });
  }

  receive(url: string): void {
    if (!url) return;
    this.pending.push(url);
    this.drain();
  }

  attach(handler: IncomingUrlHandler): () => void {
    this.handler = handler;
    this.drain();
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  }

  private drain(): void {
    while (this.handler && this.pending.length > 0) {
      const url = this.pending.shift() as string;
      try {
        this.handler(url);
      } catch (error) {
        console.warn("[Linking] incoming URL handler failed:", error);
      }
    }
  }
}

const sharedQueue = new IncomingUrlQueue();

export function startIncomingUrls(source: IncomingUrlSource): void {
  sharedQueue.start(source);
}

export function attachIncomingUrlHandler(handler: IncomingUrlHandler): () => void {
  return sharedQueue.attach(handler);
}

export type IncomingUrlNavigation =
  | { method: "push" | "replace" | "dismissTo"; route: ResolvedRoute }
  | { method: "reject"; rejection: ExternalLinkRejection };

/**
 * Decides the exact navigation action for an incoming URL given the current pathname.
 * - Tab roots use `dismissTo` (or `replace` if already on that tab with new params) to avoid stacking duplicates.
 * - Stock/Makro/Search screens use `replace` when the same route family is already on top, else `push`.
 */
export function incomingUrlNavigation(
  url: string,
  currentPathname: string | undefined,
): IncomingUrlNavigation | null {
  const reading = readExternalAppUrl(url);
  if (!reading) return null;
  if ("rejected" in reading) return { method: "reject", rejection: reading.rejected };

  const route = routeForAction(reading.action);
  const normalizedCurrent = (currentPathname ?? "").replace(/^\/\(tabs\)/, "") || "/";
  const normalizedTarget = route.pathname.replace(/^\/\(tabs\)/, "") || "/";

  if (route.isTabRoot) {
    return {
      method: normalizedCurrent === normalizedTarget ? "replace" : "dismissTo",
      route,
    };
  }

  const sameFamily =
    normalizedCurrent === normalizedTarget ||
    (normalizedTarget.startsWith("/stock/") && normalizedCurrent.startsWith("/stock/"));

  return {
    method: sameFamily ? "replace" : "push",
    route,
  };
}
