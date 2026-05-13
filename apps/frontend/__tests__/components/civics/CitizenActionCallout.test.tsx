import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CitizenActionCallout } from "@/components/civics/CitizenActionCallout";
import type { CitizenAction } from "@/lib/graphql/region";

const makeAction = (overrides: Partial<CitizenAction> = {}): CitizenAction => ({
  verb: "contact",
  label: {
    verbatim: "Contact your representative",
    plainLanguage: "Contact your representative",
    sourceUrl: "https://example.gov",
  },
  urgency: "active",
  url: "https://example.gov/contact",
  ...overrides,
});

describe("CitizenActionCallout", () => {
  it("renders nothing when action is null", () => {
    const { container } = render(<CitizenActionCallout action={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when action is undefined", () => {
    const { container } = render(<CitizenActionCallout action={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when urgency is 'none'", () => {
    const { container } = render(
      <CitizenActionCallout action={makeAction({ urgency: "none" })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a link when url is provided", () => {
    render(<CitizenActionCallout action={makeAction()} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.gov/contact");
    expect(link).toHaveTextContent("Contact your representative");
  });

  it("renders a div (not a link) when no url", () => {
    render(
      <CitizenActionCallout
        action={makeAction({ url: undefined, urgency: "passive" })}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Contact your representative")).toBeInTheDocument();
  });

  it("applies orange styling for active urgency", () => {
    render(<CitizenActionCallout action={makeAction({ urgency: "active" })} />);
    // Orange class is present somewhere in the rendered output
    expect(
      document.querySelector(".text-orange-800, .bg-orange-50"),
    ).toBeInTheDocument();
  });

  it("applies gray styling for passive urgency", () => {
    render(
      <CitizenActionCallout
        action={makeAction({ urgency: "passive", url: undefined })}
      />,
    );
    expect(
      document.querySelector(".text-gray-600, .bg-gray-50"),
    ).toBeInTheDocument();
  });
});
