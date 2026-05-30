import { BriefingPage } from "@/components/briefing/BriefingPage";

// Auth guard lives in the layout via ProtectedRoute, so this page
// just renders.
export default function MeBriefingPage() {
  return <BriefingPage />;
}
