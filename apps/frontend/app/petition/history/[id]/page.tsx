import { redirect } from "next/navigation";

/**
 * Scan detail moved to /settings/scans/[id] (#1069).
 *
 * Kept for the same reason as the list route: shared links and the cached PWA
 * shell still point here. The id is carried across so a bookmarked scan lands
 * on the same scan, not just the list.
 */
export default async function PetitionScanDetailRedirect({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/settings/scans/${id}`);
}
