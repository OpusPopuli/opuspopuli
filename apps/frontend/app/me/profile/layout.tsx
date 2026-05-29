import { SettingsShellLayout } from "@/components/settings/SettingsShellLayout";

/**
 * `/me/profile` uses the same shell + left-nav as `/settings/*` — the
 * model-of-me page sits as one tab among the other settings, with
 * the "Your model" entry already wired into the shared nav.
 */
export default function MeProfileLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <SettingsShellLayout>{children}</SettingsShellLayout>;
}
