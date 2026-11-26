/**
 * "How to read this site", once (#962, #1456).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { axe, toHaveNoViolations } from "jest-axe";
import { ReadingNotice } from "@/components/ReadingNotice";

expect.extend(toHaveNoViolations);

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ReadingNotice", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it("says what kind of record this is: sources, AI, and automated links", () => {
    render(<ReadingNotice />);
    expect(
      screen.getByRole("complementary", { name: "readingNotice.title" }),
    ).toBeInTheDocument();
    for (const item of [
      "readingNotice.sources",
      "readingNotice.ai",
      "readingNotice.links",
    ]) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
    expect(
      screen.getByRole("link", { name: "readingNotice.more" }),
    ).toHaveAttribute("href", "/region/how-it-works");
  });

  it("is never a modal", () => {
    render(<ReadingNotice />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is shown once: dismissed, it stays dismissed on this device", () => {
    const { unmount } = render(<ReadingNotice />);
    fireEvent.click(
      screen.getByRole("button", { name: "readingNotice.dismiss" }),
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    unmount();

    render(<ReadingNotice />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("still dismisses when storage refuses to remember", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    render(<ReadingNotice />);
    fireEvent.click(
      screen.getByRole("button", { name: "readingNotice.dismiss" }),
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ReadingNotice />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
