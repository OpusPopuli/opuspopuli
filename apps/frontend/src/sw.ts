import { defaultCache } from "@serwist/next/worker";
import { Serwist } from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    ...defaultCache,
    // GraphQL - network first with cache fallback
    {
      urlPattern: /\/graphql/,
      handler: "NetworkFirst",
      options: {
        cacheName: "graphql-cache",
        expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
        networkTimeoutSeconds: 10,
      },
    },
    // Auth endpoints - never cache
    {
      urlPattern: /\/(auth|login|logout|register)/,
      handler: "NetworkOnly",
    },
    // Images - cache first
    {
      urlPattern: /\.(png|jpg|jpeg|svg|gif|webp|ico)$/,
      handler: "CacheFirst",
      options: {
        cacheName: "images",
        expiration: { maxEntries: 100, maxAgeSeconds: 2592000 },
      },
    },
  ],
});

serwist.addEventListeners();
