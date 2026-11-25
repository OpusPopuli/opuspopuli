/**
 * An invitation, never a wall (#1456).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { axe, toHaveNoViolations } from "jest-axe";
import { AccountPrompt } from "@/components/region/AccountPrompt";

expect.extend(toHaveNoViolations);

let mockAuth = { isAuthenticated: false, isLoading: false };
jest.mock("@/lib/auth-context", () => ({ useAuth: () => mockAuth }));
jest.mock("next/navigation", () => ({
  usePathname: () => "/region/bills/abc",
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("AccountPrompt (#1456)", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
    mockAuth = { isAuthenticated: false, isLoading: false };
  });

  it("invites a visitor, with the copy for its page", () => {
    render(<AccountPrompt kind="bill" />);
    expect(
      screen.getByRole("complementary", { name: "accountPrompt.bill.title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("accountPrompt.bill.body")).toBeInTheDocument();
  });

  it("offers sign-up, and sign-in that returns to this page", () => {
    render(<AccountPrompt kind="representative" />);
    expect(
      screen.getByRole("link", { name: "accountPrompt.create" }),
    ).toHaveAttribute("href", "/register");
    expect(
      screen.getByRole("link", { name: "accountPrompt.signIn" }),
    ).toHaveAttribute("href", "/login?redirect=%2Fregion%2Fbills%2Fabc");
  });

  it("is never a modal: nothing traps focus or covers the page", () => {
    render(<AccountPrompt kind="proposition" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing for a signed-in reader", () => {
    mockAuth = { isAuthenticated: true, isLoading: false };
    const { container } = render(<AccountPrompt kind="bill" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("waits for sign-in state rather than flashing at a signed-in reader", () => {
    mockAuth = { isAuthenticated: false, isLoading: true };
    const { container } = render(<AccountPrompt kind="bill" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("goes away when dismissed, and stays away for that kind of page", () => {
    const { unmount } = render(<AccountPrompt kind="bill" />);
    fireEvent.click(
      screen.getByRole("button", { name: "accountPrompt.dismiss" }),
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    unmount();

    render(<AccountPrompt kind="bill" />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("remembers each kind separately", () => {
    const { unmount } = render(<AccountPrompt kind="bill" />);
    fireEvent.click(
      screen.getByRole("button", { name: "accountPrompt.dismiss" }),
    );
    unmount();

    render(<AccountPrompt kind="representative" />);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("still dismisses when storage refuses to remember", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    render(<AccountPrompt kind="bill" />);
    fireEvent.click(
      screen.getByRole("button", { name: "accountPrompt.dismiss" }),
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<AccountPrompt kind="proposition" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
