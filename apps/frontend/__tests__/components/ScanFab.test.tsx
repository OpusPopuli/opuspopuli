import { render, screen } from "@testing-library/react";
import { ScanFab } from "@/components/ScanFab";

let mockAuthenticated = true;
let mockPathname = "/region";

jest.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: mockAuthenticated }),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ScanFab", () => {
  beforeEach(() => {
    mockAuthenticated = true;
    mockPathname = "/region";
  });

  it("renders a scan link to the camera on a normal authenticated route", () => {
    render(<ScanFab />);
    const link = screen.getByRole("link", {
      name: "navigation.scanPetition",
    });
    expect(link).toHaveAttribute("href", "/petition/capture");
  });

  it("is hidden when the user is not authenticated", () => {
    mockAuthenticated = false;
    const { container } = render(<ScanFab />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    "/petition",
    "/petition/capture",
    "/login",
    "/register",
    "/auth/callback",
  ])("is hidden on %s (redundant or pre-auth)", (path) => {
    mockPathname = path;
    const { container } = render(<ScanFab />);
    expect(container).toBeEmptyDOMElement();
  });
});
