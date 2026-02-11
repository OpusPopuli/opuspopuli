import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OfflineIndicator } from "@/components/OfflineIndicator";

describe("OfflineIndicator", () => {
  let onlineGetter: jest.SpyInstance;

  beforeEach(() => {
    onlineGetter = jest.spyOn(navigator, "onLine", "get");
  });

  afterEach(() => {
    onlineGetter.mockRestore();
  });

  it("should render nothing when online", () => {
    onlineGetter.mockReturnValue(true);
    const { container } = render(<OfflineIndicator />);

    expect(container.firstChild).toBeNull();
  });

  it("should render offline banner when offline", () => {
    onlineGetter.mockReturnValue(false);
    render(<OfflineIndicator />);

    expect(screen.getByText(/you're offline/i)).toBeInTheDocument();
  });

  it("should have correct accessibility attributes", () => {
    onlineGetter.mockReturnValue(false);
    render(<OfflineIndicator />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("aria-live", "polite");
  });

  it("should show banner when going offline", () => {
    onlineGetter.mockReturnValue(true);
    render(<OfflineIndicator />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // Simulate going offline
    onlineGetter.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("should hide banner when coming back online", () => {
    onlineGetter.mockReturnValue(false);
    render(<OfflineIndicator />);

    expect(screen.getByRole("status")).toBeInTheDocument();

    // Simulate coming online
    onlineGetter.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
