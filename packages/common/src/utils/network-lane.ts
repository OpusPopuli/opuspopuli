import { envInt } from "./env-int.js";

/**
 * Requests one PASS keeps in flight on the network lane
 * (`NETWORK_LANE_CONCURRENCY`, default 4): the detail crawl (propositions,
 * representatives), each civics crawl, the civics page pass. Civics crawls
 * its sources side by side — usually one host each — and every crawl is a
 * pass of its own, so a sync can hold up to this many per source. It bounds
 * concurrency only: each host's RATE is the per-host token bucket's (S1), so
 * more in flight never means faster requests to one site. Lanes are named for
 * the resource they consume (network, CPU, GPU, DB).
 */
export function networkLaneConcurrency(): number {
  return envInt("NETWORK_LANE_CONCURRENCY", 4);
}
