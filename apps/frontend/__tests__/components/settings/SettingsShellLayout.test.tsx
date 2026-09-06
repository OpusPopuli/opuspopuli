import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SettingsShellLayout } from "@/components/settings/SettingsShellLayout";
import en from "@/locales/en/common.json";

jest.mock("next/navigation", () => ({
  usePathname: () => "/me/profile",
}));
jest.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ logout: jest.fn() }),
}));
jest.mock("@/components/ProtectedRoute", () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
jest.mock("@/components/Footer", () => ({ Footer: () => <footer /> }));
jest.mock("@/components/LanguageToggle", () => ({
  LanguageToggle: () => <div />,
}));
jest.mock("@/components/Logo", () => ({ Logo: () => <div /> }));

describe("SettingsShellLayout", () => {
  it("sends 'Back to App' to the briefing, not the region index", () => {
    // The briefing is the signed-in home — it is where both login and the end
    // of onboarding land. /region is a section, not somewhere the reader came
    // from, so returning them there loses their place.
    render(
      <SettingsShellLayout>
        <div>content</div>
      </SettingsShellLayout>,
    );

    expect(
      screen.getByRole("link", { name: en.navigation.backToApp }),
    ).toHaveAttribute("href", "/me/briefing");
  });
});
