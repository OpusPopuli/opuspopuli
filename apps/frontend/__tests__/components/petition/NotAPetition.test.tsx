import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotAPetition } from "@/components/petition/NotAPetition";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("NotAPetition", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the not-a-petition variant by default", () => {
    render(<NotAPetition skipReason="not_a_petition" />);

    expect(
      screen.getByRole("heading", { name: "results.notAPetitionTitle" }),
    ).toBeInTheDocument();
    expect(screen.getByText("results.notAPetitionBody")).toBeInTheDocument();
  });

  it("renders the unreadable variant for the unreadable reason", () => {
    render(<NotAPetition skipReason="unreadable" />);

    expect(
      screen.getByRole("heading", { name: "results.unreadableTitle" }),
    ).toBeInTheDocument();
    expect(screen.getByText("results.unreadableBody")).toBeInTheDocument();
  });

  it("falls back to not-a-petition for unknown or missing reasons", () => {
    // The reason enum is closed on the backend, but the frontend must not
    // crash on anything unexpected crossing the wire.
    render(<NotAPetition skipReason={undefined} />);
    expect(
      screen.getByRole("heading", { name: "results.notAPetitionTitle" }),
    ).toBeInTheDocument();
  });

  it("offers a rescan CTA to the capture screen", () => {
    render(<NotAPetition skipReason="not_a_petition" />);

    fireEvent.click(screen.getByRole("button", { name: "results.tryAgain" }));
    expect(mockPush).toHaveBeenCalledWith("/petition/capture");
  });
});
