/**
 * The civic record is open (#1456). The region layout must render its pages
 * for a visitor, not bounce them to /login, while the personal areas keep
 * their guards.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import RegionLayout from "@/app/region/layout";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockReplace }),
  usePathname: () => "/region",
}));
jest.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: false, isLoading: false, user: null }),
}));
jest.mock("@/components/Header", () => ({ Header: () => <header /> }));
jest.mock("@/components/Footer", () => ({ Footer: () => <footer /> }));
jest.mock("@/components/civics/CivicsContext", () => ({
  CivicsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/region/JurisdictionsContext", () => ({
  JurisdictionsProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

const source = (path: string) =>
  readFileSync(join(__dirname, "../../../app", path), "utf8");

describe("region layout (#1456)", () => {
  it("renders the page for a visitor without an account", () => {
    render(
      <RegionLayout>
        <p>the civic record</p>
      </RegionLayout>,
    );
    expect(screen.getByText("the civic record")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("carries no login guard", () => {
    const layout = source("region/layout.tsx");
    expect(layout).not.toMatch(/<ProtectedRoute/);
    expect(layout).not.toMatch(/from "@\/components\/ProtectedRoute"/);
  });

  it.each(["petition/layout.tsx", "me/briefing/layout.tsx"])(
    "leaves %s behind sign-in",
    (path) => {
      expect(source(path)).toMatch(/<ProtectedRoute>/);
    },
  );
});
