import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import CampaignFinancePage from "@/app/region/campaign-finance/page";

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

describe("CampaignFinancePage", () => {
  it("should render page header", () => {
    render(<CampaignFinancePage />);

    expect(
      screen.getByRole("heading", { name: "Campaign Finance" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Committees, contributions, and expenditures for your region",
      ),
    ).toBeInTheDocument();
  });

  it("should render breadcrumb navigation", () => {
    render(<CampaignFinancePage />);

    const regionLink = screen.getByRole("link", { name: /Region/i });
    expect(regionLink).toHaveAttribute("href", "/region");
  });

  it("should render all four sub-category cards", () => {
    render(<CampaignFinancePage />);

    expect(screen.getByText("Committees")).toBeInTheDocument();
    expect(screen.getByText("Contributions")).toBeInTheDocument();
    expect(screen.getByText("Expenditures")).toBeInTheDocument();
    expect(screen.getByText("Independent Expenditures")).toBeInTheDocument();
  });

  it("should render card descriptions", () => {
    render(<CampaignFinancePage />);

    expect(
      screen.getByText("Campaign committees and PACs"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Campaign donations and contributions"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Campaign spending and payments"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Independent spending for/against candidates"),
    ).toBeInTheDocument();
  });

  it("should link to correct sub-pages", () => {
    render(<CampaignFinancePage />);

    const links = screen.getAllByRole("link");
    const hrefs = links.map((link) => link.getAttribute("href"));

    expect(hrefs).toContain("/region/campaign-finance/committees");
    expect(hrefs).toContain("/region/campaign-finance/contributions");
    expect(hrefs).toContain("/region/campaign-finance/expenditures");
    expect(hrefs).toContain(
      "/region/campaign-finance/independent-expenditures",
    );
  });
});
