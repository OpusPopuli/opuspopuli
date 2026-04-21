import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SectionTitle } from "@/components/region/SectionTitle";
import { ComingSoon } from "@/components/region/ComingSoon";

describe("SectionTitle", () => {
  it("renders children as an h3", () => {
    render(<SectionTitle>Biography</SectionTitle>);
    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent("Biography");
  });
});

describe("ComingSoon", () => {
  it("renders title and description", () => {
    render(
      <ComingSoon title="Bills" description="Authored bills coming soon" />,
    );
    expect(screen.getByText("Bills")).toBeInTheDocument();
    expect(screen.getByText("Authored bills coming soon")).toBeInTheDocument();
  });
});
