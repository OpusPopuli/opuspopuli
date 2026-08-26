import { redirect } from "next/navigation";

/**
 * My Scans moved to /settings/scans (#1069).
 *
 * This route is kept rather than deleted: scan links have been shared, and the
 * Serwist service worker has the old shell cached on installed PWAs, so a 404
 * here would strand users who are perfectly entitled to the page.
 */
export default function PetitionHistoryRedirect() {
  redirect("/settings/scans");
}
