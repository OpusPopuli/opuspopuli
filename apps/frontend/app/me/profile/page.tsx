import { ModelOfMePage } from "@/components/profile/ModelOfMePage";

// Auth guard lives in the SettingsShellLayout via ProtectedRoute, so
// this page just renders.
export default function MeProfilePage() {
  return <ModelOfMePage />;
}
