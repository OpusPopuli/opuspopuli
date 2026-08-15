import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

/**
 * Separate from Footer.test.tsx on purpose.
 *
 * `APP_VERSION` is captured at module scope, so changing it means resetting
 * the module registry and re-importing per test. Footer.test.tsx renders once
 * in a `beforeEach` with a static import; folding these in would mean
 * restructuring that file for no gain.
 */
jest.mock("next/link", () => {
  return function MockLink({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) {
    return <a href={href}>{children}</a>;
  };
});

describe("Footer version", () => {
  const original = process.env.NEXT_PUBLIC_APP_VERSION;

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_VERSION = original;
    jest.resetModules();
  });

  it("shows the release the bundle was built from", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "frontend-v1.0.3";
    jest.resetModules();

    const { Footer } = await import("@/components/Footer");
    render(<Footer />);

    expect(screen.getByText("frontend-v1.0.3")).toBeInTheDocument();
  });

  // Local dev and any build not produced by the deploy workflow. Rendering a
  // placeholder like "dev" or "0.1.0" would be worse than rendering nothing:
  // a support conversation could quote it as though it identified a release.
  it("renders no version when the build did not supply one", async () => {
    delete process.env.NEXT_PUBLIC_APP_VERSION;
    jest.resetModules();

    const { Footer } = await import("@/components/Footer");
    render(<Footer />);

    expect(screen.queryByText(/frontend-v/)).not.toBeInTheDocument();
    // The rest of the footer is unaffected.
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }),
    ).toBeInTheDocument();
  });
});
