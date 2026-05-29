import { SettingsShellLayout } from "@/components/settings/SettingsShellLayout";

export default function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <SettingsShellLayout>{children}</SettingsShellLayout>;
}
