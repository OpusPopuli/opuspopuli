import { defaultCache } from "@serwist/next/worker";
import { Serwist } from "serwist";
import { customRuntimeCaching } from "./sw-runtime-caching";
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
  // Custom rules FIRST: Serwist returns the first matching route, so
  // `defaultCache` spread ahead of these shadowed them (#1092). See
  // sw-runtime-caching.ts for what each rule is for and why the GraphQL rule
  // was deleted rather than repointed.
  runtimeCaching: [...customRuntimeCaching, ...defaultCache],
});

serwist.addEventListeners();
