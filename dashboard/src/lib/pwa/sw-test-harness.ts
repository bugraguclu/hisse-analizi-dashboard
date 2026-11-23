/**
 * Test-only harness: evaluates the generated service worker script in `node:vm`
 * with an in-memory Cache Storage, a scripted `fetch` and fake SW globals.
 */

import vm from "node:vm";
import { serviceWorkerScript } from "./service-worker.ts";

export const ORIGIN = "https://hisse.test";

type Handler = (event: unknown) => void;

export class FakeCache {
  readonly entries = new Map<string, Response>();

  private key(input: RequestInfo | URL): string {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, ORIGIN);
    return url.pathname + url.search;
  }

  async match(input: RequestInfo | URL): Promise<Response | undefined> {
    const hit = this.entries.get(this.key(input));
    return hit ? hit.clone() : undefined;
  }

  async put(input: RequestInfo | URL, response: Response): Promise<void> {
    const key = this.key(input);
    this.entries.delete(key);
    this.entries.set(key, response.clone());
  }

  async delete(input: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.key(input));
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((key) => new Request(new URL(key, ORIGIN)));
  }

  async add(input: string): Promise<void> {
    const response = await harnessFetch(input);
    if (!response.ok) throw new TypeError(`add failed: ${input}`);
    await this.put(input, response);
  }
}

export class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.stores.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
}

export type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;

let currentRoute: Route = () => {
  throw new TypeError("network down");
};
export const fetchLog: string[] = [];

/** Responses from the "server" look like same-origin (type "basic") fetch results. */
export function basic(body: string, init: ResponseInit & { contentType?: string } = {}): Response {
  const response = new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "text/html; charset=utf-8", ...(init.headers ?? {}) },
  });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

async function harnessFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, ORIGIN);
  fetchLog.push(url.pathname + url.search);
  return currentRoute(url, init);
}

export function setNetwork(route: Route): void {
  currentRoute = route;
}

export function networkDown(): void {
  currentRoute = () => {
    throw new TypeError("Failed to fetch");
  };
}

export interface LoadedWorker {
  helpers: {
    VERSION: string;
    STATIC_CACHE: string;
    PAGES_CACHE: string;
    extractAssetUrls(html: string): string[];
    requestKind(request: Request): string | null;
    pageKey(url: string): string;
  };
  caches: FakeCacheStorage;
  dispatch(type: string, event: Record<string, unknown>): Promise<unknown[]>;
  fetchEvent(input: string, init?: { mode?: RequestMode; method?: string; headers?: Record<string, string> }): Promise<Response | undefined>;
  state: { skipWaiting: number; claimed: number; active: boolean; posted: unknown[]; notifications: unknown[]; opened: string[] };
  context: vm.Context;
}

export function loadWorker(version = "build-1", existing?: FakeCacheStorage, extraGlobals: Record<string, unknown> = {}): LoadedWorker {
  const handlers = new Map<string, Handler[]>();
  const cacheStorage = existing ?? new FakeCacheStorage();
  const state = { skipWaiting: 0, claimed: 0, active: false, posted: [] as unknown[], notifications: [] as unknown[], opened: [] as string[] };
  const self: Record<string, unknown> = {
    location: new URL(`${ORIGIN}/sw.js`),
    registration: {
      get active() {
        return state.active ? {} : null;
      },
      showNotification: async (title: string, options: unknown) => {
        state.notifications.push({ title, options });
      },
    },
    clients: {
      claim: async () => {
        state.claimed += 1;
      },
      matchAll: async () => [],
      openWindow: async (url: string) => {
        state.opened.push(url);
        return null;
      },
    },
    skipWaiting: async () => {
      state.skipWaiting += 1;
    },
    addEventListener(type: string, handler: Handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    },
  };
  const context = vm.createContext({
    self,
    caches: cacheStorage,
    fetch: harnessFetch,
    Response,
    Request,
    Headers,
    URL,
    URLSearchParams,
    Promise,
    setTimeout,
    clearTimeout,
    console,
    ...extraGlobals,
  });
  vm.runInContext(serviceWorkerScript(version), context);

  async function dispatch(type: string, event: Record<string, unknown>): Promise<unknown[]> {
    const pending: Promise<unknown>[] = [];
    const full = {
      ...event,
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    };
    for (const handler of handlers.get(type) ?? []) handler(full);
    return Promise.all(pending);
  }

  async function fetchEvent(input: string, init: { mode?: RequestMode; method?: string; headers?: Record<string, string> } = {}) {
    const request = new Request(new URL(input, ORIGIN), { method: init.method ?? "GET", headers: init.headers });
    if (init.mode) Object.defineProperty(request, "mode", { value: init.mode });
    let responded: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    const event = {
      request,
      respondWith(promise: Promise<Response>) {
        responded = promise;
      },
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    };
    for (const handler of handlers.get("fetch") ?? []) handler(event);
    const response = responded ? await responded : undefined;
    await Promise.all(pending);
    return response;
  }

  return {
    helpers: self.__hisseSw as LoadedWorker["helpers"],
    caches: cacheStorage,
    dispatch,
    fetchEvent,
    state,
    context,
  };
}
